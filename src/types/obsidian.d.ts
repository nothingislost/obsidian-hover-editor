import type { EditorView } from "@codemirror/view";
import { Plugin } from "obsidian";
import { HoverEditorParent } from "src/popover";

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
      plugins: Record<string, Plugin> & {
        ["recent-files-obsidian"]: Plugin & {
          shouldAddFile(file: TFile): boolean;
        }
      };
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
    updateHeader(): void;
    containerEl: HTMLElement;
    working: boolean;
    parentSplit: WorkspaceParent;
    activeTime: number;
  }
  interface Workspace {
    recordHistory(leaf: WorkspaceLeaf, pushHistory: boolean): void;
    iterateLeaves(callback: (item: WorkspaceLeaf) => any, item: WorkspaceParent): boolean;
    getDropLocation(event: MouseEvent): {target: WorkspaceItem, sidedock: boolean};
    recursiveGetTarget(event: MouseEvent, parent: WorkspaceParent): WorkspaceItem;
    recordMostRecentOpenedFile(file: TFile): void;
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
    emptyTitleEl?: HTMLElement;
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
    parent: HoverEditorParent
    targetEl: HTMLElement;
    hoverEl: HTMLElement;
    position(pos?: Pos): void;
    hide(): void;
    show(): void;
    shouldShowSelf(): boolean;
    timer: number;
    waitTime: number;
  }
  interface Pos {
    x: number;
    y: number;
  }
}
