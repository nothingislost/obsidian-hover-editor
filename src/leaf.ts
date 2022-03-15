import type { Interactable } from "@interactjs/types";
import {
  App,
  EphemeralState,
  OpenViewState,
  parseLinktext,
  resolveSubpath,
  TFile,
  View,
  WorkspaceLeaf,
} from "obsidian";
import HoverEditorPlugin from "./main";
import { HoverEditor } from "./popover";

export interface HoverEditorParent {
  hoverPopover: HoverEditor | null;
  containerEl?: HTMLElement;
  view?: View;
  dom?: HTMLElement;
}


export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverEditor;
  interact: Interactable;
  app: App;
  id: string;
  plugin: HoverEditorPlugin;
  hoverParent: HoverEditorParent;
  detaching: boolean;
  opening: boolean;

  constructor(app: App, plugin: HoverEditorPlugin, parent: HoverEditorParent) {
    // @ts-ignore
    super(app);
    this.detaching = false;
    this.plugin = plugin;
    this.hoverParent = parent;
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

  async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, autoCreate?: boolean) {
    // if (eState && eState.scroll) eState.line = eState.scroll;
    let file = this.resolveLink(linkText, sourcePath);
    let link = parseLinktext(linkText);
    if (!file && autoCreate) {
      let folder = this.app.fileManager.getNewFileParent(sourcePath);
      file = await this.app.fileManager.createNewMarkdownFile(folder, link.path);
    }
    if (!file) return false;
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
    if (this.detaching) return;
    this.opening = true;
    try {
      if (!openState) {
        let parentMode = this.hoverParent?.view?.getMode ? this.hoverParent.view.getMode() : "preview";
        let eState = this.buildEphemeralState(file);
        openState = this.buildState(parentMode, eState);
      }
      await super.openFile(file, openState);
    } catch {
    } finally {
      this.opening = false;
    }
    if (this.popover) this.popover.placePin();
    if (openState.state?.mode === "source" || openState.eState) {
      setTimeout(() => {
        if (this.detaching) return;
        this.view?.setEphemeralState(openState.eState);
      }, 400);
    }
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

  onResize(): void {
    // the native obsidian method does not do a null check on this.view
    this.view?.onResize();
  }

  buildEphemeralState(
    file: TFile,
    link?: {
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

  setEphemeralState(state: any) {
     super.setEphemeralState(state);
     if (state.focus && this.view?.getViewType() === "empty") {
       // Force empty (no-file) view to have focus so dialogs don't reset active pane
       this.view.contentEl.tabIndex = -1;
       this.view.contentEl.focus();
     }
  }

  detach() {
    if (this.opening) {
      setTimeout(() => {
        this.detach();
      }, 20);
      return;
    }
    this.detaching = true;

    if (this.app.workspace.activeLeaf === this) {
      // Activate the most recently active leaf (including popovers) before detaching
      this.app.workspace.setActiveLeaf(this.mostRecentLeaf(), false, true);
    }
    super.detach();
    // TODO: Research this possible scrollTargets memory leak in CodeMirror6 core
    // @ts-ignore
    if (this.view?.editMode?.cm?.observer?.scrollTargets) this.view.editMode.cm.observer.scrollTargets = null;
    // Close the popover if there's nothing left
    if (this.popover && !this.popover.leaves().length) {
      this.popover.explicitHide();
      this.popover = null;
    }
  }

  mostRecentLeaf() {
    const excluding = this;
    let nextLeaf: WorkspaceLeaf = null;
    // Find most recently active leaf in any popover or the main workspace area
    this.app.workspace.iterateRootLeaves(scan);
    HoverEditor.activePopovers().forEach(popover => {
      this.app.workspace.iterateLeaves(scan, popover.rootSplit);
    })
    return nextLeaf;
    function scan(leaf: WorkspaceLeaf) {
      if (leaf !== excluding && (!nextLeaf || nextLeaf.activeTime < leaf.activeTime))  nextLeaf = leaf;
    }
  }
}

export function expandContract(el: HTMLElement, expand: boolean) {
  let contentHeight = (el.querySelector(".view-content") as HTMLElement).offsetHeight;
  contentHeight = expand ? -contentHeight : contentHeight;
  let x = parseFloat(el.getAttribute("data-x")) || 0;
  let y = (parseFloat(el.getAttribute("data-y")) || 0) + contentHeight;

  el.style.transform = "translate(" + x + "px, " + y + "px)";
  el.setAttribute("data-y", String(y));
}
