import { App, PluginSettingTab, Setting } from "obsidian";
import HoverEditorPlugin from "../main";

export interface HoverEditorSettings {
  defaultMode: string;
  autoPin: string;
  triggerDelay: number;
  autoFocus: boolean;
  rollDown: boolean;
  snapToEdges: boolean;
}

export const DEFAULT_SETTINGS: HoverEditorSettings = {
  defaultMode: "preview",
  autoPin: "onMove",
  triggerDelay: 200,
  autoFocus: true,
  rollDown: false,
  snapToEdges: false,
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

    new Setting(containerEl).setName("Auto Pin").addDropdown(cb => {
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
      .setName("Minimize downwards")
      .setDesc("When double clicking to minimize, the window will roll down instead of rolling up")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.rollDown).onChange(value => {
          this.plugin.settings.rollDown = value;
          this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Snap to edges")
      .setDesc(
        `Quickly arrange popovers by dragging them to the edges of the screen. The left and right edges 
        will maximize the popover vertically. The top edge will maximize the popover to fill the entire 
        screen. Dragging the popovers away from the edges will restore the popver to its original size.`
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.snapToEdges).onChange(value => {
          this.plugin.settings.snapToEdges = value;
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
