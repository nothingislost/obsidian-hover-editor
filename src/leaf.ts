import { Interactable } from "@interactjs/types";
import { App, HoverPopover, WorkspaceLeaf } from "obsidian";

export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverPopover;
  interact: Interactable;
  app: App;

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
    if (this.popover) {
      this.popover.explicitClose = true;
      this.popover.hide();
      this.popover = null;
      this.interact.unset();
      this.interact = null;
    }
  }
}
