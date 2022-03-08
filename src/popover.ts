import { HoverParent, HoverPopover, WorkspaceLeaf } from "obsidian";
import { HoverLeaf } from "./leaf";

export class HoverEditor extends HoverPopover {
  explicitClose: boolean;
  onTarget: boolean;
  onHover: boolean;
  isPinned: boolean;
  leaf: HoverLeaf;
  isDragging: boolean;
  isResizing: boolean;
  isMenuActive: boolean;
  parent: HoverParent;

  constructor(parent: HoverParent, targetEl: HTMLElement, waitTime?: number) {
    super(parent, targetEl, waitTime);
    this.isPinned = false;
  }

  onShow() {}

  onHide() {}

  shouldShow() {
    return this.shouldShowSelf() || this.shouldShowChild();
  }

  explicitHide() {
    this.onTarget = this.onHover = this.isPinned = this.isDragging = this.isResizing = this.isMenuActive = false;
    this.hide();
  }

  shouldShowSelf() {
    return this.onTarget || this.onHover || this.isPinned || this.isDragging || this.isResizing || this.isMenuActive;
  }

  shouldShowChild() {
    return super.shouldShowChild();
  }

  hide() {
    if (!this.shouldShow()) {
      if (this.leaf) {
        // the leaf detach logic needs to be called first before we close the popover
        // leaf detach will make a call to back to this method to complete the unloading
        this.leaf.detach();
      } else {
        this.leaf = null;
        this.parent = null;
        return super.hide();
      }
    }
  }
}
