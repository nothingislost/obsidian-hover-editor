import { PopoverState, WorkspaceSplit } from "obsidian";
import { HoverEditorParent, HoverLeaf } from "./leaf";
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
  if (
    !(
      hoverPopover &&
      hoverPopover.state !== PopoverState.Hidden &&
      hoverPopover.targetEl !== null &&
      hoverPopover.targetEl === targetEl
    )
  ) {
    hoverPopover = parent.hoverPopover = new HoverEditor(parent, targetEl, plugin, plugin.settings.triggerDelay + 200);

    const controller = (hoverPopover.abortController = new AbortController());

    let unlock = function () {
      hoverPopover.lockedOut = false;
    };

    let onMouseDown = function (event: MouseEvent) {
      if (event.target instanceof HTMLElement && !event.target.closest(".popover")) {
        hoverPopover.state = PopoverState.Hidden;
        hoverPopover.hide();
        hoverPopover.lockedOut = true;
        setTimeout(unlock, 1000);
      }
    };

    document.body.addEventListener("mousedown", onMouseDown, { capture: true, signal: controller.signal });

    setTimeout(async () => {
      if (hoverPopover.state == PopoverState.Hidden) {
        return;
      }

      let leaf = hoverPopover.attachLeaf(parent);

      let result = await leaf.openLink(linkText, path, oldState);

      if (!result) {
        leaf.view.actionListEl.empty();
        let createEl = leaf.view.actionListEl.createEl("button", "empty-state-action");
        createEl.textContent = `${linkText} is not yet created. Click to create.`;
        setTimeout(() => {
          createEl.focus();
        }, 200);
        createEl.addEventListener(
          "click",
          async function () {
            hoverPopover.togglePin(true);
            await leaf.openLinkText(linkText, path);
            await leaf.openLink(linkText, path);
          },
          { once: true }
        );
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
