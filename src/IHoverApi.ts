import {App, WorkspaceLeaf} from "obsidian";

export interface IHoverApi {
    spawnPopover: (app: App, initiatingEl?: HTMLElement, onShowCallback?: () => any) => Promise<any>;
}
