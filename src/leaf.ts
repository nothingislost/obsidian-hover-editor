import type { Interactable } from "@interactjs/types";
import { App, WorkspaceLeaf } from "obsidian";
import { HoverEditor } from "./popover";

export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverEditor;
  interact: Interactable;
  app: App;
  id: string;

  constructor(app: App) {
    // @ts-ignore
    super(app);
  }

  getRoot() {
    // only pretend to be part of the root split if we have an active view loaded
    if (this.view) return this.app.workspace.rootSplit;
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
