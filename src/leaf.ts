import { App, HoverPopover, WorkspaceLeaf } from "obsidian";
import interact from "interactjs";

export class HoverLeaf extends WorkspaceLeaf {
  popover: HoverPopover;

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
