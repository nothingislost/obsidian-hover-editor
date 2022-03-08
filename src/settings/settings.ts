import { App, PluginSettingTab, Setting } from "obsidian";
import HoverEditorPlugin from "../main";

export interface HoverEditorSettings {
  defaultMode: string;
}

export const DEFAULT_SETTINGS: HoverEditorSettings = {
  defaultMode: "reading",
};

export const modeOptions = {
  preview: "Reading view",
  source: "Editing view",
  match: "Match current view",
};

export class SettingTab extends PluginSettingTab {
  plugin: HoverEditorPlugin;

  constructor(app: App, plugin: HoverEditorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide() {}

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName("Default hover editor mode").addDropdown(cb => {
      cb.addOptions(modeOptions);
      cb.setValue(this.plugin.settings.defaultMode);
      cb.onChange(async value => {
        (this.plugin.settings.defaultMode as any) = value;
        await this.plugin.saveSettings();
      });
    });
  }
}
