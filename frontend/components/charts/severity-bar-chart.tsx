"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, LabelList } from "recharts";

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface SeverityBarChartProps {
  counts: SeverityCounts;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#DC2626",
  High: "#D97706",
  Medium: "#F59E0B",
  Low: "#D0EEF2",
};

const SEVERITY_TEXT_COLORS: Record<string, string> = {
  Critical: "#DC2626",
  High: "#D97706",
  Medium: "#B45309",
  Low: "#0695A8",
};

export function SeverityBarChart({ counts }: SeverityBarChartProps) {
  const data = [
    { name: "Critical", count: counts.critical },
    { name: "High", count: counts.high },
    { name: "Medium", count: counts.medium },
    { name: "Low", count: counts.low },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -16 }}>
        <XAxis
          dataKey="name"
          tick={{ fill: "#6B92AD", fontSize: 11 }}
          axisLine={{ stroke: "#D6E4F0" }}
          tickLine={false}
        />
        <YAxis hide />
        <Bar
          dataKey="count"
          radius={[4, 4, 0, 0]}
          isAnimationActive={true}
          animationDuration={600}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name]} />
          ))}
          <LabelList
            dataKey="count"
            position="top"
            style={{ fontSize: 11, fontWeight: 600 }}
            formatter={(value) => (Number(value) > 0 ? String(value) : "")}
            fill="#3D6080"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
