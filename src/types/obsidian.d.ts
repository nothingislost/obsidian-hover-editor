import type { EditorView } from "@codemirror/view";
import type { Plugin } from "obsidian";
import { HoverEditor } from "../popover";

declare module "obsidian" {
  interface App {
    internalPlugins: {
      plugins: Record<string, { _loaded: boolean; instance: { name: string; id: string } }>;
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
  interface Workspace {
    recordHistory(leaf: WorkspaceLeaf, pushHistory: boolean): void;
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
    setMode(mode: MarkdownSubView): Promise<void>;
    followLinkUnderCursor(newLeaf: boolean): void;
    modes: Record<string, MarkdownSubView>;
    getMode(): string;
    headerEl: HTMLElement;
    contentEl: HTMLElement;
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

  interface HoverEditorParent {
    hoverPopover: HoverEditor | null;
    containerEl?: HTMLElement;
    view?: View;
    dom?: HTMLElement;
  }
}
