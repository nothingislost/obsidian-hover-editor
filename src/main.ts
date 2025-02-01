import { around } from "monkey-around";
import {
  App,
  debounce,
  EphemeralState,
  HoverParent,
  ItemView,
  MarkdownPreviewRenderer,
  MarkdownPreviewRendererStatic,
  MarkdownPreviewView,
  MarkdownView,
  Menu,
  parseLinktext,
  Platform,
  Plugin,
  PopoverState,
  requireApiVersion,
  setIcon,
  setTooltip,
  TAbstractFile,
  TFile,
  View,
  ViewState,
  Workspace,
  WorkspaceContainer,
  WorkspaceItem,
  WorkspaceLeaf,
} from "obsidian";

import { onLinkHover } from "./onLinkHover";
import { PerWindowComponent, use } from "@ophidian/core";
import { HoverEditorParent, HoverEditor, isHoverLeaf, setMouseCoords } from "./popover";
import { DEFAULT_SETTINGS, HoverEditorSettings, SettingTab } from "./settings/settings";
import { snapActivePopover, snapDirections, restoreActivePopover, minimizeActivePopover } from "./utils/measure";
import { Scope } from "@interactjs/types";
import interactStatic from "@nothingislost/interactjs";
import { isA } from "./utils/misc";

class Interactor extends PerWindowComponent {
  interact = this.createInteractor();
  plugin = this.use(HoverEditorPlugin);

  createInteractor() {
    if (this.win === window) return interactStatic;
    const oldScope = (interactStatic as unknown as { scope: Scope }).scope;
    const newScope = new (oldScope.constructor as new () => Scope)();
    const interact = newScope.init(this.win).interactStatic;
    for (const plugin of oldScope._plugins.list) interact.use(plugin);
    return interact;
  }

  onload() {
    this.win.addEventListener("resize", this.plugin.debouncedPopoverReflow);
  }

  onunload() {
    this.win.removeEventListener("resize", this.plugin.debouncedPopoverReflow);
    try {
      this.interact.removeDocument(this.win.document);
    } catch (e) {
      // Sometimes, interact.removeDocument fails when the plugin unloads in 0.14.x:
      // Don't let it stop the plugin from fully unloading
      console.error(e);
    }
  }
}

export default class HoverEditorPlugin extends Plugin {
  use = use.plugin(this);
  interact = this.use(Interactor);
  settings: HoverEditorSettings;

  settingsTab: SettingTab;

  async onload() {
    this.registerActivePopoverHandler();
    this.registerFileRenameHandler();
    this.registerContextMenuHandler();
    this.registerCommands();
    this.patchUnresolvedGraphNodeHover();
    this.patchWorkspace();
    this.patchQuickSwitcher();
    this.patchWorkspaceLeaf();
    this.patchItemView();
    this.patchMarkdownPreviewRenderer();
    this.patchMarkdownPreviewView();

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
    this.register(
      around(WorkspaceItem.prototype, {
        getContainer(old) {
          return function () {
            if (!old) return; // 0.14.x doesn't have this
            if (!this.parentSplit || this instanceof WorkspaceContainer) return old.call(this);
            return this.parentSplit.getContainer();
          };
        },
      })
    );
  }

  patchQuickSwitcher() {
    const plugin = this;
    const { QuickSwitcherModal } = this.app.internalPlugins.plugins.switcher.instance;
    const uninstaller = around(QuickSwitcherModal.prototype, {
      open(old) {
        return function () {
          const result = old.call(this);
          if (this.instructionsEl) {
            // Obsidian 1.6 deletes existing instructions on setInstructions(),
            // so patch the element to not empty(); setTimeout will remove the
            // patch once the current event is over
            setTimeout(around(this.instructionsEl, {
              empty(next) {
                return () => {};
              }
            }), 0);
          }
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
    // Once 0.15.3+ is min. required Obsidian, this can be simplified to View + "onPaneMenu"
    const [cls, method] = View.prototype["onPaneMenu"] ? [View, "onPaneMenu"] : [ItemView, "onMoreOptionsMenu"];
    const uninstaller = around(cls.prototype, {
      [method](old: (menu: Menu, ...args: unknown[]) => void) {
        return function (this: View, menu: Menu, ...args: unknown[]) {
          const popover = this.leaf ? HoverEditor.forLeaf(this.leaf) : undefined;
          if (!popover) {
            menu.addItem(item => {
              item
                .setIcon("popup-open")
                .setTitle("Open in Hover Editor")
                .onClick(async () => {
                  const newLeaf = plugin.spawnPopover(), {autoFocus} = plugin.settings;
                  await newLeaf.setViewState({...this.leaf.getViewState(), active: autoFocus}, {focus: autoFocus});
                  if (autoFocus) {
                    await sleep(200)
                    this.app.workspace.setActiveLeaf(newLeaf, {focus: true});
                  }
                })
                .setSection?.("open");
            });
            menu.addItem(item => {
              item
                .setIcon("popup-open")
                .setTitle("Convert to Hover Editor")
                .onClick(() => {
                  plugin.convertLeafToPopover(this.leaf);
                })
                .setSection?.("open");
            });
          } else {
            menu.addItem(item => {
              item
                .setIcon("popup-open")
                .setTitle("Dock Hover Editor to workspace")
                .onClick(() => {
                  plugin.dockPopoverToWorkspace(this.leaf);
                })
                .setSection?.("open");
            });
          }
          return old.call(this, menu, ...args);
        };
      },
    });
    this.register(uninstaller);

    // Restore pre-1.6 view header icons so you can drag hover editor leaves back to the workspace
    this.register(around(ItemView.prototype, {
      load(old) {
        return function(this: View) {
          if (!this.iconEl) {
            const iconEl = this.iconEl = this.headerEl.createDiv("clickable-icon view-header-icon")
            this.headerEl.prepend(iconEl)
            iconEl.draggable = true
            iconEl.addEventListener("dragstart", e => { this.app.workspace.onDragLeaf(e, this.leaf) })
            setIcon(iconEl, this.getIcon())
            setTooltip(iconEl, "Drag to rearrange")
          }
          return old.call(this)
        }
      }
    }))
  }

  patchMarkdownPreviewView() {
    // Prevent erratic scrolling of preview views when workspace layout changes
    this.register(around(MarkdownPreviewView.prototype, {
      onResize(old) {
        return function onResize() {
          this.renderer.onResize();
          if (this.view.scroll !== null && this.view.scroll !== this.getScroll()) {
            this.renderer.applyScrollDelayed(this.view.scroll)
          }
        }
      }
    }))
  }

  patchMarkdownPreviewRenderer() {
    const plugin = this;
    const uninstaller = around(MarkdownPreviewRenderer as MarkdownPreviewRendererStatic, {
      registerDomEvents(old: Function) {
        return function (
          el: HTMLElement,
          instance: { getFile?(): TFile; hoverParent?: HoverParent, info?: HoverParent & { getFile(): TFile} },
          ...args: unknown[]
        ) {
          el?.on("mouseover", ".internal-embed.is-loaded", (event: MouseEvent, targetEl: HTMLElement) => {
            if (targetEl && plugin.settings.hoverEmbeds) {
              app.workspace.trigger("hover-link", {
                event: event,
                source: targetEl.matchParent(".markdown-source-view") ? "editor" : "preview",
                hoverParent: instance.hoverParent ?? instance.info,
                targetEl: targetEl,
                linktext: targetEl.getAttribute("src"),
                sourcePath: (instance.info ?? instance).getFile?.()?.path || "",
              });
            }
          });
          return old.call(this, el, instance, ...args);
        };
      },
    });
    this.register(uninstaller);
  }

  patchWorkspace() {
    let layoutChanging = false;
    const uninstaller = around(Workspace.prototype, {
      changeLayout(old) {
        return async function (workspace: unknown) {
          layoutChanging = true;
          try {
            // Don't consider hover popovers part of the workspace while it's changing
            await old.call(this, workspace);
          } finally {
            layoutChanging = false;
          }
        };
      },
      recordHistory(old) {
        return function (leaf: WorkspaceLeaf, pushHistory: boolean, ...args: unknown[]) {
          const paneReliefLoaded = this.app.plugins.plugins["pane-relief"]?._loaded;
          if (!paneReliefLoaded && isHoverLeaf(leaf)) return;
          return old.call(this, leaf, pushHistory, ...args);
        };
      },
      iterateLeaves(old) {
        type leafIterator = (item: WorkspaceLeaf) => boolean | void;
        return function (arg1, arg2) {
          // Fast exit if desired leaf found
          if (old.call(this, arg1, arg2)) return true;

          // Handle old/new API parameter swap
          let cb:     leafIterator  = (typeof arg1 === "function" ? arg1 : arg2) as leafIterator;
          let parent: WorkspaceItem = (typeof arg1 === "function" ? arg2 : arg1) as WorkspaceItem;

          if (!parent) return false;  // <- during app startup, rootSplit can be null
          if (layoutChanging) return false;  // Don't let HEs close during workspace change

          // 0.14.x doesn't have WorkspaceContainer; this can just be an instanceof check once 15.x is mandatory:
          if (parent === app.workspace.rootSplit || (WorkspaceContainer && parent instanceof WorkspaceContainer)) {
            for(const popover of HoverEditor.popoversForWindow((parent as WorkspaceContainer).win)) {
              // Use old API here for compat w/0.14.x
              if (old.call(this, cb, popover.rootSplit)) return true;
            }
          }
          return false;
        };
      },
      getDropLocation(old) {
        return function getDropLocation(event: MouseEvent) {
          for (const popover of HoverEditor.activePopovers()) {
            const dropLoc: any = this.recursiveGetTarget(event, popover.rootSplit);
            if (dropLoc) {
              if (requireApiVersion && requireApiVersion("0.15.3")) {
                // getDropLocation's return signature changed in 0.15.3
                // it now only returns the target
                return dropLoc;
              } else {
                return { target: dropLoc, sidedock: false };
              }
            }
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
          if (options && isA(options.event, MouseEvent)) setMouseCoords(options.event);
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
          const {subpath} = parseLinktext(linkText);
          if (subpath && subpath[0] === "#") {
            if (subpath.startsWith("#[^")) {
              if (plugin.settings.footnotes !== "always") {
                return old.call(this, parent, targetEl, linkText, path, state, ...args);
              }
            } else if (subpath.startsWith("#^")) {
              if (plugin.settings.blocks !== "always") {
                return old.call(this, parent, targetEl, linkText, path, state, ...args);
              }
            } else {
              if (plugin.settings.headings !== "always") {
                return old.call(this, parent, targetEl, linkText, path, state, ...args);
              }
            }
          }
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
              })
              .setSection?.("open");
          });
        }
      }),
    );
  }

  registerActivePopoverHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", leaf => {
        HoverEditor.activePopover?.hoverEl.removeClass("is-active");
        const hoverEditor = (HoverEditor.activePopover = leaf ? HoverEditor.forLeaf(leaf) : undefined);
        if (hoverEditor && leaf) {
          hoverEditor.activate();
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
            if ((this.onNodeUnhover(), isA(event, MouseEvent))) {
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
      name: "Open new Hover Editor",
      callback: () => {
        // Focus the leaf after it's shown
        const newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
      },
    });
    this.addCommand({
      id: "open-link-in-new-popover",
      name: "Open link under cursor in new Hover Editor",
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
      name: "Open current file in new Hover Editor",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.activeEditor?.file ?? this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            const newLeaf = this.spawnPopover(undefined, () => this.app.workspace.setActiveLeaf(newLeaf, false, true));
            newLeaf.openFile(activeFile);
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: "convert-active-pane-to-popover",
      name: "Convert active pane to Hover Editor",
      checkCallback: (checking: boolean) => {
        const { activeLeaf } = this.app.workspace;
        if (activeLeaf) {
          if (!checking) {
            this.convertLeafToPopover(activeLeaf);
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: "dock-active-popover-to-workspace",
      name: "Dock active Hover Editor to workspace",
      checkCallback: (checking: boolean) => {
        const { activeLeaf } = this.app.workspace;
        if (activeLeaf && HoverEditor.forLeaf(activeLeaf)) {
          if (!checking) {
            this.dockPopoverToWorkspace(activeLeaf);
          }
          return true;
        }
        return false;
      },
    });
    this.addCommand({
      id: `restore-active-popover`,
      name: `Restore active Hover Editor`,
      checkCallback: (checking: boolean) => {
        return restoreActivePopover(checking);
      },
    });
    this.addCommand({
      id: `minimize-active-popover`,
      name: `Minimize active Hover Editor`,
      checkCallback: (checking: boolean) => {
        return minimizeActivePopover(checking);
      },
    });
    snapDirections.forEach(direction => {
      this.addCommand({
        id: `snap-active-popover-to-${direction}`,
        name: `Snap active Hover Editor to ${direction}`,
        checkCallback: (checking: boolean) => {
          return snapActivePopover(direction, checking);
        },
      });
    });
  }

  convertLeafToPopover(oldLeaf: WorkspaceLeaf) {
    if (!oldLeaf) return;
    const newLeaf = this.spawnPopover(undefined, () => {
      const { parentSplit: newParentSplit } = newLeaf;
      const { parentSplit: oldParentSplit } = oldLeaf;
      oldParentSplit.removeChild(oldLeaf);
      newParentSplit.replaceChild(0, oldLeaf, true);
      this.app.workspace.setActiveLeaf(oldLeaf, {focus: true});
    });
    return newLeaf;
  }

  dockPopoverToWorkspace(oldLeaf: WorkspaceLeaf) {
    if (!oldLeaf) return;
    oldLeaf.parentSplit.removeChild(oldLeaf);
    const {rootSplit} = this.app.workspace;
    // Add to first pane/tab group
    this.app.workspace.iterateLeaves(rootSplit, leaf => {
      leaf.parentSplit.insertChild(-1, oldLeaf)
      return true
    })
    this.app.workspace.activeLeaf = null;  // Force re-activation
    this.app.workspace.setActiveLeaf(oldLeaf, {focus: true});
    return oldLeaf;
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
