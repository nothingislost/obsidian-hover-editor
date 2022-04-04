import { EphemeralState, PopoverState } from "obsidian";
import { HoverEditorParent, HoverEditor } from "./popover";
import HoverEditorPlugin from "./main";

export function onLinkHover(
  plugin: HoverEditorPlugin,
  old: Function,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: EphemeralState,
  ...args: any[]
) {
  let hoverPopover = parent.hoverPopover;
  if (hoverPopover?.lockedOut) return;
  if (
    !(
      hoverPopover &&
      hoverPopover.state !== PopoverState.Hidden &&
      hoverPopover.targetEl !== null &&
      hoverPopover.targetEl === targetEl
    )
  ) {
    hoverPopover = parent.hoverPopover = new HoverEditor(parent, targetEl, plugin, plugin.settings.triggerDelay);
    const controller = (hoverPopover.abortController = new AbortController());

    let unlock = function () {
      if (!hoverPopover) return;
      hoverPopover.lockedOut = false;
    };

    let onMouseDown = function (event: MouseEvent) {
      if (!hoverPopover) return;
      if (event.target instanceof HTMLElement && !event.target.closest(".hover-editor")) {
        hoverPopover.state = PopoverState.Hidden;
        hoverPopover.explicitHide();
        hoverPopover.lockedOut = true;
        setTimeout(unlock, 1000);
      }
    };

    document.body.addEventListener("mousedown", onMouseDown, { capture: true, signal: controller.signal });

    setTimeout(() => {
      if (hoverPopover?.state == PopoverState.Hidden) {
        return;
      }
      hoverPopover?.openLink(linkText, path, oldState);

      // enable this and take heap dumps to check for leaks
      // // @ts-ignore
      // hoverPopover.hoverEl.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // hoverPopover.popoverMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.leafMemLeak = new Uint8Array(1024 * 1024 * 10);
      // // @ts-ignore
      // leaf.view.leafViewMemLeak = new Uint8Array(1024 * 1024 * 10);
    }, 100);
  }
}
