import type { ActionMap } from "@interactjs/core/scope";
import type { Modifier } from "@interactjs/modifiers/base";
import type { Interactable, InteractEvent, Interaction, ResizeEvent } from "@interactjs/types";
import interact from "@nothingislost/interactjs";
import { around } from "monkey-around";
import {
  EphemeralState,
  HoverPopover,
  MarkdownEditView,
  Menu,
  OpenViewState,
  parseLinktext,
  PopoverState,
  Pos,
  requireApiVersion,
  resolveSubpath,
  setIcon,
  TFile,
  View,
  Workspace,
  WorkspaceLeaf,
  WorkspaceSplit,
} from "obsidian";

import HoverEditorPlugin from "./main";
import {
  restorePopover,
  calculateOffsets,
  storeDimensions,
  snapToEdge,
  expandContract,
  dragMoveListener,
} from "./utils/measure";

const popovers = new WeakMap<Element, HoverEditor>();
export interface HoverEditorParent {
  hoverPopover: HoverEditor | null;
  containerEl?: HTMLElement;
  view?: View;
  dom?: HTMLElement;
}
type ConstructableWorkspaceSplit = new (ws: Workspace, dir: string) => WorkspaceSplit;
export class HoverEditor extends HoverPopover {
  onTarget: boolean;

  onHover: boolean;

  isPinned: boolean = this.plugin.settings.autoPin === "always" ? true : false;

  isDragging: boolean;

  isResizing: boolean;

  activeMenu?: Menu;

  interact?: Interactable;

  lockedOut: boolean;

  abortController?: AbortController;

  detaching = false;

  opening = false;

  rootSplit: WorkspaceSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(window.app.workspace, "vertical");

  pinEl: HTMLElement;

  titleEl: HTMLElement;

  containerEl: HTMLElement;

  hideNavBarEl: HTMLElement;

  viewHeaderHeight: number;

  oldPopover = this.parent?.hoverPopover;

  constrainAspectRatio: boolean;

  resizeModifiers: Modifier[];

  dragElementRect: { top: number; left: number; bottom: number; right: number };

  xspeed: number;

  yspeed: number;

  bounce?: NodeJS.Timeout;

  boundOnZoomOut: () => void;

  static activePopovers() {
    return document.body
      .findAll(".hover-popover")
      .map(el => popovers.get(el)!)
      .filter(he => he);
  }

  static forLeaf(leaf: WorkspaceLeaf | undefined) {
    // leaf can be null such as when right clicking on an internal link
    const el = leaf?.containerEl.matchParent(".hover-popover");
    return el ? popovers.get(el) : undefined;
  }

  static iteratePopoverLeaves(ws: Workspace, cb: (leaf: WorkspaceLeaf) => unknown) {
    for (const popover of this.activePopovers()) {
      if (popover.rootSplit && ws.iterateLeaves(cb, popover.rootSplit)) return true;
    }
    return false;
  }

  constructor(
    parent: HoverEditorParent,
    targetEl: HTMLElement,
    public plugin: HoverEditorPlugin,
    waitTime?: number,
    public onShowCallback?: () => unknown,
  ) {
    super(parent, targetEl, waitTime);
    popovers.set(this.hoverEl, this);
    this.hoverEl.addClass("hover-editor");
    this.containerEl = this.hoverEl.createDiv("popover-content");
    this.buildWindowControls();
    this.setInitialDimensions();
    const pinEl = (this.pinEl = createEl("a", "popover-header-icon mod-pin-popover"));
    this.titleEl.prepend(this.pinEl);
    pinEl.onclick = () => {
      this.togglePin();
    };
    if (requireApiVersion && requireApiVersion("0.13.27")) {
      setIcon(pinEl, "lucide-pin", 17);
    } else {
      setIcon(pinEl, "pin", 17);
    }
    this.createResizeHandles();
    if (this.plugin.settings.imageZoom) this.registerZoomImageHandlers();
  }

  onZoomOut() {
    document.body.removeEventListener("mouseup", this.boundOnZoomOut);
    document.body.removeEventListener("dragend", this.boundOnZoomOut);
    if (this.hoverEl.hasClass("do-not-restore")) {
      this.hoverEl.removeClass("do-not-restore");
    } else {
      restorePopover(this.hoverEl);
    }
  }

  onZoomIn(event: MouseEvent) {
    if (event.button !== 0) {
      return;
    }
    if (this.hoverEl.hasClass("snap-to-viewport")) {
      this.hoverEl.addClass("do-not-restore");
    }
    document.body.addEventListener("mouseup", this.boundOnZoomOut, {
      once: true,
    });
    document.body.addEventListener("dragend", this.boundOnZoomOut, {
      once: true,
    });
    const offset = calculateOffsets();
    storeDimensions(this.hoverEl);
    snapToEdge(this.hoverEl, "viewport", offset);
    return false;
  }

  registerZoomImageHandlers() {
    this.hoverEl.addClass("image-zoom");
    this.boundOnZoomOut = this.onZoomOut.bind(this);
    this.hoverEl.on("mousedown", "img", this.onZoomIn.bind(this));
  }

  get parentAllowsAutoFocus() {
    // the calendar view currently bugs out when it is a hover parent and auto focus is enabled, so we need to prevent it
    // calendar regenerates all calender DOM elements on active leaf change which causes the targetEl we received to be invalid
    const CalendarView = this.plugin.app.plugins.getPlugin("calendar")?.view.constructor;
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
    let leafCount = 0;
    this.plugin.app.workspace.iterateLeaves(leaf => {
      leafCount++;
      // return true;
    }, this.rootSplit);
    if (leafCount === 0) {
      this.explicitHide(); // close if we have no leaves
    } else if (leafCount > 1) {
      this.toggleConstrainAspectRatio(false);
    }
    this.hoverEl.setAttribute("data-leaf-count", leafCount.toString());
  }

  onload() {
    super.onload();
  }

  get headerHeight() {
    const hoverEl = this.hoverEl;
    return this.titleEl.getBoundingClientRect().bottom - hoverEl.getBoundingClientRect().top;
  }

  toggleMinimized(value?: boolean) {
    const hoverEl = this.hoverEl;
    const headerHeight = this.headerHeight;

    if (!hoverEl.hasAttribute("data-restore-height")) {
      if (this.plugin.settings.rollDown) expandContract(hoverEl, false);
      hoverEl.setAttribute("data-restore-height", String(hoverEl.offsetHeight));
      hoverEl.style.minHeight = headerHeight + "px";
      hoverEl.style.maxHeight = headerHeight + "px";
      hoverEl.toggleClass("is-minimized", true);
    } else {
      const restoreHeight = hoverEl.getAttribute("data-restore-height");
      if (restoreHeight) {
        hoverEl.removeAttribute("data-restore-height");
        hoverEl.style.height = restoreHeight + "px";
      }
      hoverEl.style.removeProperty("max-height");
      hoverEl.toggleClass("is-minimized", false);
      if (this.plugin.settings.rollDown) expandContract(hoverEl, true);
    }
    this.interact?.reflow({ name: "drag", axis: "xy" });
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
    const leaves: WorkspaceLeaf[] = [];
    this.plugin.app.workspace.iterateLeaves(leaf => {
      leaves.push(leaf);
    }, this.rootSplit);
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
    const viewHeaderEl = this.hoverEl.querySelector(".view-header");
    if (!viewHeaderEl) return;
    const calculatedViewHeaderHeight = parseFloat(
      getComputedStyle(viewHeaderEl).getPropertyValue("--he-view-header-height"),
    );
    this.hoverEl.style.transition = "height 0.2s";
    if (value) {
      this.hoverEl.style.height = parseFloat(this.hoverEl.style.height) + calculatedViewHeaderHeight + "px";
    } else {
      this.hoverEl.style.height = parseFloat(this.hoverEl.style.height) - calculatedViewHeaderHeight + "px";
    }
    setTimeout(() => {
      this.hoverEl.style.removeProperty("transition");
    }, 200);

    this.requestLeafMeasure();
  }

  buildWindowControls() {
    this.titleEl = createDiv("popover-titlebar");
    this.titleEl.createDiv("popover-title");
    const popoverActions = this.titleEl.createDiv("popover-actions");
    const hideNavBarEl = (this.hideNavBarEl = popoverActions.createEl("a", "popover-action mod-show-navbar"));
    setIcon(hideNavBarEl, "sidebar-open", 14);
    hideNavBarEl.addEventListener("click", event => {
      this.toggleViewHeader();
    });
    if (this.plugin.settings.showViewHeader) {
      this.toggleViewHeader(true);
    }
    const minEl = popoverActions.createEl("a", "popover-action mod-minimize");
    setIcon(minEl, "minus");
    minEl.addEventListener("click", event => {
      restorePopover(this.hoverEl);
      this.toggleMinimized();
    });
    const maxEl = popoverActions.createEl("a", "popover-action mod-maximize");
    setIcon(maxEl, "maximize", 14);
    maxEl.addEventListener("click", event => {
      if (this.hoverEl.hasClass("snap-to-viewport")) {
        setIcon(maxEl, "maximize", 14);
        restorePopover(this.hoverEl);
        return;
      }
      setIcon(maxEl, "minimize", 14);
      const offset = calculateOffsets();
      storeDimensions(this.hoverEl);
      snapToEdge(this.hoverEl, "viewport", offset);
    });

    const closeEl = popoverActions.createEl("a", "popover-action mod-close");
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
    const { closeDelay } = this.plugin.settings;
    setTimeout(() => (this.waitTime = closeDelay), closeDelay);

    this.oldPopover?.hide();
    this.oldPopover = null;

    this.hoverEl.toggleClass("is-new", true);

    document.body.addEventListener(
      "click",
      () => {
        this.hoverEl.toggleClass("is-new", false);
      },
      { once: true, capture: true },
    );

    if (this.parent) {
      this.parent.hoverPopover = this;
    }

    this.togglePin(this.isPinned);

    this.onShowCallback?.();
    this.onShowCallback = undefined; // only call it once
  }

  startBounce() {
    this.bounce = setTimeout(() => {
      this.hoverEl.style.left = parseFloat(this.hoverEl.style.left) + this.xspeed + "px";
      this.hoverEl.style.top = parseFloat(this.hoverEl.style.top) + this.yspeed + "px";
      this.checkHitBox();
      this.startBounce();
    }, 20);
  }

  toggleBounce() {
    this.xspeed = 7;
    this.yspeed = 7;
    if (this.bounce) {
      clearTimeout(this.bounce);
      this.bounce = undefined;
      const el = this.hoverEl.querySelector(".view-content") as HTMLElement;
      if (el?.style) {
        el.style.removeProperty("backgroundColor");
      }
    } else {
      this.startBounce();
    }
  }

  checkHitBox() {
    const x = parseFloat(this.hoverEl.style.left);
    const y = parseFloat(this.hoverEl.style.top);
    const width = parseFloat(this.hoverEl.style.width);
    const height = parseFloat(this.hoverEl.style.height);
    if (x <= 0 || x + width >= document.body.offsetWidth) {
      this.xspeed *= -1;
      this.pickColor();
    }

    if (y <= 0 || y + height >= document.body.offsetHeight) {
      this.yspeed *= -1;
      this.pickColor();
    }
  }

  pickColor() {
    const r = Math.random() * (254 - 0) + 0;
    const g = Math.random() * (254 - 0) + 0;
    const b = Math.random() * (254 - 0) + 0;
    const el = this.hoverEl.querySelector(".view-content") as HTMLElement;
    if (el?.style) {
      el.style.backgroundColor = "rgb(" + r + "," + g + ", " + b + ")";
    }
  }

  transition() {
    super.transition();
    if (!this.shouldShow() && this.state === PopoverState.Showing) {
      this.explicitHide();
    }
  }

  position(pos?: Pos): void {
    // without this adjustment, the x dimension keeps sliding over to the left as you progressively mouse over files
    // disabling this for now since messing with pos.x like this breaks the detect() logic
    // if (pos && pos.x !== undefined) {
    //   pos.x = pos.x + 20;
    // }
    super.position(pos);
    if (pos) {
      setTimeout(() => {
        const left = parseFloat(this.hoverEl.style.left);
        const top = parseFloat(this.hoverEl.style.top);
        this.hoverEl.setAttribute("data-x", String(left));
        this.hoverEl.setAttribute("data-y", String(top));
      }, 0);
    }
  }

  onHide() {
    this.oldPopover = null;
    if (this.parent?.hoverPopover === this) {
      this.parent.hoverPopover = null;
    }
  }

  explicitHide() {
    this.activeMenu?.hide();
    this.activeMenu = undefined;
    this.onTarget = this.onHover = false;
    this.isPinned = false;
    this.hide();
  }

  shouldShowSelf() {
    // Don't let obsidian show() us if we've already started closing
    return !this.detaching && (this.onTarget || this.onHover);
  }

  calculateMinSize() {
    return { width: 40, height: this.headerHeight };
  }

  calculateMaxSize(x: number, y: number, interaction: Interaction<keyof ActionMap>) {
    const width = interaction.pointerType === "reflow" ? document.body.offsetWidth / 1.5 : document.body.offsetWidth;
    const height = interaction.pointerType === "reflow" ? document.body.offsetHeight / 1.5 : document.body.offsetHeight;
    return { width: width, height: height };
  }

  toggleConstrainAspectRatio(value?: boolean, ratio?: number) {
    const aspectRatioMod = this.resizeModifiers.find(mod => mod.name == "aspectRatio");
    if (!aspectRatioMod) return;
    if (value === undefined) value = !aspectRatioMod.options.enabled;
    if (value) {
      aspectRatioMod.enable();
      this.constrainAspectRatio = true;
      if (ratio !== undefined && aspectRatioMod.options.ratio !== ratio) {
        aspectRatioMod.options.ratio = ratio;
      }
    } else {
      aspectRatioMod.disable();
      this.constrainAspectRatio = false;
    }
  }

  registerInteract() {
    const viewPortBounds = this.plugin.app.dom.appContainerEl;
    const self = this;
    const calculateBoundaryRestriction = function (
      eventX: number,
      eventY: number,
      interaction: Interaction<keyof ActionMap>,
    ) {
      const { top, right, bottom, left, x, y, width, height } = viewPortBounds.getBoundingClientRect();
      const boundingRect = { top, right, bottom, left, x, y, width, height };
      if (interaction.pointerType === "reflow") {
        // if we're reflowing, we want to keep the window fully inside the viewport
        self.dragElementRect.bottom = 1;
      } else {
        self.dragElementRect.bottom = 0;
      }
      if (self.plugin.settings.snapToEdges) {
        boundingRect.top = top - 30;
        boundingRect.bottom = bottom - self.headerHeight;
      } else {
        boundingRect.bottom = bottom - self.headerHeight;
      }
      return boundingRect;
    };
    let firstMovement = true;
    let windowChromeHeight: number;
    const imgRatio = this.hoverEl.dataset?.imgRatio ? parseFloat(this.hoverEl.dataset?.imgRatio) : undefined;
    this.resizeModifiers = [
      interact.modifiers.restrictEdges({
        outer: viewPortBounds,
      }),
      interact.modifiers.restrictSize({
        min: self.calculateMinSize.bind(this),
        max: self.calculateMaxSize.bind(this),
      }),
      interact.modifiers.aspectRatio({
        ratio: imgRatio || "preserve",
        enabled: false,
      }),
    ];
    this.dragElementRect = { top: 0, left: 1, bottom: 0, right: 0 };
    const dragModifiers = [
      interact.modifiers.restrict({
        restriction: calculateBoundaryRestriction,
        offset: { top: 0, left: 40, bottom: 0, right: 40 },
        elementRect: this.dragElementRect,
        endOnly: false,
      }),
    ];
    if (this.constrainAspectRatio && imgRatio !== undefined) {
      this.toggleConstrainAspectRatio(true, imgRatio);
    }
    const i = interact(this.hoverEl)
      .preventDefault("always")

      .on("doubletap", this.onDoubleTap.bind(this))

      .draggable({
        // inertiajs has a core lib memory leak currently. leave disabled
        // inertia: false,
        modifiers: dragModifiers,
        allowFrom: ".popover-titlebar",

        listeners: {
          start(event: DragEvent) {
            // only auto pin if the drag with user initiated
            // this avoids a reflow causing an auto pin
            if (event.buttons) self.togglePin(true);
            if (event.buttons && event.target instanceof HTMLElement) {
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
        modifiers: this.resizeModifiers,
        listeners: {
          start(event: ResizeEvent) {
            const viewEl = event.target as HTMLElement;
            viewEl.style.removeProperty("max-height");
            const viewHeaderHeight = (self.hoverEl.querySelector(".view-header") as HTMLElement)?.offsetHeight;
            const titlebarHeight = self.titleEl.offsetHeight;

            windowChromeHeight = titlebarHeight + viewHeaderHeight;
            firstMovement = true;
            // only auto pin if the drag with user initiated
            // this avoids a reflow causing an auto pin
            if (event.buttons) self.togglePin(true);
          },
          move: function (event: ResizeEvent) {
            if (!event?.deltaRect || !event.edges) return;
            const { target } = event;
            let { x, y } = target.dataset;

            let height = event.rect.height;
            let width = event.rect.width;

            x = x ? x : target.style.left;
            y = y ? y : target.style.top;

            x = String((parseFloat(x) || 0) + event.deltaRect?.left);
            y = String((parseFloat(y) || 0) + event.deltaRect?.top);

            if (self.constrainAspectRatio && imgRatio && event.buttons !== undefined) {
              // don't run if this was an automated resize (ie. reflow)
              if (firstMovement) {
                // adjustments to compensate for the titlebar height
                if (event.edges.top && (event.edges.right || event.edges.left)) {
                  y = String(parseFloat(y) - windowChromeHeight);
                } else if (event.edges.top) {
                  x = String(parseFloat(x) + windowChromeHeight * imgRatio);
                } else if (event.edges.left && !(event.edges.top || event.edges.bottom)) {
                  y = String(parseFloat(y) - windowChromeHeight);
                }
              }

              firstMovement = false;

              if (event.edges.top && !(event.edges.right || event.edges.left)) {
                height = height - windowChromeHeight;
                width = width - windowChromeHeight * imgRatio;
              } else if (event.edges.bottom && !(event.edges.right || event.edges.left)) {
                height = height - windowChromeHeight;
                width = width - windowChromeHeight * imgRatio;
              }

              height = height + windowChromeHeight;

              if (target.hasClass("snap-to-left") || target.hasClass("snap-to-right")) {
                y = String(parseFloat(target.style.top));
                x = String(parseFloat(target.style.left));
              }
            } else {
              if (imgRatio && height > document.body.offsetHeight) {
                height = height / 1.5;
                width = height * imgRatio;
              }
            }

            Object.assign(target.style, {
              width: `${width}px`,
              height: `${height}px`,
              top: `${y}px`,
              left: x === "NaN" ? "unset" : `${x}px`,
            });

            Object.assign(target.dataset, { x, y });
          },
          end: function (event: ResizeEvent) {
            if (event.buttons === undefined) {
              const height = parseFloat(event.target.style.height) + windowChromeHeight;
              event.target.style.height = height + "px";
            }
            if (event.rect.height > self.headerHeight) {
              event.target.removeAttribute("data-restore-height");
            }
            i.reflow({ name: "drag", axis: "xy" });
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

  show() {
    super.show();
    // if this is an image view, set the dimensions to the natural dimensions of the image
    // an interactjs reflow will be triggered to constrain the image to the viewport if it's
    // too large
    if (this.hoverEl.dataset.imgHeight && this.hoverEl.dataset.imgWidth) {
      this.hoverEl.style.height = parseFloat(this.hoverEl.dataset.imgHeight) + this.titleEl.offsetHeight + "px";
      this.hoverEl.style.width = parseFloat(this.hoverEl.dataset.imgWidth) + "px";
    }
    this.registerInteract();
    this.interact?.reflow({
      name: "resize",
      edges: { right: true, bottom: true },
    });
    this.interact?.reflow({ name: "drag", axis: "xy" });
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
        if (this.interact?.unset) this.interact.unset();
        this.abortController?.abort();
        this.abortController = undefined;
        this.interact = undefined;
        return super.hide();
      }
    }
  }

  resolveLink(linkText: string, sourcePath: string): TFile | null {
    const link = parseLinktext(linkText);
    const tFile = link ? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : null;
    return tFile;
  }

  async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, autoCreate?: boolean) {
    let file = this.resolveLink(linkText, sourcePath);
    const link = parseLinktext(linkText);
    if (!file && autoCreate) {
      const folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
      file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
    }
    if (!file) {
      this.displayCreateFileAction(linkText, sourcePath, eState);
      return;
    }
    eState = Object.assign(this.buildEphemeralState(file, link), eState);
    const parentMode = this.getDefaultMode();
    const state = this.buildState(parentMode, eState);
    const leaf = await this.openFile(file, state);
    const leafViewType = leaf?.view?.getViewType();
    if (leafViewType === "image") {
      // TODO: temporary workaround to prevent image popover from disappearing immediately when using live preview
      if (
        this.plugin.settings.autoFocus &&
        this.parent?.hasOwnProperty("editorEl") &&
        (this.parent as unknown as MarkdownEditView).editorEl!.hasClass("is-live-preview")
      ) {
        this.waitTime = 3000;
      }
      this.constrainAspectRatio = true;
      const img = leaf!.view.contentEl.querySelector("img")!;
      this.hoverEl.dataset.imgHeight = String(img.naturalHeight);
      this.hoverEl.dataset.imgWidth = String(img.naturalWidth);
      this.hoverEl.dataset.imgRatio = String(img.naturalWidth / img.naturalHeight);
    } else if (leafViewType === "pdf") {
      this.hoverEl.style.height = "800px";
      this.hoverEl.style.width = "600px";
    }
    if (state.state?.mode === "source") {
      setTimeout(() => {
        if (this.detaching) return;
        leaf?.view?.setEphemeralState(state.eState);
      }, this.plugin.settings.triggerDelay);
    }
  }

  displayCreateFileAction(linkText: string, sourcePath: string, eState?: EphemeralState) {
    const leaf = this.attachLeaf();
    if (leaf?.view?.emptyTitleEl) {
      leaf.view.emptyTitleEl?.hide();
      leaf.view.actionListEl?.empty();
      const createEl = leaf.view.actionListEl?.createEl("button", "empty-state-action");
      if (!createEl) return;
      createEl.textContent = `${linkText} is not yet created. Click to create.`;
      setTimeout(() => {
        createEl?.focus();
      }, 200);
      createEl.addEventListener(
        "click",
        async () => {
          this.togglePin(true);
          await this.openLink(linkText, sourcePath, eState, true);
        },
        { once: true },
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
        const existingCallback = this.onShowCallback;
        this.onShowCallback = () => {
          this.plugin.app.workspace.setActiveLeaf(leaf, false, true);
          // Prevent this leaf's file from registering as a recent file
          // (for the quick switcher or Recent Files plugin) for the next
          // 1ms.  (They're both triggered by a file-open event that happens
          // in a timeout 0ms after setActiveLeaf, so we register now and
          // uninstall later to ensure our uninstalls happen after the event.)
          setTimeout(
            around(Workspace.prototype, {
              recordMostRecentOpenedFile(old) {
                return function (_file: TFile) {
                  // Don't update the quick switcher's recent list
                  if (_file !== file) {
                    return old.call(this, _file);
                  }
                };
              },
            }),
            1,
          );
          const recentFiles = this.plugin.app.plugins.plugins["recent-files-obsidian"];
          if (recentFiles)
            setTimeout(
              around(recentFiles, {
                shouldAddFile(old) {
                  return function (_file: TFile) {
                    // Don't update the Recent Files plugin
                    return _file !== file && old.call(this, _file);
                  };
                },
              }),
              1,
            );
          if (existingCallback instanceof Function) existingCallback();
        };
        if (this.state === PopoverState.Shown) {
          this.onShowCallback();
          this.onShowCallback = undefined;
        }
      } else if (!this.plugin.settings.autoFocus && !this.detaching) {
        const titleEl = this.hoverEl.querySelector(".popover-title");
        if (!titleEl) return;
        titleEl.textContent = leaf.view?.getDisplayText();
        titleEl.setAttribute("data-path", leaf.view?.file?.path);
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.opening = false;
      if (this.detaching) this.explicitHide();
    }
    return leaf;
  }

  buildState(parentMode: string, eState?: EphemeralState) {
    const defaultMode = this.plugin.settings.defaultMode;
    const mode = defaultMode === "match" ? parentMode : this.plugin.settings.defaultMode;
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
    },
  ) {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const subpath = cache ? resolveSubpath(cache, link?.subpath || "") : undefined;
    const eState: EphemeralState = { subpath: link?.subpath };
    if (subpath) {
      eState.line = subpath.start.line;
      eState.startLoc = subpath.start;
      eState.endLoc = subpath.end || undefined;
    }
    return eState;
  }
}

export function isHoverLeaf(leaf: WorkspaceLeaf) {
  return !!HoverEditor.forLeaf(leaf);
}
