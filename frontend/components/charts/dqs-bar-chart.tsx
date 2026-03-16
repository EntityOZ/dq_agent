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
    <div className="rounded-lg border border-[#D6E4F0] bg-white px-3 py-2 shadow-sm">
      <p className="font-sans text-xs text-[#6B92AD]">{d.date}</p>
      {d.label && (
        <p className="font-sans text-xs text-[#3D6080]">{d.label}</p>
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
          stroke="#E2EBF3"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6B92AD", fontSize: 11 }}
          axisLine={{ stroke: "#D6E4F0" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6B92AD", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F5F9FF" }} />
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
