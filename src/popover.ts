import { Interactable, InteractEvent, ResizeEvent } from "@interactjs/types";
import interact from "interactjs";
import { around } from "monkey-around";
import { EphemeralState, HoverPopover, Menu, OpenViewState, parseLinktext, requireApiVersion, resolveSubpath, setIcon, TFile, View, Workspace, WorkspaceLeaf, WorkspaceSplit } from "obsidian";
import HoverEditorPlugin from "./main";

const SNAP_DISTANCE = 10;
const UNSNAP_THRESHOLD = 60;

const popovers = new WeakMap<Element, HoverEditor>();

export function isHoverLeaf(leaf: WorkspaceLeaf) {
  return !!HoverEditor.forLeaf(leaf);
}

export interface HoverEditorParent {
  hoverPopover: HoverEditor | null;
  containerEl?: HTMLElement;
  view?: View;
  dom?: HTMLElement;
}

export class HoverEditor extends HoverPopover {
  onTarget: boolean;
  onHover: boolean;
  isPinned: boolean = this.plugin.settings.autoPin === "always" ? true : false;
  isDragging: boolean;
  isResizing: boolean;
  activeMenu: Menu;
  interact: Interactable;
  lockedOut: boolean;
  abortController: AbortController;
  detaching: boolean = false;
  opening: boolean = false;
  rootSplit: WorkspaceSplit = new (
    // the official API has no contructor for WorkspaceSplit
    WorkspaceSplit as new(ws: Workspace, dir: string) => WorkspaceSplit
  )(this.plugin.app.workspace, "vertical");
  pinEl: HTMLElement;
  titleEl: HTMLElement;
  containerEl: HTMLElement;
  hideNavBarEl: HTMLElement;
  oldPopover = this.parent.hoverPopover;

  static activePopovers() {
    return document.body.findAll(".hover-popover").map(el => popovers.get(el)).filter(he => he);
  }

  static forLeaf(leaf: WorkspaceLeaf) {
    // leaf can be null such as when right clicking on an internal link
    return popovers.get(leaf?.containerEl.matchParent(".hover-popover"));
  }

  static iteratePopoverLeaves(ws: Workspace, cb: (leaf: WorkspaceLeaf) => any) {
    for (const popover of this.activePopovers()) {
      if (ws.iterateLeaves(cb, popover.rootSplit)) return true;
    }
    return false;
  }

  constructor(parent: HoverEditorParent, targetEl: HTMLElement, public plugin: HoverEditorPlugin, waitTime?: number, public onShowCallback?: () => any) {
    super(parent, targetEl, waitTime);
    popovers.set(this.hoverEl, this);
    this.containerEl = this.hoverEl.createDiv("popover-content");
    this.buildWindowControls();
    this.setInitialDimensions();
    const pinEl = this.pinEl = createEl("a", "popover-header-icon mod-pin-popover");
    this.titleEl.prepend(this.pinEl);
    pinEl.onclick = () => {
      this.togglePin();
    };
    if (requireApiVersion && requireApiVersion("0.13.27")) {
      setIcon(pinEl, "lucide-pin", 17);
    } else {
      setIcon(pinEl, "pin", 17);
    }
    this.togglePin(this.isPinned);
    this.createResizeHandles();
  }

  get parentAllowsAutoFocus() {
    // the calendar view currently bugs out when it is a hover parent and auto focus is enabled, so we need to prevent it
    // calendar regenerates all calender DOM elements on active leaf change which causes the targetEl we received to be invalid
    let CalendarView = this.plugin.app.plugins.getPlugin("calendar")?.view.constructor;
    if (CalendarView && this.parent instanceof CalendarView) return false;
    return true;
  }

  togglePin(value?: boolean) {
    if (value === undefined) {
      value = !this.isPinned;
    }
    if (value) this.abortController?.abort();
    this.hoverEl.toggleClass("is-pinned", value);
    this.pinEl.toggleClass("is-active", value);
    this.isPinned = value;
  }

  getDefaultMode() {
    return this.parent?.view?.getMode ? this.parent.view.getMode() : "preview";
  }

  updateLeaves() {
    this.plugin.app.workspace.iterateLeaves(() => {
      return true;
    }, this.rootSplit) || this.explicitHide(); // close if we have no leaves
  }

  onload() {
    super.onload();
  }

  get headerHeight() {
    let hoverEl = this.hoverEl;
    return this.titleEl.getBoundingClientRect().bottom - hoverEl.getBoundingClientRect().top;
  }

  toggleMinimized(value?: boolean) {
    let hoverEl = this.hoverEl;
    let headerHeight = this.headerHeight;

    if (!hoverEl.hasAttribute("data-restore-height")) {
      this.plugin.settings.rollDown && expandContract(hoverEl, false);
      hoverEl.setAttribute("data-restore-height", String(hoverEl.offsetHeight));
      hoverEl.style.minHeight = headerHeight + "px";
      hoverEl.style.maxHeight = headerHeight + "px";
      hoverEl.toggleClass("is-minimized", true);
    } else {
      let restoreHeight = hoverEl.getAttribute("data-restore-height");
      if (restoreHeight) {
        hoverEl.removeAttribute("data-restore-height");
        hoverEl.style.height = restoreHeight + "px";
      }
      hoverEl.style.removeProperty("max-height");
      hoverEl.toggleClass("is-minimized", false);
      this.plugin.settings.rollDown && expandContract(hoverEl, true);
    }
    this.interact.reflow({ name: "drag", axis: "xy" });
  }

  attachLeaf(): WorkspaceLeaf {
    this.rootSplit.getRoot = () => this.plugin.app.workspace.rootSplit;
    this.titleEl.insertAdjacentElement("afterend", this.rootSplit.containerEl);
    const leaf = this.plugin.app.workspace.createLeafInParent(this.rootSplit, 0);
    this.updateLeaves();
    this.registerEvent(this.plugin.app.workspace.on("layout-change", this.updateLeaves, this));
    return leaf;
  }

  leaves() {
    const leaves: WorkspaceLeaf[] = []
    this.plugin.app.workspace.iterateLeaves(leaf => {leaves.push(leaf)}, this.rootSplit);
    return leaves;
  }

  setInitialDimensions() {
    this.hoverEl.style.height = this.plugin.settings.initialHeight;
    this.hoverEl.style.width = this.plugin.settings.initialWidth;
  }

  toggleViewHeader(value?: boolean) {
    if (value === undefined) value = !this.hoverEl.hasClass("show-navbar");
    this.hideNavBarEl?.toggleClass("is-active", value);
    this.hoverEl.toggleClass("show-navbar", value);
    this.requestLeafMeasure();
  }

  buildWindowControls() {
    this.titleEl = createDiv("popover-titlebar");
    let popoverTitle = this.titleEl.createDiv("popover-title");
    let popoverActions = this.titleEl.createDiv("popover-actions");
    let hideNavBarEl = this.hideNavBarEl = popoverActions.createEl("a", "popover-action mod-show-navbar");
    setIcon(hideNavBarEl, "sidebar-open", 14);
    hideNavBarEl.addEventListener("click", event => {
      this.toggleViewHeader();
    });
    if (this.plugin.settings.showViewHeader) {
      this.toggleViewHeader(true);
    };
    let minEl = popoverActions.createEl("a", "popover-action mod-minimize");
    setIcon(minEl, "minus");
    minEl.addEventListener("click", event => {
      restorePopover(this.hoverEl);
      this.toggleMinimized();
    });
    let maxEl = popoverActions.createEl("a", "popover-action mod-maximize");
    setIcon(maxEl, "maximize", 14);
    maxEl.addEventListener("click", event => {
      if (this.hoverEl.hasClass("snap-to-viewport")) {
        setIcon(maxEl, "maximize", 14);
        restorePopover(this.hoverEl);
        return;
      }
      setIcon(maxEl, "minimize", 14);
      let offset = calculateOffsets();
      storeDimensions(this.hoverEl);
      snapToEdge(this.hoverEl, "viewport", offset);
    });

    let closeEl = popoverActions.createEl("a", "popover-action mod-close");
    setIcon(closeEl, "x");
    closeEl.addEventListener("click", event => {
      this.explicitHide();
    });
    this.containerEl.prepend(this.titleEl);
  }

  requestLeafMeasure() {
    // address view height measurement issues triggered by css transitions
    // we wait a bit for the transition to finish and remeasure
    const leaves = this.leaves();
    if (leaves.length) {
      setTimeout(() => {
        leaves.forEach(leaf => leaf.onResize());
      }, 200);
    }
  }

  onShow() {
    
    // Once we've been open for closeDelay, use the closeDelay as a hiding timeout
    const {closeDelay} = this.plugin.settings;
    setTimeout(() => this.waitTime = closeDelay, closeDelay);

    this.oldPopover?.hide();
    this.oldPopover = null;

    this.hoverEl.toggleClass("is-new", true);
    document.body.addEventListener(
      "click",
      () => {
        this.hoverEl.toggleClass("is-new", false);
      },
      { once: true, capture: true }
    );
    if (this.parent) {
      this.parent.hoverPopover = this;
    }
    this.registerInteract();
    this.onShowCallback?.();
    this.onShowCallback = undefined; // only call it once
  }

  onHide() {
    this.oldPopover = null;
    if (this.parent?.hoverPopover === this) {
      this.parent.hoverPopover = null;
    }
  }

  explicitHide() {
    this.activeMenu?.hide();
    this.activeMenu = null;
    this.onTarget = this.onHover = false;
    this.isPinned = false;
    this.hide();
  }

  shouldShowSelf() {
    // Don't let obsidian show() us if we've already started closing
    return !this.detaching && (this.onTarget || this.onHover);
  }

  calculateMinHeightRestriction() {
    return { width: 40, height: this.headerHeight }
  }

  registerInteract() {
    let viewPortBounds = this.plugin.app.dom.appContainerEl;
    let calculateBoundaryRestriction = function () {
      let { top, right, bottom, left, x, y, width, height } = viewPortBounds.getBoundingClientRect();
      let boundingRect = { top, right, bottom, left, x, y, width, height };
      if (self.plugin.settings.snapToEdges) {
        boundingRect.top = top - 30;
        boundingRect.bottom = bottom - self.headerHeight;
      } else {
        boundingRect.bottom = bottom - self.headerHeight;
      }
      return boundingRect;
    };
    let self = this;
    let i = interact(this.hoverEl)
      .preventDefault("always")

      .on("doubletap", this.onDoubleTap.bind(this))

      .draggable({
        // inertiajs has a core lib memory leak currently. leave disabled
        // inertia: false,
        modifiers: [
          interact.modifiers.restrict({
            restriction: calculateBoundaryRestriction,
            offset: { top: 0, left: 40, bottom: 0, right: 40 },
            elementRect: { top: 0, left: 1, bottom: 0, right: 0 },
            endOnly: false,
          }),
        ],
        allowFrom: ".popover-titlebar", 

        listeners: {
          start(event: DragEvent) {
            self.togglePin(true);
            if (event.target instanceof HTMLElement) {
              event.target.addClass("is-dragging");
            }
          },
          end(event: DragEvent) {
            if (event.target instanceof HTMLElement) {
              event.target.removeClass("is-dragging");
            }
          },
          move: dragMoveListener.bind(self),
        },
      })

      .resizable({
        edges: {
          top: ".top-left, .top-right, .top",
          left: ".top-left, .bottom-left, .left",
          bottom: ".bottom-left, .bottom-right, .bottom",
          right: ".top-right, .bottom-right, .right",
        },
        modifiers: [
          interact.modifiers.restrictEdges({
            outer: viewPortBounds,
          }),
          interact.modifiers.restrictSize({
            min: self.calculateMinHeightRestriction.bind(this),
          }),
        ],
        listeners: {
          start(event: ResizeEvent) {
            let viewEl = event.target as HTMLElement;
            viewEl.style.removeProperty("max-height");
            self.togglePin(true);
          },
          move: function (event: ResizeEvent) {
            let { target } = event;
            let { x, y } = target.dataset;

            x = x ? x : target.style.left;
            y = y ? y : target.style.top;

            x = String((parseFloat(x) || 0) + event.deltaRect.left);
            y = String((parseFloat(y) || 0) + event.deltaRect.top);

            if (target.hasClass("snap-to-left") || target.hasClass("snap-to-right")) {
              y = String(parseFloat(target.style.top));
              x = String(parseFloat(target.style.left));
            }

            Object.assign(target.style, {
              width: `${event.rect.width}px`,
              height: `${event.rect.height}px`,
              top: `${y}px`,
              left: x === "NaN" ? "unset" : `${x}px`,
            });

            Object.assign(target.dataset, { x, y });
          },
          end: function (event: ResizeEvent) {
            if (event.rect.height > self.headerHeight) {
              event.target.removeAttribute("data-restore-height");
            }
          },
        },
      });
    this.interact = i;
  }

  createResizeHandles() {
    this.hoverEl.createDiv("resize-handle bottom-left");
    this.hoverEl.createDiv("resize-handle bottom-right");
    this.hoverEl.createDiv("resize-handle top-left");
    this.hoverEl.createDiv("resize-handle top-right");
    this.hoverEl.createDiv("resize-handle right");
    this.hoverEl.createDiv("resize-handle left");
    this.hoverEl.createDiv("resize-handle bottom");
    this.hoverEl.createDiv("resize-handle top");
  }

  onDoubleTap(event: InteractEvent) {
    if (event.target.tagName === "DIV" && event.target.closest(".popover-titlebar")) {
      event.preventDefault();
      this.togglePin(true);
      this.toggleMinimized();
    }
  }

  hide() {
    if (this.detaching || !(this.isPinned || this.activeMenu || this.onHover)) {
      // Once we reach this point, we're committed to closing
      this.detaching = true;

      // A timer might be pending to call show() for the first time, make sure
      // it doesn't bring us back up after we close
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = 0;
      }

      // Hide our HTML element immediately, even if our leaves might not be
      // detachable yet.  This makes things more responsive and improves the
      // odds of not showing an empty popup that's just going to disappear
      // momentarily.
      this.hoverEl.hide();

      // If a file load is in progress, we need to wait until it's finished before
      // detaching leaves.  Because we set .detaching, The in-progress openFile()
      // will call us again when it finishes.
      if (this.opening) return;

      const leaves = this.leaves();
      if (leaves.length) {
        // Detach all leaves before we unload the popover and remove it from the DOM.
        // Each leaf.detach() will trigger layout-changed
        // method will then call hide() again when the last one is gone.
        leaves.forEach(leaf => leaf.detach());
      } else {
        this.parent = null;
        this.interact?.unset && this.interact.unset();
        this.abortController?.abort();
        this.abortController = null;
        try {
          this.interact =
            (this.interact as any)._doc =
            (this.interact as any)._context =
            (this.interact as any).target =
            (this.interact as any)._scopeEvents =
            (this.interact as any)._win =
              null;
        } catch {}
        return super.hide();
      }
    }
  }

  resolveLink(linkText: string, sourcePath: string): TFile {
    let link = parseLinktext(linkText);
    let tFile = link ? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : undefined;
    return tFile;
  }

  async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, autoCreate?: boolean) {
    // if (eState && eState.scroll) eState.line = eState.scroll;
    let file = this.resolveLink(linkText, sourcePath);
    let link = parseLinktext(linkText);
    if (!file && autoCreate) {
      let folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
      file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
    }
    if (!file) {
      this.displayCreateFileAction(linkText, sourcePath, eState);
      return;
    }
    eState = Object.assign(this.buildEphemeralState(file, link), eState);
    let parentMode = this.getDefaultMode();
    let state = this.buildState(parentMode, eState);
    const leaf = await this.openFile(file, state);
    if (state.state?.mode === "source") {
      setTimeout(() => {
        if (this.detaching) return;
        leaf.view?.setEphemeralState(state.eState);
      }, 400);
    }
  }

  displayCreateFileAction(linkText: string, sourcePath: string, eState?: EphemeralState) {
    const leaf = this.attachLeaf();
      if (leaf?.view?.emptyTitleEl) {
        leaf.view.emptyTitleEl?.hide();
        leaf.view.actionListEl.empty();
        let createEl = leaf.view.actionListEl.createEl("button", "empty-state-action");
        createEl.textContent = `${linkText} is not yet created. Click to create.`;
        setTimeout(() => {
          createEl.focus();
        }, 200);
        createEl.addEventListener(
          "click",
          async () => {
            this.togglePin(true);
            await this.openLink(linkText, sourcePath, eState, true);
          },
          { once: true }
        );
      }
  }

  async openFile(file: TFile, openState?: OpenViewState) {
    if (this.detaching) return;
    const leaf = this.attachLeaf();
    this.opening = true;
    try {
      await leaf.openFile(file, openState);
      if (this.plugin.settings.autoFocus && !this.detaching && this.parentAllowsAutoFocus) {
        let existingCallback = this.onShowCallback;
        this.onShowCallback = () => {
          this.plugin.app.workspace.setActiveLeaf(leaf, false, true);
          existingCallback instanceof Function && existingCallback();
        };
        // Prevent this leaf's file from registering as a recent file
        // (for the quick switcher or Recent Files plugin) for the next
        // 1ms.  (They're both triggered by a file-open event that happens
        // in a timeout 0ms after setActiveLeaf, so we register now and
        // uninstall later to ensure our uninstalls happen after the event.)
        setTimeout(around(Workspace.prototype, {
          recordMostRecentOpenedFile(old) {
            return function (_file: TFile) {
              // Don't update the quick switcher's recent list
              if (_file !== file) {
                return old.call(this, _file);
              }
            };
          }
        }), 1);
        const recentFiles = this.plugin.app.plugins.plugins["recent-files-obsidian"];
        if (recentFiles) setTimeout(around(recentFiles, {
          shouldAddFile(old) {
            return function (_file: TFile) {
              // Don't update the Recent Files plugin
              return (_file !== file) && old.call(this, _file);
            };
          }
        }), 1);
      } else if (!this.plugin.settings.autoFocus && !this.detaching) {
        let titleEl = this.hoverEl.querySelector(".popover-title");
        titleEl.textContent = leaf.view?.getDisplayText();
        titleEl.setAttribute("data-path", leaf.view?.file?.path);
      }
    } catch (e) {
      console.error(e)
    } finally {
      this.opening = false;
      if (this.detaching) this.explicitHide();
    }
    return leaf;
  }

  buildState(parentMode: string, eState?: EphemeralState) {
    let defaultMode = this.plugin.settings.defaultMode;
    let mode = defaultMode === "match" ? parentMode : this.plugin.settings.defaultMode;
    return {
      state: { mode: mode },
      eState: eState,
    };
  }

  buildEphemeralState(
    file: TFile,
    link?: {
      path: string;
      subpath: string;
    }
  ) {
    let subpath = resolveSubpath(this.plugin.app.metadataCache.getFileCache(file), link?.subpath);
    let eState: EphemeralState = { subpath: link?.subpath };
    if (subpath) {
      eState.line = subpath.start.line;
      eState.startLoc = subpath.start;
      eState.endLoc = subpath.end || null;
    }
    return eState;
  }

}

function dragMoveListener(event: InteractEvent) {
  let target = event.target as HTMLElement;

  let { x, y } = target.dataset;

  x = x ? x : target.style.left;
  y = y ? y : target.style.top;

  x = String((parseFloat(x) || 0) + event.dx);
  y = String((parseFloat(y) || 0) + event.dy);

  if (this.plugin.settings.snapToEdges) {
    let offset: { top: number; left: number };

    let insideLeftSnapTarget = event.client.x < SNAP_DISTANCE;
    let insideRightSnapTarget = event.client.x > document.body.offsetWidth - SNAP_DISTANCE;
    let insideTopSnapTarget = event.client.y < 30;

    if (insideLeftSnapTarget || insideRightSnapTarget || insideTopSnapTarget) {
      offset = calculateOffsets();
      storeDimensions(target);
    }

    if (insideLeftSnapTarget) {
      // if we're inside of a snap zone
      snapToEdge(target, "left", offset);
      return;
    } else if (insideRightSnapTarget) {
      snapToEdge(target, "right", offset);
      return;
    } else if (insideTopSnapTarget) {
      snapToEdge(target, "viewport", offset);
      return;
    } else {
      // if we're outside of a snap zone
      if (target.hasClass("snap-to-viewport")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-viewport");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      } else if (target.hasClass("snap-to-left")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-left");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      } else if (target.hasClass("snap-to-right")) {
        if (event.client.y < UNSNAP_THRESHOLD) return;
        target.removeClass("snap-to-right");
        restoreDimentions(target);
        calculatePointerPosition(event);
        return;
      }
    }
  } 
  
  // if snapping disabled or if no snapping action has just occurred

  target.style.top = y ? y + "px" : target.style.top;
  target.style.left = x ? x + "px" : target.style.left;

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}

function restorePopover(el: HTMLElement) {
  if (el.hasClass("snap-to-viewport")) {
    el.removeClass("snap-to-viewport");
    restoreDimentions(el);
    return;
  }
}

function expandContract(el: HTMLElement, expand: boolean) {
  let contentHeight = (el.querySelector(".view-content") as HTMLElement).offsetHeight;
  contentHeight = expand ? -contentHeight : contentHeight;
  let y = (parseFloat(el.getAttribute("data-y")) || 0) + contentHeight;
  el.style.top = y + "px";
  el.setAttribute("data-y", String(y));
}

function getOrigDimensions(el: HTMLElement) {
  let height = el.getAttribute("data-orig-height");
  let width = el.getAttribute("data-orig-width");
  let left = parseFloat(el.getAttribute("data-orig-pos-left"));
  let top = parseFloat(el.getAttribute("data-orig-pos-top"));
  let titlebarHeight = calculateOffsets().top;
  if (top < titlebarHeight) top = titlebarHeight;
  return { height, width, top, left };
}

function restoreDimentions(el: HTMLElement) {
  let { height, width, top, left } = getOrigDimensions(el);
  el.removeAttribute("data-orig-width");
  el.removeAttribute("data-orig-height");
  el.removeAttribute("data-orig-pos-left");
  el.removeAttribute("data-orig-pos-top");
  width && (el.style.width = width + "px");
  height && (el.style.height = height + "px");
  top && (el.style.top = top + "px", el.setAttribute("data-y", String(top)));
  left && (el.style.left = left + "px");
}

function storeDimensions(el: HTMLElement) {
  !el.hasAttribute("data-orig-width") && el.setAttribute("data-orig-width", String(el.offsetWidth));
  !el.hasAttribute("data-orig-height") && el.setAttribute("data-orig-height", String(el.offsetHeight));
  !el.hasAttribute("data-orig-pos-left") && el.setAttribute("data-orig-pos-left", String(parseFloat(el.style.left)));
  !el.hasAttribute("data-orig-pos-top") && el.setAttribute("data-orig-pos-top", String(parseFloat(el.style.top)));
}

function calculatePointerPosition(event: InteractEvent) {
  let target = event.target as HTMLElement;

  let pointerOffset = event.client.x - event.rect.left;
  let maximizedWidth = event.rect.width;

  let pointerOffsetPercentage = pointerOffset / maximizedWidth;
  let restoredWidth = target.offsetWidth;

  let x = String(event.client.x - pointerOffsetPercentage * restoredWidth);
  let y = String(event.client.y);

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}

function calculateOffsets() {
  let appContainerEl = document.body.querySelector(".app-container") as HTMLElement;
  let leftRibbonEl = document.body.querySelector(".mod-left.workspace-ribbon") as HTMLElement;
  let titlebarHeight = appContainerEl.offsetTop;
  let ribbonWidth = document.body.hasClass("hider-ribbon") ? 0 : leftRibbonEl.offsetWidth;
  return { top: titlebarHeight, left: ribbonWidth };
}

function snapToEdge(el: HTMLElement, edge: string, offset: { top: number; left: number }) {
  el.addClass(`snap-to-${edge}`);
  el.style.top = offset.top + "px";
  el.style.height = `calc(100vh - ${offset.top}px)`;
  el.style.left = edge === "right" ? "unset" : offset.left + "px";
  if (edge === "viewport") {
    el.style.width = `calc(100vw - ${offset.left}px)`;
  }
}