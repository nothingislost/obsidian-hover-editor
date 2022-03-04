import { App, HoverPopover, WorkspaceLeaf } from "obsidian";
import { Interactable } from "@interactjs/types";

export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverPopover;
  interact: Interactable;

  constructor(app: App) {
    // @ts-ignore
    super(app);
  }

  detach() {
    if (this.popover) {
      this.popover.explicitClose = true;
      this.popover.hide();
      this.popover = null;
      this.interact.unset();
      this.interact = null;
    }
    super.detach();
  }
}
