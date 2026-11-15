import { App, PluginSettingTab, Setting, requireApiVersion } from "obsidian";

import HoverEditorPlugin from "../main";
import { t } from "../i18n";
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
  footnotes: "always" | "never";
  headings: "always" | "never";
  blocks: "always" | "never";
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
  footnotes: requireApiVersion("1.6") ? "never" : "always",
  headings: "always",
  blocks: requireApiVersion("1.6") ? "never" : "always",
};

export const modeOptions = {
  get preview() { return t("readingView"); },
  get source() { return t("editingView"); },
  get match() { return t("matchCurrent"); },
};

export const pinOptions = {
  get onMove() { return t("onMove"); },
  get always() { return t("always"); },
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

    new Setting(containerEl).setName(t("defaultMode")).addDropdown(cb => {
      cb.addOptions(modeOptions);
      cb.setValue(this.plugin.settings.defaultMode);
      cb.onChange(async value => {
        this.plugin.settings.defaultMode = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName(t("autoPin")).addDropdown(cb => {
      cb.addOptions(pinOptions);
      cb.setValue(this.plugin.settings.autoPin);
      cb.onChange(value => {
        this.plugin.settings.autoPin = value;
        this.plugin.saveSettings();
      });
    });

    new Setting(containerEl)
      .setName(t("hoverEmbeds"))
      .setDesc(
        t("hoverEmbedsDesc"),
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.hoverEmbeds).onChange(value => {
          this.plugin.settings.hoverEmbeds = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("headings"))
      .setDesc(
        t("headingsDesc"),
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.headings === "always").onChange(value => {
          this.plugin.settings.headings = value ? "always" : "never";
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("blocks"))
      .setDesc(
        t("blocksDesc"),
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.blocks === "always").onChange(value => {
          this.plugin.settings.blocks = value ? "always" : "never";
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("footnotes"))
      .setDesc(
        t("footnotesDesc"),
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.footnotes === "always").onChange(value => {
          this.plugin.settings.footnotes = value ? "always" : "never";
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("autoFocus"))
      .setDesc(t("autoFocusDesc"))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.autoFocus).onChange(value => {
          this.plugin.settings.autoFocus = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("minimizeDown"))
      .setDesc(t("minimizeDownDesc"))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.rollDown).onChange(value => {
          this.plugin.settings.rollDown = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("snapEdges"))
      .setDesc(t("snapEdgesDesc"))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.snapToEdges).onChange(value => {
          this.plugin.settings.snapToEdges = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("showHeader"))
      .setDesc(t("showHeaderDesc"))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showViewHeader).onChange(value => {
          this.plugin.settings.showViewHeader = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("imageZoom"))
      .setDesc(t("imageZoomDesc"))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.imageZoom).onChange(value => {
          this.plugin.settings.imageZoom = value;
          this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("initialWidth"))
      .setDesc(t("cssUnit"))
      .addText(textfield => {
        textfield.setPlaceholder(this.plugin.settings.initialWidth);
        textfield.inputEl.type = "text";
        textfield.setValue(this.plugin.settings.initialWidth);
        textfield.onChange(async value => {
          value = parseCssUnitValue(value) || DEFAULT_SETTINGS.initialWidth;
          this.plugin.settings.initialWidth = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("initialHeight"))
      .setDesc(t("cssUnit"))
      .addText(textfield => {
        textfield.setPlaceholder(String(this.plugin.settings.initialHeight));
        textfield.inputEl.type = "text";
        textfield.setValue(String(this.plugin.settings.initialHeight));
        textfield.onChange(async value => {
          value = parseCssUnitValue(value) || DEFAULT_SETTINGS.initialHeight;
          this.plugin.settings.initialHeight = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("triggerDelay"))
      .setDesc(t("triggerDelayDesc"))
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
      .setName(t("closeDelay"))
      .setDesc(t("closeDelayDesc"))
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
