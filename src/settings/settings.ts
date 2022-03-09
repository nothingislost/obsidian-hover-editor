import { App, PluginSettingTab, Setting } from "obsidian";
import HoverEditorPlugin from "../main";

export interface HoverEditorSettings {
  defaultMode: string;
  autoPin: string;
  triggerDelay: number;
  autoFocus: boolean;
}

export const DEFAULT_SETTINGS: HoverEditorSettings = {
  defaultMode: "preview",
  autoPin: "onMove",
  triggerDelay: 200,
  autoFocus: true,
};

export const modeOptions = {
  preview: "Reading view",
  source: "Editing view",
  match: "Match current view",
};

export const pinOptions = {
  onMove: "On drag or resize",
  always: "Always",
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

    new Setting(containerEl).setName("Default Mode").addDropdown(cb => {
      cb.addOptions(modeOptions);
      cb.setValue(this.plugin.settings.defaultMode);
      cb.onChange(async value => {
        this.plugin.settings.defaultMode = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl)
      .setName("Auto Pin")
      .setDesc("Set the hover editor as the active pane when opened")
      .addDropdown(cb => {
        cb.addOptions(pinOptions);
        cb.setValue(this.plugin.settings.autoPin);
        cb.onChange(async value => {
          this.plugin.settings.autoPin = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Auto Focus")
      .setDesc("Set the hover editor as the active pane when opened")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.autoFocus).onChange(value => {
          this.plugin.settings.autoFocus = value;
          this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Hover Trigger Delay (ms)")
      .setDesc("How long to wait before triggering a Hover Editor when hovering over a link")
      .addText(textfield => {
        textfield.setPlaceholder(String(200));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.settings.triggerDelay));
        textfield.onChange(async value => {
          this.plugin.settings.triggerDelay = Number(value);
          this.plugin.saveSettings();
        });
      });
  }
}
