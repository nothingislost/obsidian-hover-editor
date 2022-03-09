import type { Interactable } from "@interactjs/types";
import {
  App,
  EphemeralState,
  HoverEditorParent,
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

  async openLink(linkText: string, sourcePath: string) {
    let file = this.resolveLink(linkText, sourcePath);
    if (!file) return false;
    let link = parseLinktext(linkText);
    let eState = this.buildEphemeralState(file, link);
    let parentMode = this.hoverParent?.view?.getMode ? this.hoverParent.view.getMode() : "preview";
    let state = this.buildState(parentMode, eState);
    await this.openFile(file, state);

    // TODO: Improve this logic which forces the popover to focus even when cycling through popover panes
    // without this, if you rapdidly open/close popovers, the leaf onHide logic will set the focus back
    // to the previous document
    setTimeout(() => {
      this.app.workspace.setActiveLeaf(this, false, true);
    }, 200);

    // TODO: Improve this logic which exists to scroll to header/block refs when in source mode
    if (state.state.mode === "source") {
      setTimeout(() => {
        this.view?.setEphemeralState(eState);
      }, 400);
    }

    this.view.iconEl.replaceWith(this.pinEl);
    return true;
  }

  buildState(parentMode: string, eState?: EphemeralState) {
    let defaultMode = this.plugin.settings.defaultMode;
    let mode = defaultMode === "match" ? parentMode : this.plugin.settings.defaultMode;
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

  // async setViewState(viewState: ViewState, eState?: any) {
  //   await super.setViewState(viewState, eState);
  // }

  // setEphemeralState(state: any) {
  //   super.setEphemeralState(state);
  // }

  detach() {
    this.app.workspace.activeLeaf = null;
    super.detach();
    // TODO: Research this possible memory leak in CodeMirror6 core
    // @ts-ignore
    if (this.view?.editMode?.cm?.observer?.scrollTargets) this.view.editMode.cm.observer.scrollTargets = null;
    if (this.popover) {
      // console.log(`detaching leaf: ${this.popover.leaf.id}`);
      this.popover.leaf = null;
      this.popover?.explicitHide && this.popover.explicitHide();
      this.popover = null;
      this.interact?.unset && this.interact.unset();
      try {
        this.interact =
          (this.interact as any)._doc =
          (this.interact as any)._context =
          (this.interact as any).target =
          (this.interact as any)._scopeEvents =
          (this.interact as any)._win =
            null;
      } catch {}
    }
  }
}
