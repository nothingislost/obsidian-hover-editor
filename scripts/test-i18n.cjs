const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/i18n/index.ts"), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText;

function load(apiLanguage, storedLanguage, storageThrows = false) {
  let dateLocale = "en";
  const obsidian = { moment: { locale: value => value ? (dateLocale = value) : dateLocale } };
  if (apiLanguage !== undefined) obsidian.getLanguage = () => apiLanguage;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: name => {
      assert.equal(name, "obsidian");
      return obsidian;
    },
    window: {
      localStorage: {
        getItem: key => {
          assert.equal(key, "language");
          if (storageThrows) throw new Error("Storage unavailable");
          return storedLanguage;
        },
      },
    },
  });
  return { ...module.exports, setDateLocale: value => obsidian.moment.locale(value) };
}

test("UI language takes priority and survives other plugins changing date locale", () => {
  for (const language of ["zh", "zh-CN", "zh_TW", "ZH-HK"]) {
    const i18n = load(language, "en");
    for (const locale of ["en", "zh-cn", "fr"]) {
      i18n.setDateLocale(locale);
      assert.equal(i18n.t("defaultMode"), "默认模式");
      assert.equal(i18n.t("snapActive", { direction: i18n.t("snapLeft") }), "将活动悬停编辑器吸附到左侧");
    }
  }
  const english = load("en", "zh");
  english.setDateLocale("zh-cn");
  assert.equal(english.t("defaultMode"), "Default Mode");
  assert.equal(english.t("snapActive", { direction: english.t("snapLeft") }), "Snap active Hover Editor to left");
});

test("older APIs use stored UI language and default to English", () => {
  assert.equal(load(undefined, "zh_CN").t("defaultMode"), "默认模式");
  for (const language of [null, "", "en", "fr", "de"]) {
    const i18n = load(undefined, language);
    i18n.setDateLocale("zh-cn");
    assert.equal(i18n.t("defaultMode"), "Default Mode");
    const link = "folder/笔记.md#heading";
    assert.equal(i18n.t("createFile", { link }), `${link} is not yet created. Click to create.`);
  }
  assert.equal(load(undefined, null, true).t("defaultMode"), "Default Mode");
  assert.equal(load("", "zh").t("defaultMode"), "默认模式");
  assert.equal(load("en", null, true).t("defaultMode"), "Default Mode");
});
