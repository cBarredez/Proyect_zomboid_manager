export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatPercentPair(avg: number | null, peak: number | null): string {
  if (avg === null && peak === null) return "—";
  const a = avg === null ? "—" : `${avg.toFixed(1)}%`;
  const p = peak === null ? "—" : `${peak.toFixed(1)}%`;
  return `${a} / ${p}`;
}
