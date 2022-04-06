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
