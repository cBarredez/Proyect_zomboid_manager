/** Converts a PascalCase/camelCase config key into a readable label, e.g. "PublicName" -> "Public Name". */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}
