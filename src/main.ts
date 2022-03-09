import { around } from "monkey-around";
import {
  debounce,
  HoverEditorParent,
  HoverPopover,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  TAbstractFile,
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
      this.patchSlidingPanes();

      this.patchLinkHover();
    });
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
          delayedOnLinkHover(plugin, old, parent, targetEl, linkText, path, state, ...args);
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
        if (leaf instanceof HoverLeaf) {
          document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
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

let delayedOnLinkHover = debounce(onLinkHover, 400, true);

async function onLinkHover(
  plugin: HoverEditorPlugin,
  old: Function,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: unknown,
  ...args: any[]
) {
  if (parent.hoverPopover) {
    return old.call(this, parent, targetEl, linkText, path, oldState, ...args);
  }

  //@ts-ignore the official API has no contructor for WorkspaceSplit
  let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

  let leaf = new HoverLeaf(this.app, plugin, parent);

  let result = await leaf.openLink(linkText, path);

  if (!result) {
    leaf.detach();
    return old.call(this, parent, targetEl, linkText, path, oldState, ...args);
  }

  let popover = new HoverEditor(parent, targetEl, this.app, leaf, split);

  // enable this and take a heap dump to look for leaks
  // // @ts-ignore
  // popover.hoverEl.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // popover.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // leaf.leafMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // leaf.view.leafViewMemLeak = new Uint8Array(1024 * 1024 * 10);
}

export function genId(size: number) {
  for (var e = [], n = 0; n < size; n++) e.push(((16 * Math.random()) | 0).toString(16));
  return e.join("");
}
