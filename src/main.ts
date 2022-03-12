import { around } from "monkey-around";
import {
  debounce,
  HoverEditorParent,
  HoverPopover,
  MarkdownView,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  SplitDirection,
  TAbstractFile,
  Workspace,
  WorkspaceLeaf,
  WorkspaceSplit,
} from "obsidian";
import { HoverLeaf } from "./leaf";
import { onLinkHover } from "./onLinkHover";
import { HoverEditor } from "./popover";
import { DEFAULT_SETTINGS, HoverEditorSettings, SettingTab } from "./settings/settings";

export default class HoverEditorPlugin extends Plugin {
  activePopovers: HoverEditor[];
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
      this.registerViewportResizeHandler();
      this.registerContextMenuHandler();
      this.registerCommands();
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
          let paneReliefLoaded = this.app.plugins.plugins["pane-relief"]?._loaded;
          if (!paneReliefLoaded && leaf instanceof HoverLeaf) return;
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
      createLeafBySplit(old: any) {
        return function (leaf: WorkspaceLeaf, direction: string, hasChildren: boolean, ...args: any[]) {
          if (leaf instanceof HoverLeaf) {
            let newLeaf = new HoverLeaf(this.app, this, leaf.hoverParent);
            this.splitLeaf(leaf, newLeaf, direction, hasChildren);
            newLeaf.popover = leaf.popover;
            return newLeaf;
          }
          return old.call(this, leaf, direction, hasChildren, ...args);
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

    // This will recycle the event handlers so that they pick up the patched onLinkHover method
    this.app.internalPlugins.plugins["page-preview"].disable();
    this.app.internalPlugins.plugins["page-preview"].enable();

    plugin.register(function () {
      plugin.app.internalPlugins.plugins["page-preview"].disable();
      plugin.app.internalPlugins.plugins["page-preview"].enable();
    });
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
              if (leaf.popover) leaf.popover.isMenuActive = false;
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

  debouncedPopoverReflow = debounce(
    () => {
      this.activePopovers?.forEach(popover => {
        popover.interact.reflow({ name: "drag", axis: "xy" });
      });
    },
    100,
    true
  );

  registerViewportResizeHandler() {
    // we can't use the native obsidian onResize event because
    // it triggers for WAY more than just a main window resize
    window.addEventListener("resize", this.debouncedPopoverReflow);
    this.register(() => {
      window.removeEventListener("resize", this.debouncedPopoverReflow);
    });
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
    // immediately spawn a popover so we don't leave the array hook in place for longer than needed
    let parent = this.app.workspace.activeLeaf as unknown as HoverEditorParent;
    let popover = new HoverPopover(parent, parent.containerEl, 0);
    setTimeout(() => {
      popover.shouldShowChild(); // this is what calls Array.some()
      popover.hide();
    }, 10);
  }

  onunload(): void {
    [...this.activePopovers].forEach(popover => popover.explicitHide()); 
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerCommands() {
    this.addCommand({
      id: "open-new-popover",
      name: "Open new popover",
      checkCallback: (checking: boolean) => {
        let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!!activeView) {
          if (!checking) {
            let popover = this.spawnPopover();
            popover.leaf.togglePin(true);
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: "open-link-in-new-popover",
      name: "Open link under cursor in new popover",
      checkCallback: (checking: boolean) => {
        let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!!activeView) {
          if (!checking) {
            let token = activeView.editor.getClickableTokenAt(activeView.editor.getCursor());
            if (token?.type === "internal-link") {
              let pos = activeView.editor.posToOffset(token.start);
              let targetEl = activeView.editMode.cm.domAtPos(pos);
              let popover = this.spawnPopover();
              popover.leaf.togglePin(true);
              popover.leaf.openLink(token.text, activeView.file.path);
            }
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: "open-current-file-in-new-popover",
      name: "Open current file in new popover",
      checkCallback: (checking: boolean) => {
        let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!!activeView) {
          if (!checking) {
            let popover = this.spawnPopover();
            popover.leaf.togglePin(true);
            popover.leaf.openFile(activeView.file);
          }
          return true;
        }
        return false;
      },
    });
  }

  spawnPopover(initiatingEl?: HTMLElement) {
    let parent = this.app.workspace.activeLeaf as unknown as HoverEditorParent;
    if (!initiatingEl) initiatingEl = parent.containerEl;
    let hoverPopover = new HoverEditor(parent, initiatingEl, this);

    // @ts-ignore
    let split = new WorkspaceSplit(this.app.workspace, "horizontal");

    let leaf = new HoverLeaf(this.app, this, parent);

    hoverPopover.attachLeaf(leaf, split);
    return hoverPopover;
  }

  registerSettingsTab() {
    this.settingsTab = new SettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
  }
}

export function genId(size: number) {
  for (var e = [], n = 0; n < size; n++) e.push(((16 * Math.random()) | 0).toString(16));
  return e.join("");
}
