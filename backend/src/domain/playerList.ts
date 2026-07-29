/**
 * Parses PZ's RCON `players` command output, e.g.:
 *   "Players connected (2):\n-Bob\n-Alice"
 * into a plain list of usernames.
 */
export function parsePlayersResponse(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

/**
 * Wraps a value for embedding as a quoted RCON command argument, stripping
 * characters that could break out of the quotes or inject a second command.
 */
export function quoteRconArg(value: string): string {
  const sanitized = value.replace(/["\r\n]/g, "").trim();
  return `"${sanitized}"`;
}
