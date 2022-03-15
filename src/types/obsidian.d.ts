import type { EditorView } from "@codemirror/view";
import { Plugin } from "obsidian";

declare module "obsidian" {
  interface App {
    internalPlugins: {
      plugins: Record<
        string,
        {
          _loaded: boolean;
          disable(): void;
          enable(): void;
          _events: Function[];
          instance: { name: string; id: string };
        }
      >;
    };
    plugins: {
      manifests: Record<string, PluginManifest>;
      plugins: Record<string, Plugin>;
      getPlugin(id: string): Plugin;
    };
    dom: { appContainerEl: HTMLElement };
  }
  interface WorkspaceSplit {
    insertChild(index: number, leaf: WorkspaceLeaf, resize?: boolean): void;
    containerEl: HTMLElement;
  }
  interface MarkdownView {
    editMode: { cm: EditorView };
  }
  interface WorkspaceLeaf {
    openLinkText(linkText: string, path: string, state?: any): Promise<void>;
    working: boolean;
    parentSplit: WorkspaceParent;
    activeTime: number;
  }
  interface Workspace {
    recordHistory(leaf: WorkspaceLeaf, pushHistory: boolean): void;
    iterateLeaves(callback: (item: WorkspaceItem) => any, item: WorkspaceItem): boolean;
    getDropLocation(event: MouseEvent): {target: WorkspaceItem, sidedock: boolean};
    recursiveGetTarget(event: MouseEvent, parent: WorkspaceParent): WorkspaceItem;
  }
  interface Editor {
    getClickableTokenAt(pos: EditorPosition): {
      text: string;
      type: string;
      start: EditorPosition;
      end: EditorPosition;
    };
  }
  interface View {
    iconEl: HTMLElement;
    actionListEl?: HTMLElement;
    setMode(mode: MarkdownSubView): Promise<void>;
    followLinkUnderCursor(newLeaf: boolean): void;
    modes: Record<string, MarkdownSubView>;
    getMode(): string;
    headerEl: HTMLElement;
    contentEl: HTMLElement;
  }
  interface FileManager {
    createNewMarkdownFile(folder: TFolder, fileName: string): Promise<TFile>;
  }
  enum PopoverState {
    Showing,
    Shown,
    Hiding,
    Hidden,
  }
  interface Menu {
    items: MenuItem[];
    dom: HTMLElement;
    hideCallback: () => any;
  }
  interface MenuItem {
    iconEl: HTMLElement;
    dom: HTMLElement;
  }
  interface EphemeralState {
    focus?: Boolean;
    subpath?: string;
    line?: number;
    startLoc?: Loc;
    endLoc?: Loc;
    scroll?: number;
  }
  interface OpenViewState {
    eState?: EphemeralState;
    state?: { mode: string };
    active?: boolean;
  }
  interface HoverPopover {
    targetEl: HTMLElement;
    hoverEl: HTMLElement;
    position(pos?: Pos): void;
    hide(): void;
    shouldShowSelf(): boolean;
    shouldShowChild(): boolean;
  }
  interface Pos {
    x: number;
    y: number;
  }
}
