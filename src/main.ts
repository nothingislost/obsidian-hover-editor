import { around } from "monkey-around";
import {
  App,
  debounce,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  PopoverState,
  TAbstractFile,
  TFile,
  ViewState,
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
      setTimeout(() => {
        // workaround to ensure our plugin shows up properly within Style Settings
        this.app.workspace.trigger("css-change");
      }, 2000);
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
      setViewState(old) {
        return async function (viewState: ViewState, eState?: any) {
          let result = await old.call(this, viewState, eState);
          // try and catch files that are opened from outside of the
          // HoverEditor class so that we can update the popover title bar
          try {
            let he = HoverEditor.forLeaf(this);
            if (he) {
              viewState.type && he.hoverEl.setAttribute("data-active-view-type", viewState.type);
              let titleEl = he.hoverEl.querySelector(".popover-title");
              titleEl.textContent = this.view?.getDisplayText();
              if (this.view?.file?.path) {
                titleEl.setAttribute("data-path", this.view.file.path);
              } else {
                titleEl.removeAttribute("data-path");
              }
            }
          } catch {}
          return result;
        };
      },
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
      onDragLeaf(old) {
        return function(event: MouseEvent, leaf: WorkspaceLeaf) {
          let hoverPopover = HoverEditor.forLeaf(leaf);
          hoverPopover?.togglePin(true);
          return old.call(this, event, leaf);
        }
      }
    });
    this.register(uninstaller);
  }

  patchSlidingPanes() {
    let SlidingPanesPlugin = this.app.plugins.plugins["sliding-panes-obsidian"]?.constructor;
    if (SlidingPanesPlugin) {
      let uninstaller = around(SlidingPanesPlugin.prototype, {
        handleFileOpen(old: any) {
          return function (...args: any[]) {
            // sliding panes needs to ignore popover open events or else it freaks out
            if (isHoverLeaf(this.app.workspace.activeLeaf)) return;
            return old.call(this, ...args);
          }
        },
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
        let hoverEditor = HoverEditor.forLeaf(leaf);
        if (hoverEditor) {
          hoverEditor.hoverEl.addClass("is-active");
          let titleEl = hoverEditor.hoverEl.querySelector(".popover-title");
          titleEl.textContent = leaf.view?.getDisplayText();
          leaf.view?.getViewType() && hoverEditor.hoverEl.setAttribute("data-active-view-type", leaf.view.getViewType());
          if (leaf.view?.file?.path) {
            titleEl.setAttribute("data-path", leaf.view.file.path);
          } else {
            titleEl.removeAttribute("data-path");
          }
        }
      })
    );
  }

  registerFileRenameHandler() {
    this.app.vault.on("rename", (file, oldPath) => {
      HoverEditor.iteratePopoverLeaves(this.app.workspace, leaf => {
        if (file === leaf?.view?.file && file instanceof TFile) {
          let hoverEditor = HoverEditor.forLeaf(leaf);
          if (hoverEditor?.hoverEl) {
            let titleEl = hoverEditor.hoverEl.querySelector(".popover-title");
            let filePath = titleEl.getAttribute("data-path");
            if (oldPath === filePath) {
              titleEl.textContent = leaf.view?.getDisplayText();
              titleEl.setAttribute("data-path", file.path);
            }
          }
        }
      });
    });
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
    let leaf = new (WorkspaceLeaf as new (app: App) => WorkspaceLeaf)(this.app);
    let view: any = (this.app.internalPlugins.plugins.graph as any).views.localgraph(leaf)
    let GraphEngine = view.engine.constructor;
    leaf.detach(); // close the view
    view.renderer?.worker?.terminate(); // ensure the worker is terminated
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
              let newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
              newLeaf.openLinkText(token.text, activeView.file.path);
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
            let newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
            newLeaf.openFile(activeView.file);
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
