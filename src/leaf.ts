import { App, HoverPopover, WorkspaceLeaf } from "obsidian";

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
    }
    super.detach();
  }
}
