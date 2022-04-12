import { EphemeralState, PopoverState } from "obsidian";

import HoverEditorPlugin from "./main";
import { HoverEditorParent, HoverEditor } from "./popover";

const targetPops = new WeakMap<HTMLElement, HoverEditor>();

export function onLinkHover(
  plugin: HoverEditorPlugin,
  parent: HoverEditorParent,
  targetEl: HTMLElement,
  linkText: string,
  path: string,
  oldState: EphemeralState,
  ...args: unknown[]
) {
  // Tweak the targetEl for calendar to point to the table cell instead of the actual day,
  // so the link won't be broken when the day div is recreated by calendar refreshing
  if (targetEl && targetEl.matches('.workspace-leaf-content[data-type="calendar"] table.calendar td > div'))
    targetEl = targetEl.parentElement!;

  const prevPopover = targetPops.has(targetEl) ? targetPops.get(targetEl) : parent.hoverPopover;
  if (prevPopover?.lockedOut) return;

  const parentHasExistingPopover =
    prevPopover &&
    prevPopover.state !== PopoverState.Hidden &&
    // Don't keep the old popover if manually pinned (so you can tear off multiples)
    (!prevPopover.isPinned || plugin.settings.autoPin === "always") &&
    prevPopover.targetEl !== null &&
    prevPopover.originalLinkText === linkText &&
    prevPopover.originalPath === path &&
    targetEl &&
    prevPopover.adopt(targetEl);

  if (parentHasExistingPopover) {
    targetPops.set(targetEl, prevPopover);
  } else {
    const editor = new HoverEditor(parent, targetEl, plugin, plugin.settings.triggerDelay);
    if (targetEl) targetPops.set(targetEl, editor);
    editor.originalLinkText = linkText;
    editor.originalPath = path;
    parent.hoverPopover = editor;
    const controller = editor.abortController!;

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

    document.body.addEventListener("mousedown", onMouseDown, true);
    controller.register(() => document.body.removeEventListener("mousedown", onMouseDown, true));

    setTimeout(() => {
      if (editor?.state == PopoverState.Hidden) {
        return;
      }
      editor?.openLink(linkText, path, oldState);
    }, 100);
  }
}
