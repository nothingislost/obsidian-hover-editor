import { App, PluginSettingTab, Setting } from "obsidian";

import HoverEditorPlugin from "../main";
import { parseCssUnitValue } from "../utils/misc";

export interface HoverEditorSettings {
  defaultMode: string;
  autoPin: string;
  triggerDelay: number;
  closeDelay: number;
  autoFocus: boolean;
  rollDown: boolean;
  snapToEdges: boolean;
  initialHeight: string;
  initialWidth: string;
  showViewHeader: boolean;
  imageZoom: boolean;
  hoverEmbeds: boolean;
}

export const DEFAULT_SETTINGS: HoverEditorSettings = {
  defaultMode: "preview",
  autoPin: "onMove",
  triggerDelay: 300,
  closeDelay: 600,
  autoFocus: true,
  rollDown: false,
  snapToEdges: false,
  initialHeight: "340px",
  initialWidth: "400px",
  showViewHeader: false,
  imageZoom: true,
  hoverEmbeds: false,
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
      .setName("Trigger hover preview on embeds")
      .setDesc(
        "Allow hover preview to trigger when hovering over any type of rendered embed such as images or block references",
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.hoverEmbeds).onChange(value => {
          this.plugin.settings.hoverEmbeds = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Auto Focus")
      .setDesc("Set the hover editor as the active pane when opened")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.autoFocus).onChange(value => {
          this.plugin.settings.autoFocus = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Minimize downwards")
      .setDesc("When double clicking to minimize, the window will roll down instead of rolling up")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.rollDown).onChange(value => {
          this.plugin.settings.rollDown = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Snap to edges")
      .setDesc(
        `Quickly arrange popovers by dragging them to the edges of the screen. The left and right edges 
        will maximize the popover vertically. The top edge will maximize the popover to fill the entire 
        screen. Dragging the popovers away from the edges will restore the popver to its original size.`,
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.snapToEdges).onChange(value => {
          this.plugin.settings.snapToEdges = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show view header by default")
      .setDesc(
        `Show the view header by default when triggering a hover editor.
         When disabled, view headers will only show if you click the view header icon to the left of the minimize button.`,
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showViewHeader).onChange(value => {
          this.plugin.settings.showViewHeader = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Click to zoom image")
      .setDesc(
        `Click and hold an image within a hover editor to temporarily maximize the popover and image to fill the entire viewport. 
        On mouse up, the hover editor will restore to its original size.`,
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.imageZoom).onChange(value => {
          this.plugin.settings.imageZoom = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Initial popover width")
      .setDesc("Enter any valid CSS unit")
      .addText(textfield => {
        textfield.setPlaceholder(this.plugin.settings.initialWidth);
        textfield.inputEl.type = "text";
        textfield.setValue(this.plugin.settings.initialWidth);
        textfield.onChange(async value => {
          value = parseCssUnitValue(value);
          if (!value) value = DEFAULT_SETTINGS.initialWidth;
          this.plugin.settings.initialWidth = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Initial popover height")
      .setDesc("Enter any valid CSS unit")
      .addText(textfield => {
        textfield.setPlaceholder(String(this.plugin.settings.initialHeight));
        textfield.inputEl.type = "text";
        textfield.setValue(String(this.plugin.settings.initialHeight));
        textfield.onChange(async value => {
          value = parseCssUnitValue(value);
          if (!value) value = DEFAULT_SETTINGS.initialHeight;
          this.plugin.settings.initialHeight = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Hover Trigger Delay (ms)")
      .setDesc("How long to wait before showing a Hover Editor when hovering over a link")
      .addText(textfield => {
        textfield.setPlaceholder(String(this.plugin.settings.triggerDelay));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.settings.triggerDelay));
        textfield.onChange(async value => {
          this.plugin.settings.triggerDelay = Number(value);
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Hover Close Delay (ms)")
      .setDesc("How long to wait before closing a Hover Editor once the mouse leaves")
      .addText(textfield => {
        textfield.setPlaceholder(String(this.plugin.settings.closeDelay));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.settings.closeDelay));
        textfield.onChange(async value => {
          this.plugin.settings.closeDelay = Number(value);
          this.plugin.saveSettings();
        });
      });
  }
}
