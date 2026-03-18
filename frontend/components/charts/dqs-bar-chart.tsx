"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface BarDataPoint {
  date: string;
  label: string;
  score: number;
}

interface DqsBarChartProps {
  data: BarDataPoint[];
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BarDataPoint; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-[#D0DBE5] bg-white px-3 py-2 shadow-sm">
      <p className="font-sans text-xs text-[#6B8299]">{d.date}</p>
      {d.label && (
        <p className="font-sans text-xs text-[#3D5068]">{d.label}</p>
      )}
      <p className="font-display text-sm font-bold text-[#0695A8]">
        {d.score.toFixed(1)}
      </p>
    </div>
  );
}

export function DqsBarChart({ data }: DqsBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#EAF0F6"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6B8299", fontSize: 11 }}
          axisLine={{ stroke: "#D0DBE5" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6B8299", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F3F7FB" }} />
        <Bar
          dataKey="score"
          fill="#0695A8"
          radius={[4, 4, 0, 0]}
          isAnimationActive={true}
          animationDuration={600}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
