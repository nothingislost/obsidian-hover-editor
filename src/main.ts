import { around } from "monkey-around";
import {
  App,
  debounce,
  EphemeralState,
  ItemView,
  MarkdownView,
  Menu,
  Platform,
  Plugin,
  PopoverState,
  TAbstractFile,
  TFile,
  ViewState,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";

import { onLinkHover } from "./onLinkHover";
import { HoverEditorParent, HoverEditor, isHoverLeaf, setMouseCoords } from "./popover";
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
    this.patchQuickSwitcher();
    this.patchWorkspaceLeaf();
    this.patchItemView();

    await this.loadSettings();
    this.registerSettingsTab();

    this.app.workspace.onLayoutReady(() => {
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
    this.register(
      around(WorkspaceLeaf.prototype, {
        getRoot(old) {
          return function () {
            const top = old.call(this);
            return top.getRoot === this.getRoot ? top : top.getRoot();
          };
        },
        onResize(old) {
          return function () {
            this.view?.onResize();
          };
        },
        setViewState(old) {
          return async function (viewState: ViewState, eState?: unknown) {
            const result = await old.call(this, viewState, eState);
            // try and catch files that are opened from outside of the
            // HoverEditor class so that we can update the popover title bar
            try {
              const he = HoverEditor.forLeaf(this);
              if (he) {
                if (viewState.type) he.hoverEl.setAttribute("data-active-view-type", viewState.type);
                const titleEl = he.hoverEl.querySelector(".popover-title");
                if (titleEl) {
                  titleEl.textContent = this.view?.getDisplayText();
                  if (this.view?.file?.path) {
                    titleEl.setAttribute("data-path", this.view.file.path);
                  } else {
                    titleEl.removeAttribute("data-path");
                  }
                }
              }
            } catch {}
            return result;
          };
        },
        setEphemeralState(old) {
          return function (state: EphemeralState) {
            old.call(this, state);
            if (state.focus && this.view?.getViewType() === "empty") {
              // Force empty (no-file) view to have focus so dialogs don't reset active pane
              this.view.contentEl.tabIndex = -1;
              this.view.contentEl.focus();
            }
          };
        },
      }),
    );
  }

  patchQuickSwitcher() {
    const plugin = this;
    const { QuickSwitcherModal } = this.app.internalPlugins.plugins.switcher.instance;
    const uninstaller = around(QuickSwitcherModal.prototype, {
      open(old) {
        return function () {
          const result = old.call(this);
          this.setInstructions([
            {
              command: Platform.isMacOS ? "cmd p" : "ctrl p",
              purpose: "to open in new popover",
            },
          ]);
          this.scope.register(["Mod"], "p", (event: KeyboardEvent) => {
            this.close();
            const item = this.chooser.values[this.chooser.selectedItem];
            if (!item?.file) return;
            const newLeaf = plugin.spawnPopover(undefined, () =>
              this.app.workspace.setActiveLeaf(newLeaf, false, true),
            );
            newLeaf.openFile(item.file);
            return false;
          });
          return result;
        };
      },
    });
    this.register(uninstaller);
  }

  patchItemView() {
    const plugin = this;
    const uninstaller = around(ItemView.prototype, {
      onMoreOptionsMenu(old) {
        return function (menu: Menu, ...args: unknown[]) {
          const popover = this.leaf ? HoverEditor.forLeaf(this.leaf) : undefined;
          if (!popover) {
            menu.addItem(item => {
              item
                .setIcon("popup-open")
                .setTitle("Open in Hover Editor")
                .onClick(() => {
                  const newLeaf = plugin.spawnPopover();
                  if (this.leaf?.getViewState) newLeaf.setViewState(this.leaf.getViewState());
                });
            });
          }
          return old.call(this, menu, ...args);
        };
      },
    });
    this.register(uninstaller);
  }

  patchWorkspace() {
    const uninstaller = around(Workspace.prototype, {
      recordHistory(old) {
        return function (leaf: WorkspaceLeaf, pushHistory: boolean, ...args: unknown[]) {
          const paneReliefLoaded = this.app.plugins.plugins["pane-relief"]?._loaded;
          if (!paneReliefLoaded && isHoverLeaf(leaf)) return;
          return old.call(this, leaf, pushHistory, ...args);
        };
      },
      iterateAllLeaves(old) {
        return function (cb) {
          this.iterateRootLeaves(cb);
          this.iterateLeaves(cb, this.leftSplit);
          this.iterateLeaves(cb, this.rightSplit);
        };
      },
      iterateRootLeaves(old) {
        return function (callback: (leaf: WorkspaceLeaf) => unknown) {
          return old.call(this, callback) || HoverEditor.iteratePopoverLeaves(this, callback);
        };
      },
      getDropLocation(old) {
        return function getDropLocation(event: MouseEvent) {
          for (const popover of HoverEditor.activePopovers()) {
            const dropLoc = this.recursiveGetTarget(event, popover.rootSplit);
            if (dropLoc) return { target: dropLoc, sidedock: false };
          }
          return old.call(this, event);
        };
      },
      onDragLeaf(old) {
        return function (event: MouseEvent, leaf: WorkspaceLeaf) {
          const hoverPopover = HoverEditor.forLeaf(leaf);
          hoverPopover?.togglePin(true);
          return old.call(this, event, leaf);
        };
      },
    });
    this.register(uninstaller);
  }

  patchSlidingPanes() {
    const SlidingPanesPlugin = this.app.plugins.plugins["sliding-panes-obsidian"]?.constructor;
    if (SlidingPanesPlugin) {
      const uninstaller = around(SlidingPanesPlugin.prototype, {
        handleFileOpen(old: Function) {
          return function (...args: unknown[]) {
            // sliding panes needs to ignore popover open events or else it freaks out
            if (isHoverLeaf(this.app.workspace.activeLeaf)) return;
            return old.call(this, ...args);
          };
        },
        handleLayoutChange(old: Function) {
          return function (...args: unknown[]) {
            // sliding panes needs to ignore popovers or else it activates the wrong pane
            if (isHoverLeaf(this.app.workspace.activeLeaf)) return;
            return old.call(this, ...args);
          };
        },
        focusActiveLeaf(old: Function) {
          return function (...args: unknown[]) {
            // sliding panes tries to add popovers to the root split if we don't exclude them
            if (isHoverLeaf(this.app.workspace.activeLeaf)) return;
            return old.call(this, ...args);
          };
        },
      });
      this.register(uninstaller);
    }
  }

  patchLinkHover() {
    const plugin = this;
    const pagePreviewPlugin = this.app.internalPlugins.plugins["page-preview"];
    if (!pagePreviewPlugin.enabled) return;
    const uninstaller = around(pagePreviewPlugin.instance.constructor.prototype, {
      onHoverLink(old: Function) {
        return function (options: { event: MouseEvent }, ...args: unknown[]) {
          if (options && options.event instanceof MouseEvent) setMouseCoords(options.event);
          return old.call(this, options, ...args);
        };
      },
      onLinkHover(old: Function) {
        return function (
          parent: HoverEditorParent,
          targetEl: HTMLElement,
          linkText: string,
          path: string,
          state: EphemeralState,
          ...args: unknown[]
        ) {
          onLinkHover(plugin, parent, targetEl, linkText, path, state, ...args);
        };
      },
    });
    this.register(uninstaller);

    // This will recycle the event handlers so that they pick up the patched onLinkHover method
    pagePreviewPlugin.disable();
    pagePreviewPlugin.enable();

    plugin.register(function () {
      if (!pagePreviewPlugin.enabled) return;
      pagePreviewPlugin.disable();
      pagePreviewPlugin.enable();
    });
  }

  registerContextMenuHandler() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => {
        const popover = leaf ? HoverEditor.forLeaf(leaf) : undefined;
        if (file instanceof TFile && !popover && !leaf) {
          menu.addItem(item => {
            item
              .setIcon("popup-open")
              .setTitle("Open in Hover Editor")
              .onClick(() => {
                const newLeaf = this.spawnPopover();
                newLeaf.openFile(file);
              });
          });
        }
      }),
    );
  }

  registerActivePopoverHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", leaf => {
        document.querySelector("body > .popover.hover-popover.is-active")?.removeClass("is-active");
        const hoverEditor = leaf ? HoverEditor.forLeaf(leaf) : undefined;
        if (hoverEditor && leaf) {
          hoverEditor.hoverEl.addClass("is-active");
          const titleEl = hoverEditor.hoverEl.querySelector(".popover-title");
          if (!titleEl) return;
          titleEl.textContent = leaf.view?.getDisplayText();
          if (leaf?.view?.getViewType()) {
            hoverEditor.hoverEl.setAttribute("data-active-view-type", leaf.view.getViewType());
          }
          if (leaf.view?.file?.path) {
            titleEl.setAttribute("data-path", leaf.view.file.path);
          } else {
            titleEl.removeAttribute("data-path");
          }
        }
      }),
    );
  }

  registerFileRenameHandler() {
    this.app.vault.on("rename", (file, oldPath) => {
      HoverEditor.iteratePopoverLeaves(this.app.workspace, leaf => {
        if (file === leaf?.view?.file && file instanceof TFile) {
          const hoverEditor = HoverEditor.forLeaf(leaf);
          if (hoverEditor?.hoverEl) {
            const titleEl = hoverEditor.hoverEl.querySelector(".popover-title");
            if (!titleEl) return;
            const filePath = titleEl.getAttribute("data-path");
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
        popover.interact?.reflow({ name: "drag", axis: "xy" });
      });
    },
    100,
    true,
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
    const leaf = new (WorkspaceLeaf as new (app: App) => WorkspaceLeaf)(this.app);
    const view = this.app.internalPlugins.plugins.graph.views.localgraph(leaf);
    const GraphEngine = view.engine.constructor;
    leaf.detach(); // close the view
    view.renderer?.worker?.terminate(); // ensure the worker is terminated
    const uninstall = around(GraphEngine.prototype, {
      onNodeHover(old: Function) {
        return function (event: UIEvent, linkText: string, nodeType: string, ...items: unknown[]) {
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
    HoverEditor.activePopovers().forEach(popover => popover.hide());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerCommands() {
    this.addCommand({
      id: "bounce-popovers",
      name: "Toggle bouncing popovers",
      callback: () => {
        this.activePopovers.forEach(popover => {
          popover.toggleBounce();
        });
      },
    });
    this.addCommand({
      id: "open-new-popover",
      name: "Open new popover",
      callback: () => {
        // Focus the leaf after it's shown
        const newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
      },
    });
    this.addCommand({
      id: "open-link-in-new-popover",
      name: "Open link under cursor in new popover",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
          if (!checking) {
            const token = activeView.editor.getClickableTokenAt(activeView.editor.getCursor());
            if (token?.type === "internal-link") {
              const newLeaf = this.spawnPopover(undefined, () =>
                this.app.workspace.setActiveLeaf(newLeaf, false, true),
              );
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
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
          if (!checking) {
            const newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
            newLeaf.openFile(activeView.file);
          }
          return true;
        }
        return false;
      },
    });
  }

  spawnPopover(initiatingEl?: HTMLElement, onShowCallback?: () => unknown): WorkspaceLeaf {
    const parent = this.app.workspace.activeLeaf as unknown as HoverEditorParent;
    if (!initiatingEl) initiatingEl = parent.containerEl;
    const hoverPopover = new HoverEditor(parent, initiatingEl!, this, undefined, onShowCallback);
    hoverPopover.togglePin(true);
    return hoverPopover.attachLeaf();
  }

  registerSettingsTab() {
    this.settingsTab = new SettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
  }
}

export function genId(size: number) {
  const chars = [];
  for (let n = 0; n < size; n++) chars.push(((16 * Math.random()) | 0).toString(16));
  return chars.join("");
}
