import { humanizeKey } from "./textUtils.js";

export type IniValueType = "boolean" | "number" | "string";

export interface IniField {
  key: string;
  label: string;
  type: IniValueType;
  value: boolean | number | string;
}

export interface IniUpdate {
  key: string;
  value: boolean | number | string;
}

interface InternalIniField extends IniField {
  valueStart: number;
  valueEnd: number;
}

const LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Parses PZ's `<servername>.ini`: a flat `Key=Value` format, one setting per
 * line, `#` comments, no sections or quoting. Far simpler than
 * SandboxVars.lua, so this is a plain line scanner rather than a brace-aware
 * one.
 */
export function parseServerIni(source: string): IniField[] {
  return scanIni(source).map(({ key, label, type, value }) => ({ key, label, type, value }));
}

/**
 * Upserts fields into the ini: existing keys are patched in place (value
 * token replaced without touching the rest of the line/file), unknown keys
 * are appended as new lines. This is what lets the panel keep `Mods=`,
 * `RCONPassword=`, etc. in sync even before PZ has ever written them itself.
 */
export interface UpsertIniOptions {
  guardedKeys?: ReadonlySet<string>;
  /** When false, a type mismatch on an existing key overwrites instead of throwing. Default true. */
  strict?: boolean;
}

export function upsertIniFields(source: string, updates: IniUpdate[], options: UpsertIniOptions = {}): string {
  const { guardedKeys = new Set<string>(), strict = true } = options;

  for (const update of updates) {
    if (guardedKeys.has(update.key)) {
      throw new Error(`"${update.key}" is managed automatically and cannot be edited directly`);
    }
  }

  const fields = scanIni(source);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const existingEdits = updates
    .filter((u) => byKey.has(u.key))
    .map((u) => {
      const field = byKey.get(u.key)!;
      if (strict && typeof u.value !== field.type) {
        throw new Error(`"${u.key}" expects a ${field.type} value`);
      }
      return { field, token: serializeToken(u.value) };
    })
    .sort((a, b) => b.field.valueStart - a.field.valueStart);

  let result = source;
  for (const edit of existingEdits) {
    result = result.slice(0, edit.field.valueStart) + edit.token + result.slice(edit.field.valueEnd);
  }

  for (const update of updates.filter((u) => !byKey.has(u.key))) {
    const needsNewline = result.length > 0 && !result.endsWith("\n");
    result += `${needsNewline ? "\n" : ""}${update.key}=${serializeToken(update.value)}\n`;
  }

  return result;
}

function scanIni(source: string): InternalIniField[] {
  const fields: InternalIniField[] = [];
  let i = 0;

  while (i < source.length) {
    let lineEnd = source.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = source.length;
    const lineStart = i;
    const line = source.slice(lineStart, lineEnd);
    i = lineEnd + 1;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;

    const hasTrailingCr = rawValue.endsWith("\r");
    const tokenRaw = hasTrailingCr ? rawValue.slice(0, -1) : rawValue;

    const valueStartAbs = lineStart + key.length + 1;
    const valueEndAbs = valueStartAbs + tokenRaw.length;
    const parsed = parseToken(tokenRaw);

    fields.push({
      key,
      label: humanizeKey(key),
      type: parsed.type,
      value: parsed.value,
      valueStart: valueStartAbs,
      valueEnd: valueEndAbs,
    });
  }

  return fields;
}

function parseToken(raw: string): { type: IniValueType; value: boolean | number | string } {
  if (raw === "true") return { type: "boolean", value: true };
  if (raw === "false") return { type: "boolean", value: false };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { type: "number", value: Number(raw) };
  return { type: "string", value: raw };
}

function serializeToken(value: boolean | number | string): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
