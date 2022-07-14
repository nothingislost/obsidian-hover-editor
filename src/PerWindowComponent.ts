import { around } from "monkey-around";
import { Component, Plugin, View, WorkspaceLeaf } from "obsidian";

/**
 * Component that belongs to a plugin + window. e.g.:
 *
 *     class TitleWidget extends PerWindowComponent<MyPlugin> {
 *         onload() {
 *             // do stuff with this.plugin and this.win ...
 *         }
 *     }
 *
 *     class MyPlugin extends Plugin {
 *         titleWidgets = TitleWidget.perWindow(this);
 *         ...
 *     }
 *
 * This will automatically create a title widget for each window as it's opened, and
 * on plugin load.  The plugin's `.titleWidgets` will also be a WindowManager that can
 * look up the title widget for a given window, leaf, or view, or return a list of
 * all of them.  See WindowManager for the full API.
 *
 * If you want your components to be created on demand instead of automatically when
 * window(s) are opened, you can pass `false` as the second argument to `perWindow()`.
 */
export class PerWindowComponent<P extends Plugin> extends Component {
  constructor(public plugin: P, public win: Window) {
    super();
  }

  static perWindow<T extends PerWindowComponent<P>, P extends Plugin>(
    this: new (plugin: P, win: Window) => T,
    plugin: P,
    autocreate = true,
  ) {
    return new WindowManager(plugin, this, autocreate);
  }
}

/**
 * Manage per-window components
 */
export class WindowManager<T extends PerWindowComponent<P>, P extends Plugin> extends Component {
  instances = new WeakMap<Window, T>();

  constructor(
    public plugin: P,
    public factory: new (plugin: P, win: Window) => T, // The class of thing to manage
    public autocreate = true, // create all items at start and monitor new window creation
  ) {
    super();
    plugin.addChild(this);
  }

  forWindow(): T;
  forWindow(win: Window): T;
  forWindow(win: Window, create: true): T;
  forWindow(win: Window, create: boolean): T | undefined;

  forWindow(win: Window = window.activeWindow ?? window, create = true): T | undefined {
    let inst = this.instances.get(win);
    if (!inst && create) {
      inst = new this.factory(this.plugin, win);
      if (inst) {
        this.instances.set(win, inst!);
        inst.registerDomEvent(win, "beforeunload", () => {
          this.removeChild(inst!);
          this.instances.delete(win);
        });
        this.addChild(inst);
      }
    }
    return inst || undefined;
  }

  forDom(el: Node): T;
  forDom(el: Node, create: true): T;
  forDom(el: Node, create: boolean): T | undefined;

  forDom(el: Node, create = true) {
    return this.forWindow(windowForDom(el), create);
  }

  forLeaf(leaf: WorkspaceLeaf): T;
  forLeaf(leaf: WorkspaceLeaf, create: true): T;
  forLeaf(leaf: WorkspaceLeaf, create: boolean): T | undefined;

  forLeaf(leaf: WorkspaceLeaf, create = true) {
    return this.forDom(leaf.containerEl, create);
  }

  forView(view: View): T;
  forView(view: View, create: true): T;
  forView(view: View, create: boolean): T | undefined;

  forView(view: View, create = true) {
    return this.forDom(view.containerEl, create);
  }

  windows() {
    const windows: Window[] = [window],
      { floatingSplit } = this.plugin.app.workspace;
    if (floatingSplit) {
      for (const split of floatingSplit.children) if (split.win) windows.push(split.win);
    }
    return windows;
  }

  forAll(create = true) {
    return this.windows()
      .map(win => this.forWindow(win, create))
      .filter(t => t);
  }
}

export function windowForDom(el: Node) {
  return (el.ownerDocument || <Document>el).defaultView!;
}

declare module "obsidian" {
  interface Workspace {
    floatingSplit?: WorkspaceParent & { children: WorkspaceWindow[] };
    openPopout?(): WorkspaceSplit;
  }
  interface WorkspaceLeaf {
    containerEl: HTMLElement;
  }
}
