/** Format a date for display: "Mar 19, 2:30 PM" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format P&L with sign: "+1.23" or "-0.45" */
export function formatPnl(n: number, decimals = 2): string {
  return (n >= 0 ? "+" : "") + n.toFixed(decimals);
}

/** Format percentage with sign: "+12.3%" */
export function formatPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

/** Format file size: "14.2 KB" or "892 B" */
export function formatFileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Format duration from milliseconds: "4h 8m" or "23m" */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
