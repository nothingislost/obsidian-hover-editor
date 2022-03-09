import { around } from "monkey-around";
import {
  debounce,
  HoverEditorParent,
  HoverPopover,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  PopoverState,
  SplitDirection,
  TAbstractFile,
  Workspace,
  WorkspaceLeaf,
  WorkspaceSplit,
} from "obsidian";
import { HoverLeaf } from "./leaf";
import { HoverEditor } from "./popover";
import { DEFAULT_SETTINGS, HoverEditorSettings, SettingTab } from "./settings/settings";

export default class HoverEditorPlugin extends Plugin {
  activePopovers: HoverPopover[];
  settings: HoverEditorSettings;
  settingsTab: SettingTab;

  async onload() {
    await this.loadSettings();
    this.registerSettingsTab();

    this.app.workspace.onLayoutReady(() => {
      if (!this.app.internalPlugins.plugins["page-preview"]._loaded) {
        new Notice(
          "The Hover Editor plugin requires that 'Page preview' be enabled. You can enable 'Page preview' under 'Settings -> Core plugins'.",
          30000
        );
      }
      this.registerActivePopoverHandler();
      this.registerContextMenuHandler();
      this.acquireActivePopoverArray();
      this.patchRecordHistory();
      this.patchSlidingPanes();

      this.patchLinkHover();
    });
  }

  patchRecordHistory() {
    let uninstaller = around(Workspace.prototype, {
      recordHistory(old: any) {
        return function (leaf: WorkspaceLeaf, pushHistory: boolean, ...args: any[]) {
          if (leaf instanceof HoverLeaf) return;
          return old.call(this, leaf, pushHistory, ...args);
        };
      },
      trigger(old: any) {
        return function (event: string, ...args: any[]) {
          if (event === "file-open" && this.activeLeaf instanceof HoverLeaf) {
            return;
          }
          return old.call(this, event, ...args);
        };
      },
      splitActiveLeaf(old: any) {
        return function (direction?: SplitDirection, ...args: any[]) {
          let currentLeaf = this.activeLeaf;
          if (currentLeaf instanceof HoverLeaf) {
            this.activeLeaf = null;
          }
          return old.call(this, direction, ...args);
        };
      },
    });
    this.register(uninstaller);
  }

  patchSlidingPanes() {
    let SlidingPanesPlugin = this.app.plugins.plugins["sliding-panes-obsidian"]?.constructor;
    if (SlidingPanesPlugin) {
      let uninstaller = around(SlidingPanesPlugin.prototype, {
        focusActiveLeaf(old: any) {
          return function (...args: any[]) {
            // sliding panes will try and make popovers part of the sliding area if we don't exclude them
            if (this.app.workspace.activeLeaf instanceof HoverLeaf) return;
            return old.call(this, ...args);
          };
        },
      });
      this.register(uninstaller);
    }
  }

  patchLinkHover() {
    let plugin = this;
    let InternalPlugins = this.app.internalPlugins.plugins["page-preview"].instance.constructor;
    let uninstaller = around(InternalPlugins.prototype, {
      onLinkHover(old: any) {
        return function (
          parent: HoverEditorParent,
          targetEl: HTMLElement,
          linkText: string,
          path: string,
          state: unknown,
          ...args: any[]
        ) {
          onLinkHover(plugin, old, parent, targetEl, linkText, path, state, ...args);
        };
      },
    });
    this.register(uninstaller);
  }

  registerContextMenuHandler() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => {
        if (source === "pane-more-options" && leaf instanceof HoverLeaf) {
          // there's not a great way to remove native items from the context menu... so we hack it
          menu.items
            .filter((item: MenuItem) =>
              item.iconEl.querySelector(
                "svg[class$='-split'], svg[class^='links-'], svg.dot-network, svg.pin, svg.link, svg.bullet-list"
              )
            )
            .forEach(item => {
              menu.dom.removeChild(item.dom);
            });
          leaf.popover.isMenuActive = true;
          menu.hideCallback = function () {
            setTimeout(() => {
              leaf.popover.isMenuActive = false;
            }, 1000);
          };
        }
      })
    );
  }

  registerActivePopoverHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", leaf => {
        document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
        if (leaf instanceof HoverLeaf) {
          leaf.popover.hoverEl.addClass("is-active");
        }
      })
    );
  }

  acquireActivePopoverArray() {
    let plugin = this;
    // hack to get at the internal array that holds the active popover instances
    // maybe only run kick this of on initial link hover
    let uninstall = around(Array.prototype, {
      // @ts-ignore
      some(old: any) {
        return function (...items: any[]) {
          if (this.first() instanceof HoverPopover) {
            plugin.activePopovers = this;
            uninstall();
          }
          return old.call(this, ...items);
        };
      },
    });
    this.register(uninstall);
  }

  onunload(): void {
    // TODO: close all active popovers?
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerSettingsTab() {
    this.settingsTab = new SettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
  }
}

function onLinkHover(
  plugin: HoverEditorPlugin,
  old: Function,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: unknown,
  ...args: any[]
) {
  let hoverPopover = parent.hoverPopover;
  if (!(hoverPopover && hoverPopover.state !== PopoverState.Hidden && hoverPopover.targetEl === targetEl)) {
    hoverPopover = new HoverEditor(parent, targetEl, plugin);

    setTimeout(async () => {
      if (hoverPopover.state == PopoverState.Hidden) {
        return;
      }

      //@ts-ignore the official API has no contructor for WorkspaceSplit
      let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

      let leaf = new HoverLeaf(this.app, plugin, parent);

      hoverPopover.attachLeaf(leaf, split);

      let result = await leaf.openLink(linkText, path);

      if (!result) {
        leaf.detach();
        return old.call(this, parent, targetEl, linkText, path, oldState, ...args);
      }

      if (hoverPopover.state == PopoverState.Shown) {
        hoverPopover.position();
      }
      // enable this and take heap dumps to check for leaks
      // // @ts-ignore
      // hoverPopover.hoverEl.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // hoverPopover.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.leafMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.view.leafViewMemLeak = new Uint8Array(1024 * 1024 * 10);
    }, plugin.settings.triggerDelay);
  }
}

export function genId(size: number) {
  for (var e = [], n = 0; n < size; n++) e.push(((16 * Math.random()) | 0).toString(16));
  return e.join("");
}
