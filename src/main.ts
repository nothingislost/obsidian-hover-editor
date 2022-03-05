import { InteractEvent, ResizeEvent } from "@interactjs/types";
import interact from "interactjs";
import { around } from "monkey-around";
import { HoverParent, HoverPopover, parseLinktext, Plugin, PopoverState, WorkspaceSplit } from "obsidian";
import { HoverLeaf } from "./leaf";

declare module "obsidian" {
  interface App {
    internalPlugins: {
      plugins: Record<string, { _loaded: boolean; instance: { name: string; id: string } }>;
    };
  }
  interface WorkspaceSplit {
    insertChild(index: number, leaf: WorkspaceLeaf, resize?: boolean): void;
    containerEl: HTMLElement;
  }
  interface View {
    iconEl: HTMLElement;
  }
  enum PopoverState {
    Showing,
    Shown,
    Hiding,
    Hidden,
  }
  interface HoverPopover {
    targetEl: HTMLElement;
    hoverEl: HTMLElement;
    position(pos?: Pos): void;
    hide(): void;
    explicitClose?: boolean;
  }
  interface Pos {
    x: number;
    y: number;
  }
}

export default class ObsidianHoverEditor extends Plugin {
  patchUninstaller: () => void;
  patchUninstaller2: () => void;

  async onload() {
    let InternalPlugins = this.app.internalPlugins.plugins["page-preview"].instance.constructor;
    let plugin = this;

    this.patchUninstaller = around(InternalPlugins.prototype, {
      onLinkHover(old: any) {
        return function (
          parent: HoverParent,
          targetEl: HTMLElement,
          linkText: string,
          path: string,
          state: unknown,
          ...args: any[]
        ) {
          let popover = parent.hoverPopover;
          if (!(popover && popover.state !== PopoverState.Hidden && popover.targetEl === targetEl)) {
            popover = new HoverPopover(parent, targetEl);
            setTimeout(async () => {
              let hoverEl;
              if (popover.state === PopoverState.Shown) {
                popover.position();
              } else {
                hoverEl = popover.hoverEl;

                let link = parseLinktext(linkText);
                if (!link.path.match(/\.[a-zA-Z0-9]+$/)) link.path = link.path + ".md";

                let tFile = this.app.metadataCache.getFirstLinkpathDest(link.path, path);
                if (!tFile?.path) {
                  popover.explicitClose = true;
                  popover.hide();
                  return;
                }

                //@ts-ignore the official API has no contructor for WorkspaceSplit
                let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

                //@ts-ignore the official API has no contructor for WorkspaceLeaf
                let leaf = new HoverLeaf(this.app);

                leaf.popover = popover;
                split.insertChild(0, leaf);
                hoverEl.appendChild(split.containerEl);
                await leaf.openFile(tFile);
                // shed the default event handler
                let clone = leaf.view.iconEl.cloneNode(true) as HTMLElement;
                clone.addClass("draggable");
                clone.removeAttribute("aria-label");
                leaf.view.iconEl.replaceWith(clone);
                // TODO: clean this listener up on hide
                hoverEl.addEventListener("focusin", function () {
                  document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
                  this.addClass("is-active");
                });
                document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
                hoverEl.addClass("is-active");
                this.app.workspace.setActiveLeaf(leaf, true, true);
                hoverEl.createDiv("resize-handle bottom-left");
                hoverEl.createDiv("resize-handle bottom-right");
                hoverEl.createDiv("resize-handle top-left");
                hoverEl.createDiv("resize-handle top-right");
                leaf.interact = interact(hoverEl)
                  .preventDefault("always")

                  .draggable({
                    allowFrom: ".view-header-icon.draggable",

                    listeners: {
                      start(event: DragEvent) {
                        // place the most recently moved element to the top of the z-index stack

                        document.body.appendChild(event.target as HTMLElement);
                        document.body.addClass("is-dragging-popover");
                      },
                      move: dragMoveListener,
                      end(event: DragEvent) {
                        document.body.removeClass("is-dragging-popover");
                        document.body.querySelector(".tooltip")?.detach();
                      },
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

                // enable this and take a heap dump to look for leaks
                // leaf.view.memLeak = new Uint8Array(1024*1024*100);
              }
            }, 100);
          }
        };
      },
    });
    this.register(this.patchUninstaller);
    this.patchUninstaller2 = around(HoverPopover.prototype, {
      hide(old: any) {
        return function (...args) {
          // prevent the popover from being closed unless closed using the leaf close button
          // TODO: stop the eventListeners from constantly calling hide();
          if (this.explicitClose) {
            const result = old.call(this, ...args);
            return result;
          }
        };
      },
    });
    this.register(this.patchUninstaller2);
  }

  onunload(): void {
    this.patchUninstaller();
    this.patchUninstaller2();
  }
}

function dragMoveListener(event: InteractEvent) {
  let target = event.target as HTMLElement;
  // keep the dragged position in the data-x/data-y attributes
  let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
  let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

  // translate the element
  target.style.transform = "translate(" + x + "px, " + y + "px)";

  // update the posiion attributes
  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}
