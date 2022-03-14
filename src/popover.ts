import { Interactable, InteractEvent, ResizeEvent } from "@interactjs/types";
import interact from "interactjs";
import { HoverParent, HoverPopover, WorkspaceSplit } from "obsidian";
import { HoverLeaf } from "./leaf";
import HoverEditorPlugin from "./main";

const popovers = new WeakMap<HTMLElement, HoverEditor>();

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
  interact: Interactable;
  plugin: HoverEditorPlugin;
  lockedOut: boolean;
  abortController: AbortController;

  static activePopovers() {
    return document.body.findAll(".hover-popover").map(el => popovers.get(el)).filter(he => he);
  }

  constructor(parent: HoverParent, targetEl: HTMLElement, plugin: HoverEditorPlugin, waitTime?: number, public onShowCallback?: () => any) {
    super(parent, targetEl, waitTime);
    this.plugin = plugin;
    popovers.set(this.hoverEl, this);
    this.createResizeHandles();
  }

  attachLeaf(leaf: HoverLeaf, split: WorkspaceSplit) {
    this.leaf = leaf;
    this.leaf.togglePin(this.plugin.settings.autoPin === "always" ? true : false);
    this.leaf.popover = this;
    split.insertChild(0, leaf);
    this.hoverEl.prepend(split.containerEl);
  }

  onShow() {
    this.hoverEl.toggleClass("is-new", true);
    document.body.addEventListener(
      "click",
      () => {
        this.hoverEl.toggleClass("is-new", false);
      },
      { once: true, capture: true }
    );
    // if (this.parent?.hoverPopover) {
    //   this.parent.hoverPopover.hide();
    // }
    if (this.parent) {
      this.parent.hoverPopover = this;
    }
    this.registerInteract();
    this.onShowCallback?.();
    this.onShowCallback = undefined; // only call it once
  }

  onHide() {
    if (this.parent?.hoverPopover === this) {
      this.parent.hoverPopover = null;
    }
  }

  shouldShow() {
    return this.shouldShowSelf() || this.shouldShowChild();
  }

  explicitHide() {
    this.onTarget = this.onHover = this.isMenuActive = false;
    if (this.leaf) this.leaf.isPinned = false;
    this.hide();
  }

  shouldShowSelf() {
    return this.onTarget || this.onHover ;
  }

  shouldShowChild() {
    return super.shouldShowChild();
  }

  registerInteract() {
    let { appContainerEl } = this.plugin.app.dom;
    let self = this;
    let i = interact(this.hoverEl)
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
      });
    this.interact = i;
  }

  createResizeHandles() {
    this.hoverEl.createDiv("resize-handle bottom-left");
    this.hoverEl.createDiv("resize-handle bottom-right");
    this.hoverEl.createDiv("resize-handle top-left");
    this.hoverEl.createDiv("resize-handle top-right");
    this.hoverEl.createDiv("drag-handle top");
  }

  onDoubleTap(event: InteractEvent) {
    if (event.target.hasClass("drag-handle")) {
      event.preventDefault();
      this.leaf.togglePin(true);
      this.leaf.toggleMinimized();
    }
  }

  hide() {
    if (!(this.leaf?.isPinned || this.isMenuActive || this.onHover)) {
      if (this.leaf) {
        // the leaf detach logic needs to be called first before we close the popover
        // leaf detach will make a call to back to this method to complete the unloading
        this.leaf.detach();
      } else {
        this.leaf = null;
        this.parent = null;
        this.interact?.unset && this.interact.unset();
        this.abortController?.abort();
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
}

function dragMoveListener(event: InteractEvent) {
  let target = event.target as HTMLElement;

  let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
  let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

  target.style.transform = "translate(" + x + "px, " + y + "px)";

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}
