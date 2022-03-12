import type { Interactable } from "@interactjs/types";
import {
  App,
  EphemeralState,
  HoverEditorParent,
  OpenViewState,
  parseLinktext,
  requireApiVersion,
  resolveSubpath,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import HoverEditorPlugin from "./main";
import { HoverEditor } from "./popover";

export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverEditor;
  interact: Interactable;
  app: App;
  id: string;
  plugin: HoverEditorPlugin;
  hoverParent: HoverEditorParent;
  pinEl: HTMLElement;
  isPinned: boolean;

  constructor(app: App, plugin: HoverEditorPlugin, parent: HoverEditorParent) {
    // @ts-ignore
    super(app);
    this.plugin = plugin;
    this.hoverParent = parent;
    this.addPinButton();
    // leaf.id = genId(4);
    // console.log(`creating leaf: ${leaf.id}`);
  }

  getRoot() {
    // only pretend to be part of the root split if we have an active view loaded
    if (this.view) return this.app.workspace.rootSplit;
  }

  resolveLink(linkText: string, sourcePath: string): TFile {
    let link = parseLinktext(linkText);
    let tFile = link ? this.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : undefined;
    return tFile;
  }

  addPinButton() {
    let pinEl = (this.pinEl = createDiv("popover-header-icon mod-pin-popover"));
    pinEl.onclick = () => {
      this.togglePin();
    };
    if (requireApiVersion && requireApiVersion("0.13.27")) {
      setIcon(pinEl, "lucide-pin", 17);
    } else {
      setIcon(pinEl, "pin", 17);
    }
    return pinEl;
  }

  togglePin(value?: boolean) {
    if (value === undefined) {
      value = !this.isPinned;
    }
    this.pinEl.toggleClass("is-active", value);
    this.isPinned = value;
  }

  toggleMinimized(value?: boolean) {
    let hoverEl = this.popover.hoverEl;

    let viewHeader = this.view.headerEl;
    let headerHeight = viewHeader.getBoundingClientRect().bottom - hoverEl.getBoundingClientRect().top;

    if (!hoverEl.style.maxHeight) {
      this.plugin.settings.rollDown && expandContract(hoverEl, false);
      hoverEl.style.minHeight = headerHeight + "px";
      hoverEl.style.maxHeight = headerHeight + "px";
      hoverEl.toggleClass("is-minimized", true);
    } else {
      hoverEl.style.removeProperty("max-height");
      hoverEl.toggleClass("is-minimized", false);
      this.plugin.settings.rollDown && expandContract(hoverEl, true);
    }
    this.popover.interact.reflow({ name: "drag", axis: "xy" });
  }

  async openLink(linkText: string, sourcePath: string, eState?: EphemeralState) {
    // if (eState && eState.scroll) eState.line = eState.scroll;
    let file = this.resolveLink(linkText, sourcePath);
    if (!file) return false;
    let link = parseLinktext(linkText);
    eState = Object.assign(this.buildEphemeralState(file, link), eState);
    let parentMode = this.hoverParent?.view?.getMode ? this.hoverParent.view.getMode() : "preview";
    let state = this.buildState(parentMode, eState);
    await this.openFile(file, state);

    // TODO: Improve this logic which exists to scroll to header/block refs when in source mode
    if (state.state.mode === "source") {
      setTimeout(() => {
        this.view?.setEphemeralState(eState);
      }, 400);
    }

    return true;
  }

  async openFile(file: TFile, openState?: OpenViewState) {
    if (!openState) {
      let parentMode = this.hoverParent?.view?.getMode ? this.hoverParent.view.getMode() : "preview";
      openState = this.buildState(parentMode);
    }
    await super.openFile(file, openState);
    this.view.iconEl.replaceWith(this.pinEl);
  }

  buildState(parentMode: string, eState?: EphemeralState) {
    let defaultMode = this.plugin.settings.defaultMode;
    let mode = defaultMode === "match" ? parentMode : this.plugin.settings.defaultMode;
    return {
      active: this.plugin.settings.autoFocus,
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
    if (this.plugin.settings.autoFocus) eState.focus = true;
    if (subpath) {
      eState.line = subpath.start.line;
      eState.startLoc = subpath.start;
      eState.endLoc = subpath.end || null;
    }
    return eState;
  }

  // async setViewState(viewState: ViewState, eState?: any) {
  //   await super.setViewState(viewState, eState);
  // }

  // setEphemeralState(state: any) {
  //   super.setEphemeralState(state);
  // }

  detach() {
    if (this.app.workspace.activeLeaf === this) this.app.workspace.activeLeaf = null;
    super.detach();
    // TODO: Research this possible scrollTargets memory leak in CodeMirror6 core
    // @ts-ignore
    if (this.view?.editMode?.cm?.observer?.scrollTargets) this.view.editMode.cm.observer.scrollTargets = null;
    if (this.popover) {
      this.popover.leaf = null;
      this.popover?.explicitHide && this.popover.explicitHide();
      this.popover = null;
    }
  }
}

function expandContract(el: HTMLElement, expand: boolean) {
  let contentHeight = (el.querySelector(".view-content") as HTMLElement).offsetHeight;
  contentHeight = expand ? -contentHeight : contentHeight;
  let x = parseFloat(el.getAttribute("data-x")) || 0;
  let y = (parseFloat(el.getAttribute("data-y")) || 0) + contentHeight;

  el.style.transform = "translate(" + x + "px, " + y + "px)";
  el.setAttribute("data-y", String(y));
}
