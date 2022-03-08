import { InteractEvent, ResizeEvent } from "@interactjs/types";
import interact from "interactjs";
import { around } from "monkey-around";
import {
  debounce,
  EphemeralState,
  HoverEditorParent,
  HoverPopover,
  Menu,
  MenuItem,
  Notice,
  parseLinktext,
  Plugin,
  PopoverState,
  requireApiVersion,
  resolveSubpath,
  setIcon,
  TAbstractFile,
  TFile,
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

      this.patchLinkHover();
    });
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

  buildState(parentMode: string, eState?: EphemeralState) {
    let defaultMode = this.settings.defaultMode;
    let mode = defaultMode === "match" ? parentMode : this.settings.defaultMode;
    return {
      active: true,
      state: { mode: mode },
      eState: eState,
    };
  }

  buildEphemeralState(
    file: TFile,
    link: {
      path: string;
      subpath: string;
    }
  ) {
    let subpath = resolveSubpath(this.app.metadataCache.getFileCache(file), link?.subpath);
    let eState: EphemeralState = { subpath: link?.subpath };
    if (subpath) {
      eState.line = subpath.start.line;
      eState.startLoc = subpath.start;
      eState.endLoc = subpath.end || null;
    }
    return eState;
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

function dragMoveListener(event: InteractEvent) {
  let target = event.target as HTMLElement;

  let x = (parseFloat(target.getAttribute("data-x")) || 0) + event.dx;
  let y = (parseFloat(target.getAttribute("data-y")) || 0) + event.dy;

  target.style.transform = "translate(" + x + "px, " + y + "px)";

  target.setAttribute("data-x", String(x));
  target.setAttribute("data-y", String(y));
}

let delayedOnLinkHover = debounce(onLinkHover, 100, true);

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

  // setTimeout(async () => {
  let link = parseLinktext(linkText);

  let tFile = link ? this.app.metadataCache.getFirstLinkpathDest(link.path, path) : undefined;

  if (!tFile?.path) {
    return old.call(this, parent, targetEl, linkText, path, oldState, ...args);
  }

  let popover = new HoverEditor(parent, targetEl);

  //@ts-ignore the official API has no contructor for WorkspaceSplit
  let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

  //@ts-ignore the official API has no contructor for WorkspaceLeaf
  let leaf = new HoverLeaf(this.app);

  split.insertChild(0, leaf);

  // leaf.id = genId(4);
  // console.log(`creating leaf: ${leaf.id}`);

  leaf.popover = popover;
  popover.leaf = leaf;

  let { hoverEl } = popover;
  hoverEl.appendChild(split.containerEl);
  createResizeHandles(hoverEl);
  let pinEl = addPinButton(popover);

  let eState = plugin.buildEphemeralState(tFile, link);
  let parentMode = parent?.view?.getMode ? parent.view.getMode() : "preview";
  let state = plugin.buildState(parentMode, eState);

  await leaf.openFile(tFile, state);

  // TODO: Improve this logic which forces the popover to focus even when cycling through popover panes
  // without this, if you rapdidly open/close popovers, the leaf onHide logic will set the focus back
  // to the previous document
  setTimeout(() => {
    plugin.app.workspace.setActiveLeaf(leaf, false, true);
  }, 200);

  // TODO: Improve this logic which exists to scroll to header/block refs when in source mode
  if (state.state.mode === "source") {
    setTimeout(() => {
      leaf.view?.setEphemeralState(eState);
    }, 400);
  }

  leaf.view.iconEl.replaceWith(pinEl);

  let { appContainerEl } = plugin.app.dom;

  let _interact = (leaf.interact = interact(hoverEl)
    .preventDefault("always")

    .on("doubletap", onDoubleTap)

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
          popover.isPinned = true;
          pinEl.toggleClass("is-active", true);
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
          popover.isPinned = true;
          pinEl.toggleClass("is-active", true);
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
    }));

  function onDoubleTap(event: InteractEvent) {
    if (event.target.hasClass("drag-handle")) {
      event.preventDefault();
      popover.isPinned = true;
      pinEl.toggleClass("is-active", true);
      let viewEl = event.target.parentElement as HTMLElement;
      let viewHeader = viewEl.querySelector(".view-header") as HTMLElement;
      let headerHeight = viewHeader.getBoundingClientRect().bottom - hoverEl.getBoundingClientRect().top;
      if (!viewEl.style.maxHeight) {
        viewEl.style.minHeight = headerHeight + "px";
        viewEl.style.maxHeight = headerHeight + "px";
      } else {
        viewEl.style.removeProperty("max-height");
      }
      _interact.reflow({ name: "drag", axis: "xy" });
    }
  }

  // enable this and take a heap dump to look for leaks
  // // @ts-ignore
  // hoverEl.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // popover.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // leaf.leafMemLeak = new Uint8Array(1024 * 1024 * 10);
  // // @ts-ignore
  // leaf.view.leafViewMemLeak = new Uint8Array(1024 * 1024 * 10);
  // }, 100);
}

function addPinButton(popover: HoverEditor) {
  let pinEl = createDiv("popover-header-icon mod-pin-popover");
  pinEl.onclick = function (this: GlobalEventHandlers, ev: MouseEvent) {
    let value = !popover.isPinned;
    pinEl.toggleClass("is-active", value);
    popover.isPinned = value;
  };
  if (requireApiVersion && requireApiVersion("0.13.27")) {
    setIcon(pinEl, "lucide-pin", 17);
  } else {
    setIcon(pinEl, "pin", 17);
  }
  return pinEl;
}

function createResizeHandles(hoverEl: HTMLElement) {
  hoverEl.createDiv("resize-handle bottom-left");
  hoverEl.createDiv("resize-handle bottom-right");
  hoverEl.createDiv("resize-handle top-left");
  hoverEl.createDiv("resize-handle top-right");
  hoverEl.createDiv("drag-handle top");
}

export function genId(size: number) {
  for (var e = [], n = 0; n < size; n++) e.push(((16 * Math.random()) | 0).toString(16));

  return e.join("");
}
