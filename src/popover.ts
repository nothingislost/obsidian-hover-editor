import { Interactable, InteractEvent, ResizeEvent } from "@interactjs/types";
import interact from "interactjs";
import { App, HoverParent, HoverPopover, WorkspaceSplit } from "obsidian";
import { HoverLeaf } from "./leaf";

export class HoverEditor extends HoverPopover {
  explicitClose: boolean;
  onTarget: boolean;
  onHover: boolean;
  isPinned: boolean;
  leaf: HoverLeaf;
  isDragging: boolean;
  isResizing: boolean;
  isMenuActive: boolean;
  parent: HoverParent;
  pinEl: HTMLElement;
  interact: Interactable;
  app: App;

  constructor(
    parent: HoverParent,
    targetEl: HTMLElement,
    app: App,
    leaf: HoverLeaf,
    split: WorkspaceSplit,
    waitTime?: number
  ) {
    super(parent, targetEl, waitTime);
    this.app = app;
    this.leaf = leaf;
    this.createResizeHandles();
    this.leaf.isPinned = false;
    this.leaf.popover = this;
    this.registerInteract();
    split.insertChild(0, leaf);
    this.hoverEl.prepend(split.containerEl);
  }

  onShow() {}

  onHide() {}

  shouldShow() {
    return this.shouldShowSelf() || this.shouldShowChild();
  }

  explicitHide() {
    this.onTarget = this.onHover = this.isMenuActive = false;
    this.hide();
  }

  shouldShowSelf() {
    return this.onTarget || this.onHover || this.leaf?.isPinned || this.isMenuActive;
  }

  shouldShowChild() {
    return super.shouldShowChild();
  }

  registerInteract() {
    let { appContainerEl } = this.app.dom;
    let self = this;
    let i = (this.leaf.interact = interact(this.hoverEl)
      .preventDefault("always")

      .on("doubletap", this.onDoubleTap.bind(this))

      .draggable({
        // inertiajs has a core lib memory leak currently. leave disabled
        // inertia: false,
        modifiers: [
          interact.modifiers.restrictRect({
            restriction: appContainerEl,
            endOnly: true,
          }),
        ],
        allowFrom: ".top",

        listeners: {
          start(event: DragEvent) {
            self.leaf.togglePin(true);
          },
          move: dragMoveListener,
        },
      })

      .resizable({
        edges: {
          top: ".top-left, .top-right",
          left: ".top-left, .bottom-left",
          bottom: ".bottom-left, .bottom-right",
          right: ".top-right, .bottom-right",
        },
        listeners: {
          start(event: ResizeEvent) {
            let viewEl = event.target.parentElement as HTMLElement;
            viewEl.style.removeProperty("max-height");
            self.leaf.togglePin(true);
          },
          move: function (event: ResizeEvent) {
            let { x, y } = event.target.dataset;

            x = String((parseFloat(x) || 0) + event.deltaRect.left);
            y = String((parseFloat(y) || 0) + event.deltaRect.top);

            Object.assign(event.target.style, {
              width: `${event.rect.width}px`,
              height: `${event.rect.height}px`,
              transform: `translate(${x}px, ${y}px)`,
            });

            Object.assign(event.target.dataset, { x, y });
          },
        },
      }));
  }

  createResizeHandles() {
    this.hoverEl.createDiv("resize-handle bottom-left");
    this.hoverEl.createDiv("resize-handle bottom-right");
    this.hoverEl.createDiv("resize-handle top-left");
    this.hoverEl.createDiv("resize-handle top-right");
    this.hoverEl.createDiv("drag-handle top");
  }

  maybePin() {}

  onDoubleTap(event: InteractEvent) {
    if (event.target.hasClass("drag-handle")) {
      event.preventDefault();
      this.leaf.togglePin(true);
      let viewEl = event.target.parentElement as HTMLElement;
      let viewHeader = viewEl.querySelector(".view-header") as HTMLElement;
      let headerHeight = viewHeader.getBoundingClientRect().bottom - this.hoverEl.getBoundingClientRect().top;
      if (!viewEl.style.maxHeight) {
        viewEl.style.minHeight = headerHeight + "px";
        viewEl.style.maxHeight = headerHeight + "px";
      } else {
        viewEl.style.removeProperty("max-height");
      }
      this.leaf.interact.reflow({ name: "drag", axis: "xy" });
    }
  }

  hide() {
    if (!this.shouldShow()) {
      if (this.leaf) {
        // the leaf detach logic needs to be called first before we close the popover
        // leaf detach will make a call to back to this method to complete the unloading
        this.leaf.detach();
      } else {
        this.leaf = null;
        this.parent = null;
        return super.hide();
      }
    }
  }
}

function dragMoveListener(event: InteractEvent) {
  let target = event.target as HTMLElement;

  let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
  let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

  target.style.transform = "translate(" + x + "px, " + y + "px)";

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}
