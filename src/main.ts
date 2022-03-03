import { around } from "monkey-around";
import {
  HoverParent,
  HoverPopover, parseLinktext,
  Plugin,
  PopoverState, WorkspaceLeaf,
  WorkspaceSplit
} from "obsidian";

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
          var popover = parent.hoverPopover;
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

                let _path = this.app.metadataCache.getFirstLinkpathDest(link.path, path);

                //@ts-ignore the official API has no contructor for WorkspaceSplit
                let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

                //@ts-ignore the official API has no contructor for WorkspaceLeaf
                let leaf = (popover.leaf = new WorkspaceLeaf(this.app));

                split.insertChild(0, leaf);
                hoverEl.appendChild(split.containerEl);
                await leaf.openFile(_path);
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
          if (this.onHover) {
            return;
          } else {
            this.leaf && this.leaf.detach();
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
