import type { EditorView } from "@codemirror/view";
import { Plugin, SuggestModal, TFile, View, WorkspaceLeaf } from "obsidian";
import { HoverEditorParent } from "src/popover";

interface InternalPlugins {
  switcher: QuickSwitcherPlugin;
  "page-preview": InternalPlugin;
  graph: GraphPlugin;
}
declare class QuickSwitcherModal extends SuggestModal<TFile> {
  getSuggestions(query: string): TFile[] | Promise<TFile[]>;
  renderSuggestion(value: TFile, el: HTMLElement): unknown;
  onChooseSuggestion(item: TFile, evt: MouseEvent | KeyboardEvent): unknown;
}
interface InternalPlugin {
  disable(): void;
  enable(): void;
  enabled: boolean;
  _loaded: boolean;
  instance: { name: string; id: string };
}
interface GraphPlugin extends InternalPlugin {
  views: { localgraph: (leaf: WorkspaceLeaf) => GraphView };
}

interface GraphView extends View {
  engine: typeof Object;
  renderer: { worker: { terminate(): void } };
}
interface QuickSwitcherPlugin extends InternalPlugin {
  instance: {
    name: string;
    id: string;
    QuickSwitcherModal: typeof QuickSwitcherModal;
  };
}

declare module "obsidian" {
  interface App {
    internalPlugins: {
      plugins: InternalPlugins;
      getPluginById<T extends keyof InternalPlugins>(id: T): InternalPlugins[T];
    };
    plugins: {
      manifests: Record<string, PluginManifest>;
      plugins: Record<string, Plugin> & {
        ["recent-files-obsidian"]: Plugin & {
          shouldAddFile(file: TFile): boolean;
        };
      };
      getPlugin(id: string): Plugin;
      getPlugin(id: "calendar"): CalendarPlugin;
    };
    dom: { appContainerEl: HTMLElement };
  }
  interface CalendarPlugin {
    view: View;
  }
  interface WorkspaceSplit {
    insertChild(index: number, leaf: WorkspaceLeaf, resize?: boolean): void;
    containerEl: HTMLElement;
  }
  interface MarkdownView {
    editMode: { cm: EditorView };
  }
  interface MarkdownEditView {
    editorEl: HTMLElement;
  }
  interface WorkspaceLeaf {
    openLinkText(linkText: string, path: string, state?: unknown): Promise<void>;
    updateHeader(): void;
    containerEl: HTMLElement;
    working: boolean;
    parentSplit: WorkspaceParent;
    activeTime: number;
  }
  interface Workspace {
    recordHistory(leaf: WorkspaceLeaf, pushHistory: boolean): void;
    iterateLeaves(callback: (item: WorkspaceLeaf) => unknown, item: WorkspaceParent): boolean;
    getDropLocation(event: MouseEvent): {
      target: WorkspaceItem;
      sidedock: boolean;
    };
    recursiveGetTarget(event: MouseEvent, parent: WorkspaceParent): WorkspaceItem;
    recordMostRecentOpenedFile(file: TFile): void;
    onDragLeaf(event: MouseEvent, leaf: WorkspaceLeaf): void;
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
    file: TFile;
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
    hideCallback: () => unknown;
  }
  interface MenuItem {
    iconEl: HTMLElement;
    dom: HTMLElement;
  }
  interface EphemeralState {
    focus?: boolean;
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
    parent: HoverEditorParent | null;
    targetEl: HTMLElement;
    hoverEl: HTMLElement;
    position(pos?: MousePos): void;
    hide(): void;
    show(): void;
    shouldShowSelf(): boolean;
    timer: number;
    waitTime: number;
    shouldShow(): boolean;
    transition(): void;
  }
  interface MousePos {
    x: number;
    y: number;
  }
}
