export function parseCssUnitValue(value: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const parseUnit = require("parse-unit");
  // eslint-disable-next-line prefer-const
  let [num, unit] = parseUnit(value);
  if (!num) {
    return false;
  }
  if (!unit) {
    unit = "px";
  }
  const unitTypes = ["em", "ex", "ch", "rem", "vw", "vh", "vmin", "vmax", "%", "cm", "mm", "in", "px", "pt", "pc"];

  if (unitTypes.contains(unit)) {
    return num + unit;
  } else {
    return undefined;
  }
}

/**
 * Window-safe 'instanceof' replacement for Event and DOM class checks
 * (Compatibility wrapper for Obsidian 0.14.x: can be replaced with plain `.instanceOf()` later)
 */
export function isA<T>(el: unknown, cls: new (...args: unknown[]) => T): el is T {
  return el instanceof cls || (el as { instanceOf(cls: new () => T): boolean })?.instanceOf?.(cls);
}
