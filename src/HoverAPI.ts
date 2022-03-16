import type HoverEditorPlugin from "./main";
import type {IHoverApi} from "./IHoverApi";
import {App, WorkspaceLeaf} from "obsidian";
import {HoverEditor, HoverEditorParent} from "./popover";

export class HoverApi {
    constructor(private plugin: HoverEditorPlugin) {
    }

    public make(): IHoverApi {
        return {
            spawnPopover: this.spawnPopover(),
        };
    }

    private spawnPopover(): (app: App, initiatingEl?: HTMLElement, onShowCallback?: () => any) => Promise<any> {
        return async (app: App, initiatingEl?: HTMLElement, onShowCallback?: () => any) => {
            let parent = app.workspace.activeLeaf as unknown as HoverEditorParent;
            if (!initiatingEl) initiatingEl = parent.containerEl;
            let hoverPopover = new HoverEditor(parent, initiatingEl, this.plugin, undefined, onShowCallback);
            hoverPopover.togglePin(true);
            return hoverPopover.attachLeaf();
        }
    }
}
