/** Score color: green >=85, amber 60-84, red <60 */
export function scoreColor(score: number): string {
  if (score >= 85) return "#10B981";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

export function scoreBg(score: number): string {
  if (score >= 85) return "bg-[#10B981]/10 text-[#10B981]";
  if (score >= 60) return "bg-[#F59E0B]/10 text-[#F59E0B]";
  return "bg-[#EF4444]/10 text-[#EF4444]";
}

/** "business_partner" -> "Business Partner" */
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

/** Severity badge pill classes */
export function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-[#FEF2F2] text-[#EF4444] border border-[#FECACA]";
    case "high":
      return "bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]";
    case "medium":
      return "bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]";
    case "low":
      return "bg-[#E0F4F7] text-[#0695A8] border border-[#B2E0E6]";
    default:
      return "bg-[#F1F5F9] text-[#6B8299] border border-[#E2E8F0]";
  }
}

export function passRateColor(rate: number): string {
  if (rate >= 95) return "bg-[#10B981]";
  if (rate >= 80) return "bg-[#F59E0B]";
  return "bg-[#EF4444]";
}
