import { HoverEditorParent, PopoverState, WorkspaceSplit } from "obsidian";
import { HoverLeaf } from "./leaf";
import { HoverEditor } from "./popover";
import HoverEditorPlugin from "./main";

export function onLinkHover(
  plugin: HoverEditorPlugin,
  old: Function,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: unknown,
  ...args: any[]
) {
  let hoverPopover = parent.hoverPopover;
  if (hoverPopover?.lockedOut) return;
  if (!(hoverPopover && hoverPopover.state !== PopoverState.Hidden && hoverPopover.targetEl === targetEl)) {
    hoverPopover = parent.hoverPopover = new HoverEditor(parent, targetEl, plugin, plugin.settings.triggerDelay + 200);

    const controller = new AbortController();

    let unlock = function () {
      hoverPopover.lockedOut = false;
    };

    let onClick = function () {
      hoverPopover.state = PopoverState.Hidden;
      hoverPopover.explicitHide();
      hoverPopover.lockedOut = true;
      setTimeout(unlock, 1000);
    };

    targetEl.addEventListener("mousedown", onClick, { signal: controller.signal });

    setTimeout(async () => {
      controller.abort(); // cancel the click handler

      if (hoverPopover.state == PopoverState.Hidden) {
        return;
      }

      //@ts-ignore the official API has no contructor for WorkspaceSplit
      let split = new WorkspaceSplit(plugin.app.workspace, "horizontal");

      let leaf = new HoverLeaf(this.app, plugin, parent);

      hoverPopover.attachLeaf(leaf, split);

      let result = await leaf.openLink(linkText, path);

      if (!result) {
        leaf.detach();
        return old.call(this, parent, targetEl, linkText, path, oldState, ...args);
      }

      if (hoverPopover.state == PopoverState.Shown) {
        hoverPopover.position();
      }

      // enable this and take heap dumps to check for leaks
      // // @ts-ignore
      // hoverPopover.hoverEl.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // hoverPopover.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.leafMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.view.leafViewMemLeak = new Uint8Array(1024 * 1024 * 10);
    }, plugin.settings.triggerDelay);
  }
}
