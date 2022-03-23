import { around } from "monkey-around";
import {
  debounce,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  PopoverState,
  SplitDirection,
  TAbstractFile,
  TFile,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { onLinkHover } from "./onLinkHover";
import { HoverEditorParent, HoverEditor, isHoverLeaf } from "./popover";
import { DEFAULT_SETTINGS, HoverEditorSettings, SettingTab } from "./settings/settings";

export default class HoverEditorPlugin extends Plugin {
  settings: HoverEditorSettings;
  settingsTab: SettingTab;

  async onload() {
    this.registerActivePopoverHandler();
    this.registerFileRenameHandler();
    this.registerViewportResizeHandler();
    this.registerContextMenuHandler();
    this.registerCommands();
    this.patchUnresolvedGraphNodeHover();
    this.patchWorkspace();
    this.patchWorkspaceLeaf();

    await this.loadSettings();
    this.registerSettingsTab();

    this.app.workspace.onLayoutReady(() => {
      if (!this.app.internalPlugins.plugins["page-preview"]._loaded) {
        new Notice(
          "The Hover Editor plugin requires that 'Page preview' be enabled. You can enable 'Page preview' under 'Settings -> Core plugins'.",
          30000
        );
      }
      this.patchSlidingPanes();
      this.patchLinkHover();
    });
  }

  get activePopovers(): HoverEditor[] {
    return HoverEditor.activePopovers();
  }

  patchWorkspaceLeaf() {
    this.register(around(WorkspaceLeaf.prototype, {
      getRoot(old) { return function() {
        const top = old.call(this);
        return (top.getRoot === this.getRoot) ? top : top.getRoot();
      }},
      onResize(old) { return function() { this.view?.onResize(); } },
      updateHeader(old) { return function() {
        old.call(this); HoverEditor.forLeaf(this)?.updateLeaves();
      }},
      setEphemeralState(old) {
        return function (state: any) {
          old.call(this, state);
          if (state.focus && this.view?.getViewType() === "empty") {
            // Force empty (no-file) view to have focus so dialogs don't reset active pane
            this.view.contentEl.tabIndex = -1;
            this.view.contentEl.focus();
          }
        }
      }
    }));
  }

  patchWorkspace() {
    let uninstaller = around(Workspace.prototype, {
      recordHistory(old: any) {
        return function (leaf: WorkspaceLeaf, pushHistory: boolean, ...args: any[]) {
          let paneReliefLoaded = this.app.plugins.plugins["pane-relief"]?._loaded;
          if (!paneReliefLoaded && isHoverLeaf(leaf)) return;
          return old.call(this, leaf, pushHistory, ...args);
        };
      },
      iterateAllLeaves(old) {
        return function(cb) {
          this.iterateRootLeaves(cb);
          this.iterateLeaves(cb, this.leftSplit);
          this.iterateLeaves(cb, this.rightSplit);
        }
      },
      iterateRootLeaves(old) {
        return function(callback: (leaf: WorkspaceLeaf) => any) {
          return old.call(this, callback) || HoverEditor.iteratePopoverLeaves(this, callback);
        }
      },
      getDropLocation(old) {
        return function getDropLocation(event: MouseEvent) {
          for (const popover of HoverEditor.activePopovers()) {
              const dropLoc = this.recursiveGetTarget(event, popover.rootSplit);
              if (dropLoc) return {target: dropLoc, sidedock: false};
          }
          return old.call(this, event);
        }
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
            if (isHoverLeaf(this.app.workspace.activeLeaf)) return;
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
        const popover = HoverEditor.forLeaf(leaf);
        if (source === "pane-more-options" && popover) {
          popover.activeMenu = menu;
          menu.hideCallback = function () {
            setTimeout(() => {
              if (popover?.activeMenu === menu) popover.activeMenu = null;
            }, 1000);
          };
        }
        if (file instanceof TFile && !popover) {
          // Use this way to hover panel, so that we can hover backlink panel now.
          menu.addItem(item => {
            item
              .setIcon("popup-open")
              .setTitle("Open in new popover")
              .onClick(() => {
                let newLeaf = this.spawnPopover();
                if (!leaf) {
                  newLeaf.openFile(file);
                }
                leaf?.getViewState && newLeaf.setViewState(leaf.getViewState());
              });

          });
        }
      })
    );
  }

  registerActivePopoverHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", leaf => {
        document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
        let hoverLeaf = HoverEditor.forLeaf(leaf);
        if (hoverLeaf) {
          hoverLeaf.hoverEl.addClass("is-active");
          hoverLeaf.hoverEl.querySelector(".popover-title").textContent = (leaf.view as any)?.file?.basename;
        }
      })
    );
  }

  registerFileRenameHandler() {
    this.app.vault.on("rename", file => {
      HoverEditor.iteratePopoverLeaves(this.app.workspace, (leaf) => {
        if (file === leaf?.view?.file && leaf.view.file instanceof TFile) {
          let hoverLeaf = HoverEditor.forLeaf(leaf);
          if (hoverLeaf?.hoverEl) {
            hoverLeaf.hoverEl.querySelector(".popover-title").textContent = leaf.view.file.basename;
          }
        }
      })
    })
  }

  debouncedPopoverReflow = debounce(
    () => {
      HoverEditor.activePopovers().forEach(popover => {
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

  patchUnresolvedGraphNodeHover() {
    // @ts-ignore
    let leaf = new WorkspaceLeaf(this.app);
    // @ts-ignore
    let GraphEngine = this.app.internalPlugins.plugins.graph.views.localgraph(leaf).engine.constructor;
    let uninstall = around(GraphEngine.prototype, {
      // @ts-ignore
      onNodeHover(old: any) {
        return function (event: UIEvent, linkText: string, nodeType: string, ...items: any[]) {
          if (nodeType === "unresolved") {
            if ((this.onNodeUnhover(), event instanceof MouseEvent)) {
              if (
                this.hoverPopover &&
                this.hoverPopover.state !== PopoverState.Hidden &&
                this.lastHoverLink === linkText
              ) {
                this.hoverPopover.onTarget = true;
                return void this.hoverPopover.transition();
              }
              this.lastHoverLink = linkText;
              this.app.workspace.trigger("hover-link", {
                event: event,
                source: "graph",
                hoverParent: this,
                targetEl: null,
                linktext: linkText,
              });
            }
          } else {
            return old.call(this, event, linkText, nodeType, ...items);
          }
        };
      },
    });
    this.register(uninstall);
    leaf.detach();
  }

  onunload(): void {
    HoverEditor.activePopovers().forEach(popover => popover.explicitHide());
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
      callback: () => {
        // Focus the leaf after it's shown
        let newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
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
              this.spawnPopover().openLinkText(token.text, activeView.file.path, {active: true, eState: {focus: true}});
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
            this.spawnPopover().openFile(activeView.file, { active: true, eState: { focus: true } });
          }
          return true;
        }
        return false;
      },
    });
  }

  spawnPopover(initiatingEl?: HTMLElement, onShowCallback?: () => any): WorkspaceLeaf {
    let parent = this.app.workspace.activeLeaf as unknown as HoverEditorParent;
    if (!initiatingEl) initiatingEl = parent.containerEl;
    let hoverPopover = new HoverEditor(parent, initiatingEl, this, undefined, onShowCallback);
    hoverPopover.togglePin(true);
    return hoverPopover.attachLeaf();
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
