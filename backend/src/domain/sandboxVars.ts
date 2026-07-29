import { humanizeKey } from "./textUtils.js";

export type SandboxValueType = "boolean" | "number" | "string";

export interface SandboxField {
  path: string;
  label: string;
  type: SandboxValueType;
  value: boolean | number | string;
}

export interface SandboxGroup {
  name: string;
  fields: SandboxField[];
}

export interface SandboxUpdate {
  path: string;
  value: boolean | number | string;
}

interface InternalField extends SandboxField {
  valueStart: number;
  valueEnd: number;
  quoted: boolean;
}

/**
 * Reads PZ's `<servername>_SandboxVars.lua` into UI-friendly groups, without
 * a full Lua parser: it locates the `SandboxVars = { ... }` table, walks its
 * `key = value` lines, and treats any `key = { ... }` line as one extra
 * level of nesting (which covers the real file's shape — a mostly-flat
 * table with a handful of nested sub-tables like `ZombieLore`). Anything the
 * scanner can't confidently classify is left out rather than guessed at.
 */
export function parseSandboxVars(source: string): SandboxGroup[] {
  const fields = scanSandboxVars(source);
  const groups = new Map<string, SandboxField[]>();

  for (const field of fields) {
    const groupName = field.path.includes(".") ? humanizeKey(field.path.split(".")[0]) : "General";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push({ path: field.path, label: field.label, type: field.type, value: field.value });
  }

  return [...groups.entries()].map(([name, groupFields]) => ({ name, fields: groupFields }));
}

/** Applies a batch of `path`/`value` edits, splicing only the changed value tokens. */
export function applySandboxUpdates(source: string, updates: SandboxUpdate[]): string {
  const fields = scanSandboxVars(source);
  const byPath = new Map(fields.map((f) => [f.path, f]));

  const edits = updates.map((update) => {
    const field = byPath.get(update.path);
    if (!field) throw new Error(`unknown sandbox setting: ${update.path}`);
    if (typeof update.value !== field.type) {
      throw new Error(`sandbox setting ${update.path} expects a ${field.type} value`);
    }
    return { field, token: serializeToken(update.value, field.quoted) };
  });

  edits.sort((a, b) => b.field.valueStart - a.field.valueStart);

  let result = source;
  for (const edit of edits) {
    result = result.slice(0, edit.field.valueStart) + edit.token + result.slice(edit.field.valueEnd);
  }
  return result;
}

function scanSandboxVars(source: string): InternalField[] {
  const header = /SandboxVars\s*=\s*\{/.exec(source);
  if (!header) throw new Error("SandboxVars table not found in file");

  const openBrace = header.index + header[0].length - 1;
  const closeBrace = findMatchingBrace(source, openBrace);

  const fields: InternalField[] = [];
  scanBlock(source, openBrace + 1, closeBrace, "", fields);
  return fields;
}

const LINE_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function scanBlock(source: string, start: number, end: number, groupPath: string, fields: InternalField[]): void {
  let i = start;

  while (i < end) {
    let lineEnd = source.indexOf("\n", i);
    if (lineEnd === -1 || lineEnd > end) lineEnd = end;
    const lineStart = i;
    const line = source.slice(lineStart, lineEnd);
    i = lineEnd + 1;

    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, indent, key, rest] = match;

    const eqIdxInLine = indent.length + key.length + line.slice(indent.length + key.length).indexOf("=");
    let valueStartInLine = eqIdxInLine + 1;
    while (valueStartInLine < line.length && /\s/.test(line[valueStartInLine])) valueStartInLine++;

    if (rest.trimStart().startsWith("{")) {
      const braceOpenAbs = lineStart + line.indexOf("{", valueStartInLine);
      const braceCloseAbs = findMatchingBrace(source, braceOpenAbs);
      const nestedPath = groupPath ? `${groupPath}.${key}` : key;
      scanBlock(source, braceOpenAbs + 1, braceCloseAbs, nestedPath, fields);

      const nextNewline = source.indexOf("\n", braceCloseAbs);
      i = nextNewline === -1 ? end : nextNewline + 1;
      continue;
    }

    let tokenRaw = line.slice(valueStartInLine).trimEnd();
    if (tokenRaw.endsWith(",")) tokenRaw = tokenRaw.slice(0, -1).trimEnd();
    if (!tokenRaw) continue;

    const valueStartAbs = lineStart + valueStartInLine;
    const valueEndAbs = valueStartAbs + tokenRaw.length;
    const parsed = parseToken(tokenRaw);

    fields.push({
      path: groupPath ? `${groupPath}.${key}` : key,
      label: humanizeKey(key),
      type: parsed.type,
      value: parsed.value,
      valueStart: valueStartAbs,
      valueEnd: valueEndAbs,
      quoted: parsed.quoted,
    });
  }
}

function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  let inString: string | null = null;

  while (i < source.length && depth > 0) {
    const c = source[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
    } else if (c === '"' || c === "'") {
      inString = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
    i++;
  }

  return i - 1;
}

function parseToken(raw: string): { type: SandboxValueType; value: boolean | number | string; quoted: boolean } {
  if (raw === "true") return { type: "boolean", value: true, quoted: false };
  if (raw === "false") return { type: "boolean", value: false, quoted: false };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { type: "number", value: Number(raw), quoted: false };

  const quoteChar = raw[0];
  if ((quoteChar === '"' || quoteChar === "'") && raw.endsWith(quoteChar) && raw.length >= 2) {
    return { type: "string", value: raw.slice(1, -1), quoted: true };
  }

  return { type: "string", value: raw, quoted: false };
}

function serializeToken(value: boolean | number | string, quoted: boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (quoted) return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return value;
}
