import type { ActionMap } from "@interactjs/core/scope";
import type { Modifier } from "@interactjs/modifiers/base";
import type { Interactable, InteractEvent, Interaction, ResizeEvent } from "@interactjs/types";
import { around } from "monkey-around";
import {
  Component,
  EphemeralState,
  HoverPopover,
  MarkdownEditView,
  OpenViewState,
  parseLinktext,
  PopoverState,
  MousePos,
  requireApiVersion,
  resolveSubpath,
  setIcon,
  TFile,
  View,
  Workspace,
  WorkspaceLeaf,
  WorkspaceSplit,
  EmptyView,
  MarkdownView,
  WorkspaceTabs,
  debounce,
} from "obsidian";

import HoverEditorPlugin, { genId } from "./main";
import {
  restorePopover,
  calculateOffsets,
  storeDimensions,
  snapToEdge,
  expandContract,
  dragMoveListener,
} from "./utils/measure";
import { isA } from "./utils/misc";

const popovers = new WeakMap<Element, HoverEditor>();
export interface HoverEditorParent {
  hoverPopover: HoverEditor | null;
  containerEl?: HTMLElement;
  view?: View;
  dom?: HTMLElement;
}
type ConstructableWorkspaceSplit = new (ws: Workspace, dir: "horizontal"|"vertical") => WorkspaceSplit;

let mouseCoords: MousePos = { x: 0, y: 0 };

function nosuper<T>(base: new (...args: unknown[]) => T): new () => T {
  const derived = function () {
    return Object.setPrototypeOf(new Component, new.target.prototype);
  };
  derived.prototype = base.prototype;
  return Object.setPrototypeOf(derived, base);
}

const layers = new WeakMap<Window,Set<HoverEditor>>();

export class HoverEditor extends nosuper(HoverPopover) {
  onTarget: boolean;

  onHover: boolean;

  shownPos: MousePos | null;

  isPinned: boolean = this.plugin.settings.autoPin === "always" ? true : false;

  isDragging: boolean;

  isResizing: boolean;

  interact?: Interactable;

  lockedOut: boolean;

  abortController? = this.addChild(new Component());

  detaching = false;

  opening = false;

  rootSplit: WorkspaceSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(window.app.workspace, "vertical");

  targetRect = this.targetEl?.getBoundingClientRect();

  pinEl: HTMLElement;

  titleEl: HTMLElement;

  containerEl: HTMLElement;

  hideNavBarEl: HTMLElement;

  viewHeaderHeight: number;

  oldPopover = this.parent?.hoverPopover;

  document: Document = this.targetEl?.ownerDocument ?? window.activeDocument ?? window.document;

  interactStatic = this.plugin.interact.forDom(this.document.body).interact;

  constrainAspectRatio: boolean;

  id = genId(8);

  resizeModifiers: Modifier[];

  dragElementRect: { top: number; left: number; bottom: number; right: number };

  onMouseIn: (event: MouseEvent) => void;

  onMouseOut: (event: MouseEvent) => void;

  xspeed: number;

  yspeed: number;

  bounce?: NodeJS.Timeout;

  boundOnZoomOut: () => void;

  originalPath: string; // these are kept to avoid adopting targets w/a different link
  originalLinkText: string;

  static activePopover?: HoverEditor;

  static activeWindows() {
    const windows: Window[] = [window];
    const { floatingSplit } = app.workspace;
    if (floatingSplit) {
      for (const split of floatingSplit.children) {
        if (split.win) windows.push(split.win);
      }
    }
    return windows;
  }

  static containerForDocument(doc: Document) {
    if (doc !== document && app.workspace.floatingSplit)
      for (const container of app.workspace.floatingSplit.children) {
        if (container.doc === doc) return container;
      }
    return app.workspace.rootSplit;
  }

  static activePopovers() {
    return this.activeWindows().flatMap(this.popoversForWindow);
  }

  static popoversForWindow(win?: Window) {
    return (Array.prototype.slice.call(win?.document?.body.querySelectorAll(".hover-popover") ?? []) as HTMLElement[])
    .map(el => popovers.get(el)!)
    .filter(he => he);
  }

  static forLeaf(leaf: WorkspaceLeaf | undefined) {
    // leaf can be null such as when right clicking on an internal link
    const el = leaf && document.body.matchParent.call(leaf.containerEl, ".hover-popover"); // work around matchParent race condition
    return el ? popovers.get(el) : undefined;
  }

  static iteratePopoverLeaves(ws: Workspace, cb: (leaf: WorkspaceLeaf) => boolean | void) {
    for (const popover of this.activePopovers()) {
      if (popover.rootSplit && ws.iterateLeaves(cb, popover.rootSplit)) return true;
    }
    return false;
  }

  hoverEl: HTMLElement = this.document.defaultView!.createDiv({
    cls: "popover hover-popover",
    attr: { id: "he" + this.id },
  });

  constructor(
    parent: HoverEditorParent,
    public targetEl: HTMLElement,
    public plugin: HoverEditorPlugin,
    waitTime?: number,
    public onShowCallback?: () => unknown,
  ) {
    //
    super();

    if (waitTime === undefined) {
      waitTime = 300;
    }
    this.onTarget = true;
    this.onHover = false;
    this.shownPos = null;
    this.parent = parent;
    this.waitTime = waitTime;
    this.state = PopoverState.Showing;
    const { hoverEl } = this;
    this.onMouseIn = this._onMouseIn.bind(this);
    this.onMouseOut = this._onMouseOut.bind(this);
    this.abortController!.load();

    if (targetEl) {
      targetEl.addEventListener("mouseover", this.onMouseIn);
      targetEl.addEventListener("mouseout", this.onMouseOut);
    }

    hoverEl.addEventListener("mouseover", event => {
      if (mouseIsOffTarget(event, hoverEl)) {
        this.onHover = true;
        this.onTarget = false;
        this.transition();
      }
    });
    hoverEl.addEventListener("mouseout", event => {
      if (mouseIsOffTarget(event, hoverEl)) {
        this.onHover = false;
        this.onTarget = false;
        this.transition();
      }
    });
    this.timer = window.setTimeout(this.show.bind(this), waitTime);
    this.document.addEventListener("mousemove", setMouseCoords);

    // custom logic begin
    popovers.set(this.hoverEl, this);
    this.hoverEl.addClass("hover-editor");
    this.containerEl = this.hoverEl.createDiv("popover-content");
    this.buildWindowControls();
    this.setInitialDimensions();
    const pinEl = (this.pinEl = this.document.defaultView!.createEl("a", "popover-header-icon mod-pin-popover"));
    this.titleEl.prepend(this.pinEl);
    pinEl.onclick = () => {
      this.togglePin();
    };
    setIcon(pinEl, "lucide-pin");
    this.createResizeHandles();
    if (this.plugin.settings.imageZoom) this.registerZoomImageHandlers();
  }

  adopt(targetEl: HTMLElement) {
    if (this.targetEl === targetEl) return true;
    const bounds = targetEl?.getBoundingClientRect();
    if (overlaps(this.targetRect, bounds)) {
      this.targetEl.removeEventListener("mouseover", this.onMouseIn);
      this.targetEl.removeEventListener("mouseout", this.onMouseOut);
      targetEl.addEventListener("mouseover", this.onMouseIn);
      targetEl.addEventListener("mouseout", this.onMouseOut);
      this.targetEl = targetEl;
      this.targetRect = bounds;
      const { x, y } = mouseCoords;
      this.onTarget = overlaps(bounds, { left: x, right: x, top: y, bottom: y } as DOMRect);
      this.transition();
      return true;
    } else {
      this.onTarget = false;
      this.transition();
    }
    return false;
  }

  activate = debounce(() => {
    const {win} = this.document;
    let layer = layers.get(win);
    layer || layers.set(win, layer = new Set());
    layer.delete(this);
    layer.add(this);
    win.requestAnimationFrame(() => {
      let zIndex = 41;
      Array.from(layer!).reverse().forEach(he => {
        he.hoverEl.style.setProperty("--he-popover-layer-inactive", ""+zIndex);
        if (zIndex > 31) zIndex--;
      })
    })
  }, 100);

  onZoomOut() {
    this.document.body.removeEventListener("mouseup", this.boundOnZoomOut);
    this.document.body.removeEventListener("dragend", this.boundOnZoomOut);
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
    this.document.body.addEventListener("mouseup", this.boundOnZoomOut, {
      once: true,
    });
    this.document.body.addEventListener("dragend", this.boundOnZoomOut, {
      once: true,
    });
    const offset = calculateOffsets(this.document);
    storeDimensions(this.hoverEl);
    snapToEdge(this.hoverEl, "viewport", offset);
    return false;
  }

  registerZoomImageHandlers() {
    this.hoverEl.addClass("image-zoom");
    this.boundOnZoomOut = this.onZoomOut.bind(this);
    this.hoverEl.on("mousedown", "img", this.onZoomIn.bind(this));
  }

  togglePin(value?: boolean) {
    this.activate();
    if (value === undefined) {
      value = !this.isPinned;
    }
    if (value) this.abortController?.unload();
    this.hoverEl.toggleClass("is-pinned", value);
    this.pinEl.toggleClass("is-active", value);
    this.isPinned = value;
  }

  getDefaultMode() {
    return this.parent?.view?.getMode ? this.parent.view.getMode() : "preview";
  }

  updateLeaves() {
    if (this.onTarget && this.targetEl && !this.document.contains(this.targetEl)) {
      this.onTarget = false;
      this.transition();
    }
    let leafCount = 0;
    this.plugin.app.workspace.iterateLeaves(leaf => {
      leafCount++;
    }, this.rootSplit);
    if (leafCount === 0) {
      this.hide(); // close if we have no leaves
    } else if (leafCount > 1) {
      this.toggleConstrainAspectRatio(false);
    }
    this.hoverEl.setAttribute("data-leaf-count", leafCount.toString());
  }

  get headerHeight() {
    const hoverEl = this.hoverEl;
    return this.titleEl.getBoundingClientRect().bottom - hoverEl.getBoundingClientRect().top;
  }

  toggleMinimized() {
    this.activate();
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
    this.rootSplit.getRoot = () => app.workspace[this.document === document ? "rootSplit" : "floatingSplit"]!;
    this.rootSplit.getContainer = () => HoverEditor.containerForDocument(this.document);
    this.titleEl.insertAdjacentElement("afterend", this.rootSplit.containerEl);
    // Obsidian 1.8.7 changed createLeafInParent to make new leaves active, so we have to stop it  :-(
    const remove = around(this.plugin.app.workspace, {setActiveLeaf() { return () => {}; }})
    let leaf: WorkspaceLeaf
    try {
      leaf = this.plugin.app.workspace.createLeafInParent(this.rootSplit, 0);
    } finally {
      remove()
    }
    this.updateLeaves();
    return leaf;
  }

  onload(): void {
    super.onload();
    this.registerEvent(this.plugin.app.workspace.on("layout-change", this.updateLeaves, this));
    this.registerEvent(app.workspace.on("layout-change", () => {
      // Ensure that top-level items in a popover are not tabbed
      this.rootSplit.children.forEach((item, index) => {
        if (item instanceof WorkspaceTabs) {
          this.rootSplit.replaceChild(index, item.children[0]);
        }
      })
    }));
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

  adjustHeight(byPx: number) {
    this.hoverEl.style.height = (this.hoverEl.offsetHeight) + byPx + "px";
  }

  toggleViewHeader(value?: boolean, initial?: boolean) {
    this.activate();
    if (value === undefined) value = !this.hoverEl.hasClass("show-navbar");
    this.hideNavBarEl?.toggleClass("is-active", value);
    this.hoverEl.toggleClass("show-navbar", value);
    const viewHeaderEl = this.hoverEl.querySelector(".view-header");
    if (!viewHeaderEl || initial) return;
    const calculatedViewHeaderHeight = parseFloat(
      getComputedStyle(viewHeaderEl).getPropertyValue("--he-view-header-height"),
    );
    this.hoverEl.style.transition = "height 0.2s";
    this.adjustHeight(value ? calculatedViewHeaderHeight : -calculatedViewHeaderHeight);
    setTimeout(() => {
      this.hoverEl.style.removeProperty("transition");
    }, 200);

    this.requestLeafMeasure();
  }

  buildWindowControls() {
    this.titleEl = this.document.defaultView!.createDiv("popover-titlebar");
    this.titleEl.createDiv("popover-title");
    const popoverActions = this.titleEl.createDiv("popover-actions");
    const hideNavBarEl = (this.hideNavBarEl = popoverActions.createEl("a", "popover-action mod-show-navbar"));
    setIcon(hideNavBarEl, "sidebar-open");
    hideNavBarEl.addEventListener("click", event => {
      this.toggleViewHeader();
    });
    if (this.plugin.settings.showViewHeader) {
      this.toggleViewHeader(true, true);
    }
    const minEl = popoverActions.createEl("a", "popover-action mod-minimize");
    setIcon(minEl, "minus");
    minEl.addEventListener("click", event => {
      restorePopover(this.hoverEl);
      this.toggleMinimized();
    });
    const maxEl = popoverActions.createEl("a", "popover-action mod-maximize");
    setIcon(maxEl, "maximize");
    maxEl.addEventListener("click", event => {
      this.activate();
      if (this.hoverEl.hasClass("snap-to-viewport")) {
        setIcon(maxEl, "maximize");
        restorePopover(this.hoverEl);
        return;
      }
      setIcon(maxEl, "minimize");
      const offset = calculateOffsets(this.document);
      storeDimensions(this.hoverEl);
      snapToEdge(this.hoverEl, "viewport", offset);
    });

    const closeEl = popoverActions.createEl("a", "popover-action mod-close");
    setIcon(closeEl, "x");
    closeEl.addEventListener("click", event => {
      this.hide();
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

    this.activate();
    this.hoverEl.toggleClass("is-new", true);

    this.document.body.addEventListener(
      "click",
      () => {
        this.hoverEl.toggleClass("is-new", false);
      },
      { once: true, capture: true },
    );

    if (this.parent) {
      this.parent.hoverPopover = this;
    }

    // Workaround until 0.15.7
    if (requireApiVersion("0.15.1") && !requireApiVersion("0.15.7"))
      app.workspace.iterateLeaves(leaf => { if (leaf.view instanceof MarkdownView) (leaf.view.editMode as any).reinit?.(); }, this.rootSplit);

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
    if (x <= 0 || x + width >= this.document.body.offsetWidth) {
      this.xspeed *= -1;
      this.pickColor();
    }

    if (y <= 0 || y + height >= this.document.body.offsetHeight) {
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
    if (this.shouldShow()) {
      if (this.state === PopoverState.Hiding) {
        this.state = PopoverState.Shown;
        clearTimeout(this.timer);
      }
    } else {
      if (this.state === PopoverState.Showing) {
        this.hide();
      } else {
        if (this.state === PopoverState.Shown) {
          this.state = PopoverState.Hiding;
          this.timer = window.setTimeout(() => {
            if (this.shouldShow()) {
              this.transition();
            } else {
              this.hide();
            }
          }, this.waitTime);
        }
      }
    }
  }

  detect(el: HTMLElement) {
    // TODO: may not be needed? the mouseover/out handers handle most detection use cases
    const { targetEl, hoverEl } = this;

    if (targetEl) {
      this.onTarget = el === targetEl || targetEl.contains(el);
    }

    this.onHover = el === hoverEl || hoverEl.contains(el);
  }

  _onMouseIn(event: MouseEvent) {
    if (!(this.targetEl && !mouseIsOffTarget(event, this.targetEl))) {
      this.onTarget = true;
      this.transition();
    }
  }

  _onMouseOut(event: MouseEvent) {
    if (!(this.targetEl && !mouseIsOffTarget(event, this.targetEl))) {
      this.onTarget = false;
      this.transition();
    }
  }

  position(pos?: MousePos | null): void {
    // without this adjustment, the x dimension keeps sliding over to the left as you progressively mouse over files
    // disabling this for now since messing with pos.x like this breaks the detect() logic
    // if (pos && pos.x !== undefined) {
    //   pos.x = pos.x + 20;
    // }

    // native obsidian logic
    if (pos === undefined) {
      pos = this.shownPos;
    }

    let rect;

    if (pos) {
      rect = {
        top: pos.y - 10,
        bottom: pos.y + 10,
        left: pos.x,
        right: pos.x,
      };
    } else if (this.targetEl) {
      const relativePos = getRelativePos(this.targetEl, this.document.body);
      rect = {
        top: relativePos.top,
        bottom: relativePos.top + this.targetEl.offsetHeight,
        left: relativePos.left,
        right: relativePos.left + this.targetEl.offsetWidth,
      };
    } else {
      rect = {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      };
    }

    this.document.body.appendChild(this.hoverEl);
    positionEl(rect, this.hoverEl, { gap: 10 }, this.document);

    // custom hover editor logic
    if (pos) {
      // give positionEl a chance to adjust the position before we read the coords
      setTimeout(() => {
        const left = parseFloat(this.hoverEl.style.left);
        const top = parseFloat(this.hoverEl.style.top);
        this.hoverEl.setAttribute("data-x", String(left));
        this.hoverEl.setAttribute("data-y", String(top));
      }, 0);
    }
  }

  shouldShow() {
    return this.shouldShowSelf() || this.shouldShowChild();
  }

  shouldShowChild(): boolean {
    return HoverEditor.activePopovers().some(popover => {
      if (popover !== this && popover.targetEl && this.hoverEl.contains(popover.targetEl)) {
        return popover.shouldShow();
      }
      return false;
    });
  }

  shouldShowSelf() {
    // Don't let obsidian show() us if we've already started closing
    // return !this.detaching && (this.onTarget || this.onHover);
    return (
      !this.detaching &&
      !!(
        this.onTarget ||
        this.onHover ||
        (this.state == PopoverState.Shown && this.isPinned) ||
        this.document.querySelector(`body>.modal-container, body > #he${this.id} ~ .menu, body > #he${this.id} ~ .suggestion-container`)
      )
    );
  }

  calculateMinSize() {
    return { width: 40, height: this.headerHeight };
  }

  calculateBoundaries(x: number, y: number, interaction: Interaction<keyof ActionMap>) {
    const bodyEl = interaction.element.closest("body");
    const boundaryEl = bodyEl?.querySelector(".workspace") || bodyEl?.querySelector(".workspace-window");
    return boundaryEl?.getBoundingClientRect();
  }

  calculateMaxSize(x: number, y: number, interaction: Interaction<keyof ActionMap>) {
    return { width: this.document.body.offsetWidth, height: this.document.body.offsetHeight };
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
    const viewPortBounds: HTMLElement = this.document.querySelector("div.app-container, div.workspace-split")!;
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
      this.interactStatic.modifiers.restrictEdges({
        outer: self.calculateBoundaries.bind(this),
      }),
      this.interactStatic.modifiers.restrictSize({
        min: self.calculateMinSize.bind(this),
        max: self.calculateMaxSize.bind(this),
      }),
      this.interactStatic.modifiers.aspectRatio({
        ratio: imgRatio || "preserve",
        enabled: false,
      }),
    ];
    this.dragElementRect = { top: 0, left: 1, bottom: 0, right: 0 };
    const dragModifiers = [
      this.interactStatic.modifiers.restrict({
        restriction: calculateBoundaryRestriction,
        offset: { top: 0, left: 40, bottom: 0, right: 40 },
        elementRect: this.dragElementRect,
        endOnly: false,
      }),
    ];
    if (this.constrainAspectRatio && imgRatio !== undefined) {
      this.toggleConstrainAspectRatio(true, imgRatio);
    }
    const i = this.interactStatic(this.hoverEl)
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
            if (event.buttons && isA(event.target, HTMLElement)) {
              event.target.addClass("is-dragging");
              self.activate();
            }
          },
          end(event: DragEvent) {
            if (isA(event.target, HTMLElement)) {
              event.target.removeClass("is-dragging");
            }
            self.requestLeafMeasure();
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
            self.activate();
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
              if (imgRatio && height > this?.document?.body.offsetHeight) {
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
    // native obsidian logic start
    if (!this.targetEl || this.document.body.contains(this.targetEl)) {
      this.state = PopoverState.Shown;
      this.timer = 0;
      this.shownPos = mouseCoords;
      this.position(mouseCoords);
      this.document.removeEventListener("mousemove", setMouseCoords);
      this.onShow();
      app.workspace.onLayoutChange();
      // initializingHoverPopovers.remove(this);
      // activeHoverPopovers.push(this);
      // initializePopoverChecker();
      this.load();
    } else {
      this.hide();
    }
    // native obsidian logic end

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

  onHide() {
    this.oldPopover = null;
    if (this.parent?.hoverPopover === this) {
      this.parent.hoverPopover = null;
    }
  }

  hide() {
    this.onTarget = this.onHover = false;
    this.isPinned = false;
    this.detaching = true;
    // Once we reach this point, we're committed to closing
    layers.get(this.document.win)?.delete(this);

    // in case we didn't ever call show()
    this.document.removeEventListener("mousemove", setMouseCoords);

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
      // Each leaf.detach() will trigger layout-changed and the updateLeaves()
      // method will then call hide() again when the last one is gone.
      leaves.forEach(leaf => {
        // Prevent saving uninitialized fold info
        if (leaf.view instanceof MarkdownView && !this._loaded) leaf.view.onMarkdownFold = () => null;
        leaf.detach();
        // Newer obsidians don't switch the active leaf until layout processing  :(
        if (leaf === app.workspace.activeLeaf) app.workspace.activeLeaf = null;
      });
    } else {
      this.parent = null;
      if (this.interact?.unset) this.interact.unset();
      this.abortController?.unload();
      this.abortController = undefined;
      this.interact = undefined;
      return this.nativeHide();
    }
  }

  nativeHide() {
    const { hoverEl, targetEl } = this;

    this.state = PopoverState.Hidden;

    hoverEl.detach();

    if (targetEl) {
      const parent = targetEl.matchParent(".hover-popover");
      if (parent) popovers.get(parent)?.transition();
      targetEl.removeEventListener("mouseover", this.onMouseIn);
      targetEl.removeEventListener("mouseout", this.onMouseOut);
    }

    this.onHide();
    this.unload();
  }

  resolveLink(linkText: string, sourcePath: string): TFile | null {
    const link = parseLinktext(linkText);
    const tFile = link ? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : null;
    return tFile;
  }

  async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, createInLeaf?: WorkspaceLeaf) {
    let file = this.resolveLink(linkText, sourcePath);
    const link = parseLinktext(linkText);
    if (!file && createInLeaf) {
      const folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
      file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
    }
    if (!file) {
      this.displayCreateFileAction(linkText, sourcePath, eState);
      return;
    }
    const { viewRegistry } = this.plugin.app;
    const viewType = viewRegistry.typeByExtension[file.extension];
    if (!viewType || !viewRegistry.viewByType[viewType]) {
      this.displayOpenFileAction(file);
      return;
    }
    eState = Object.assign(this.buildEphemeralState(file, link), eState);
    const parentMode = this.getDefaultMode();
    const state = this.buildState(parentMode, eState);
    const leaf = await this.openFile(file, state, createInLeaf);
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
    if (state.state?.mode === "source") this.whenShown(() => {
      // Not sure why this is needed, but without it we get issue #186
      if (requireApiVersion("1.0"))(leaf?.view as any)?.editMode?.reinit?.();
      leaf?.view?.setEphemeralState(state.eState);
    });
  }

  displayOpenFileAction(file: TFile) {
    const leaf = this.attachLeaf();
    const view = leaf.view! as EmptyView;
    view.emptyTitleEl.hide();
    view.actionListEl.empty();
    const { actionListEl } = view;
    actionListEl.createDiv({ cls: "file-embed-title" }, div => {
      div.createSpan({ cls: "file-embed-icon" }, span => setIcon(span, "document"));
      div.appendText(" " + file.name);
    });
    actionListEl.addEventListener("click", () => this.plugin.app.openWithDefaultApp(file.path));
    actionListEl.setAttribute("aria-label", i18next.t("interface.embed-open-in-default-app-tooltip"));
  }

  displayCreateFileAction(linkText: string, sourcePath: string, eState?: EphemeralState) {
    const leaf = this.attachLeaf();
    const view = leaf.view as EmptyView;
    if (view) {
      view.emptyTitleEl?.hide();
      view.actionListEl?.empty();
      const createEl = view.actionListEl?.createEl("button", "empty-state-action");
      if (!createEl) return;
      createEl.textContent = `${linkText} is not yet created. Click to create.`;
      if (this.plugin.settings.autoFocus) {
        setTimeout(() => {
          createEl?.focus();
        }, 200);
      }
      createEl.addEventListener(
        "click",
        async () => {
          this.togglePin(true);
          await this.openLink(linkText, sourcePath, eState, leaf);
        },
        { once: true },
      );
    }
  }

  whenShown(callback: () => any) {
    // invoke callback once the popover is visible
    if (this.detaching) return;
    const existingCallback = this.onShowCallback;
    this.onShowCallback = () => {
      if (this.detaching) return;
      callback();
      if (typeof existingCallback === "function") existingCallback();
    };
    if (this.state === PopoverState.Shown) {
      this.onShowCallback();
      this.onShowCallback = undefined;
    }
  }

  async openFile(file: TFile, openState?: OpenViewState, useLeaf?: WorkspaceLeaf) {
    if (this.detaching) return;
    const leaf = useLeaf ?? this.attachLeaf();
    this.opening = true;
    try {
      await leaf.openFile(file, openState);
      if (this.plugin.settings.autoFocus && !this.detaching) {
        this.whenShown(() => {
          // Don't set focus so as not to activate the Obsidian window during unfocused mouseover
          app.workspace.setActiveLeaf(leaf, false, false);
          // Set only the leaf focus, rather than global focus
          if (app.workspace.activeLeaf === leaf) leaf.setEphemeralState({focus: true});
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
                update(old) {
                  // Newer versions of the plugin need this instead
                  return function (_file) {
                    return old.call(this, _file === file ? null : _file);
                  }
                }
              }),
              1,
            );
        });
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
      if (this.detaching) this.hide();
    }
    return leaf;
  }

  buildState(parentMode: string, eState?: EphemeralState) {
    const defaultMode = this.plugin.settings.defaultMode;
    const mode = defaultMode === "match" ? parentMode : this.plugin.settings.defaultMode;
    return {
      active: false, // Don't let Obsidian force focus if we have autofocus off
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
  // Work around missing enhance.js API by checking match condition instead of looking up parent
  return leaf.containerEl.matches(".popover.hover-popover.hover-editor .workspace-leaf");
}

/**
 * It positions an element relative to a rectangle, taking into account the boundaries of the element's
 * offset parent
 * @param rect - The rectangle of the element you want to position the popup relative to.
 * @param {HTMLElement} el - The element to position
 * @param [options] - {
 * @returns An object with the top, left, and vresult properties.
 */
export function positionEl(
  rect: { top: number; bottom: number; left: number; right: number },
  el: HTMLElement,
  options: { gap?: number; preference?: string; offsetParent?: HTMLElement; horizontalAlignment?: string },
  document: Document,
) {
  options = options || {};
  el.show();
  const gap = options.gap || 0;
  const verticalPref = options.preference || "bottom";
  const parentEl = options.offsetParent || el.offsetParent || document.documentElement;
  const horizontalAlignment = options.horizontalAlignment || "left";
  const parentTop = parentEl.scrollTop + 10;
  const parentBottom = parentEl.scrollTop + parentEl.clientHeight - 10;
  const top = Math.min(rect.top, parentBottom);
  const bottom = Math.max(rect.bottom, parentTop);
  const elHeight = el.offsetHeight;
  const fitsAbove = rect.top - parentTop >= elHeight + gap;
  const fitsBelow = parentBottom - rect.bottom >= elHeight + gap;
  let topResult = 0;
  let vresult = ""; // vertical result

  if (!fitsAbove || ("top" !== verticalPref && fitsBelow)) {
    if (!fitsBelow || ("bottom" !== verticalPref && fitsAbove)) {
      if (parentEl.clientHeight < elHeight + gap) {
        topResult = parentTop;
        vresult = "overlap";
      } else {
        if ("top" === verticalPref) {
          topResult = parentTop + gap;
          vresult = "overlap";
        } else {
          topResult = parentBottom - elHeight;
          vresult = "overlap";
        }
      }
    } else {
      topResult = bottom + gap;
      vresult = "bottom";
    }
  } else {
    topResult = top - gap - elHeight;
    vresult = "top";
  }

  const leftBoundary = parentEl.scrollLeft + 10;
  const rightBoundary = parentEl.scrollLeft + parentEl.clientWidth - 10;
  const elWidth = el.offsetWidth;
  let leftResult = "left" === horizontalAlignment ? rect.left : rect.right - elWidth;

  if (leftResult < leftBoundary) {
    leftResult = leftBoundary;
  } else {
    if (leftResult > rightBoundary - elWidth) {
      leftResult = rightBoundary - elWidth;
    }
  }

  el.style.top = "".concat(topResult.toString(), "px");
  el.style.left = "".concat(leftResult.toString(), "px");

  return {
    top: topResult,
    left: leftResult,
    vresult: vresult,
  };
}

/**
 * "Get the position of an element relative to a parent element."
 *
 * The function takes two arguments:
 *
 * el: The element whose position we want to get.
 * parentEl: The parent element to which we want to get the relative position.
 * The function returns an object with two properties:
 *
 * top: The top position of the element relative to the parent element.
 * left: The left position of the element relative to the parent element.
 *
 * The function works by looping through the offsetParent chain of the element and subtracting the
 * scrollTop and scrollLeft values of the parent elements
 * @param {HTMLElement | null} el - The element you want to get the relative position of.
 * @param {HTMLElement | null} parentEl - The parent element that you want to get the relative position
 * of.
 * @returns An object with two properties, top and left.
 */
function getRelativePos(el: HTMLElement | null, parentEl: HTMLElement | null) {
  let top = 0,
    left = 0;
  for (let nextParentEl = parentEl ? parentEl.offsetParent : null; el && el !== parentEl && el !== nextParentEl; ) {
    top += el.offsetTop;
    left += el.offsetLeft;
    const offsetParent = el.offsetParent as HTMLElement | null;

    for (let parent = el.parentElement; parent && parent !== offsetParent; ) {
      top -= parent.scrollTop;
      left -= parent.scrollLeft;
      parent = parent.parentElement;
    }

    if (offsetParent && offsetParent !== parentEl && offsetParent !== nextParentEl) {
      top -= offsetParent.scrollTop;
      left -= offsetParent.scrollLeft;
    }

    el = offsetParent;
  }

  return {
    top,
    left,
  };
}

export function setMouseCoords(event: MouseEvent) {
  mouseCoords = {
    x: event.clientX,
    y: event.clientY,
  };
}

function mouseIsOffTarget(event: MouseEvent, el: Element) {
  const relatedTarget = event.relatedTarget;
  return !(isA(relatedTarget, Node) && el.contains(relatedTarget));
}

function overlaps(rect1?: DOMRect, rect2?: DOMRect) {
  return !!(
    rect1 &&
    rect2 &&
    rect1.right > rect2.left &&
    rect1.left < rect2.right &&
    rect1.bottom > rect2.top &&
    rect1.top < rect2.bottom
  );
}
