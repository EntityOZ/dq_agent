/** Score color: green ≥85, amber 60–84, red <60 */
export function scoreColor(score: number): string {
  if (score >= 85) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

export function scoreBg(score: number): string {
  if (score >= 85) return "bg-green-600/15 text-green-400";
  if (score >= 60) return "bg-amber-600/15 text-amber-400";
  return "bg-red-600/15 text-red-400";
}

/** "business_partner" → "Business Partner" */
export function formatModuleName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Relative time: "2 hours ago", "3 days ago" */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-black";
    case "low":
      return "bg-green-600 text-white";
    default:
      return "bg-gray-500 text-white";
  }
}

export function passRateColor(rate: number): string {
  if (rate >= 95) return "bg-green-600";
  if (rate >= 80) return "bg-amber-500";
  return "bg-red-600";
}
