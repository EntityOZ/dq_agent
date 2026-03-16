/** Score color: green ≥85, amber 60–84, red <60 */
export function scoreColor(score: number): string {
  if (score >= 85) return "#059669";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

export function scoreBg(score: number): string {
  if (score >= 85) return "bg-[#059669]/10 text-[#059669]";
  if (score >= 60) return "bg-[#D97706]/10 text-[#D97706]";
  return "bg-[#DC2626]/10 text-[#DC2626]";
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

/** Severity badge pill classes for light theme */
export function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]";
    case "high":
      return "bg-[#FEF3C7] text-[#D97706] border border-[#FCD34D]";
    case "medium":
      return "bg-[#FFF9C4] text-[#B45309] border border-[#FDE68A]";
    case "low":
      return "bg-[#CCEFF1] text-[#0695A8] border border-[#99D9E0]";
    default:
      return "bg-[#F0F5FA] text-[#6B92AD] border border-[#D6E4F0]";
  }
}

export function passRateColor(rate: number): string {
  if (rate >= 95) return "bg-[#059669]";
  if (rate >= 80) return "bg-[#D97706]";
  return "bg-[#DC2626]";
}
