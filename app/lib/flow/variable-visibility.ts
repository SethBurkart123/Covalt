import type { VariableSpec } from "@nodes/_variables";

export function isPresentVariableValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

export function isMissingRequiredValue(spec: VariableSpec, value: unknown): boolean {
  if (!spec.required) return false;
  return !isPresentVariableValue(value);
}

export function isSpecVisible(spec: VariableSpec, values: Record<string, unknown>): boolean {
  const showWhen = spec.show_when;
  if (!showWhen) return true;

  const checks: boolean[] = [];

  if (showWhen.valueEquals) {
    for (const rule of showWhen.valueEquals) {
      checks.push(Object.is(values[rule.paramId], rule.value));
    }
  }
  if (showWhen.valueIn) {
    for (const rule of showWhen.valueIn) {
      checks.push(
        Array.isArray(rule.values) &&
          rule.values.some((v) => Object.is(values[rule.paramId], v)),
      );
    }
  }
  if (showWhen.valueNotEquals) {
    for (const rule of showWhen.valueNotEquals) {
      checks.push(!Object.is(values[rule.paramId], rule.value));
    }
  }
  if (showWhen.valueNotIn) {
    for (const rule of showWhen.valueNotIn) {
      checks.push(
        !(
          Array.isArray(rule.values) &&
          rule.values.some((v) => Object.is(values[rule.paramId], v))
        ),
      );
    }
  }
  if (showWhen.exists) {
    for (const paramId of showWhen.exists) {
      checks.push(isPresentVariableValue(values[paramId]));
    }
  }
  if (showWhen.notExists) {
    for (const paramId of showWhen.notExists) {
      checks.push(!isPresentVariableValue(values[paramId]));
    }
  }

  if (checks.length === 0) return true;
  return checks.every(Boolean);
}
