import { EphemeralState, PopoverState } from "obsidian";

import HoverEditorPlugin from "./main";
import { HoverEditorParent, HoverEditor } from "./popover";

export function onLinkHover(
  plugin: HoverEditorPlugin,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: EphemeralState,
  ...args: unknown[]
) {
  const prevPopover = parent.hoverPopover;
  if (prevPopover?.lockedOut) return;
  const parentHasExistingPopover =
    prevPopover &&
    prevPopover.state !== PopoverState.Hidden &&
    prevPopover.targetEl !== null &&
    targetEl &&
    prevPopover.adopt(targetEl);

  if (!parentHasExistingPopover) {
    const editor = new HoverEditor(parent, targetEl, plugin, plugin.settings.triggerDelay);
    parent.hoverPopover = editor;
    const controller = (editor.abortController = new AbortController());

    const unlock = function () {
      if (!editor) return;
      editor.lockedOut = false;
    };

    const onMouseDown = function (event: MouseEvent) {
      if (!editor) return;
      if (event.target instanceof HTMLElement && !event.target.closest(".hover-editor, .menu")) {
        editor.state = PopoverState.Hidden;
        editor.hide();
        editor.lockedOut = true;
        setTimeout(unlock, 1000);
      }
    };

    document.body.addEventListener("mousedown", onMouseDown, {
      capture: true,
      signal: controller.signal,
    });

    setTimeout(() => {
      if (editor?.state == PopoverState.Hidden) {
        return;
      }
      editor?.openLink(linkText, path, oldState);
    }, 100);
  }
}
