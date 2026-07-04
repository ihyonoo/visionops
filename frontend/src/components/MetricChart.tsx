import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { JsonObject } from "../api/types";
import { useLanguage } from "../i18n/LanguageProvider";

type MetricChartProps = {
  emptyLabel?: string;
  metricKeys: string[];
  rows: JsonObject[];
  title: string;
};

const CHART_COLORS = [
  "var(--accent)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--danger)",
];

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function stepValue(row: JsonObject, index: number): number {
  return (
    toFiniteNumber(row.epoch) ??
    toFiniteNumber(row.Epoch) ??
    toFiniteNumber(row.step) ??
    toFiniteNumber(row.iteration) ??
    index + 1
  );
}

function compactMetricName(key: string): string {
  return key
    .replace(/^metrics\//, "")
    .replace(/^train\//, "train ")
    .replace(/^val\//, "val ")
    .replace(/\(B\)$/u, "")
    .replace(/_/gu, " ");
}

export function MetricChart({
  emptyLabel,
  metricKeys,
  rows,
  title,
}: MetricChartProps) {
  const { t } = useLanguage();
  const resolvedEmptyLabel = emptyLabel ?? t("metrics.empty");
  const usableKeys = metricKeys.filter((key) =>
    rows.some((row) => toFiniteNumber(row[key]) !== null),
  );
  const data = rows.map((row, index) => {
    const point: Record<string, number> = {
      step: stepValue(row, index),
    };
    for (const key of usableKeys) {
      const value = toFiniteNumber(row[key]);
      if (value !== null) point[key] = value;
    }
    return point;
  });

  return (
    <div className="metric-chart">
      <div className="metric-chart__header">
        <h3>{title}</h3>
      </div>
      {usableKeys.length > 0 && data.length > 0 ? (
        <div className="metric-chart__canvas">
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={data} margin={{ bottom: 4, left: 0, right: 12, top: 10 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="step"
                tick={{ fill: "var(--muted-text)", fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-text)", fontSize: 12 }}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                }}
                labelFormatter={(label) => `step ${label}`}
              />
              <Legend formatter={(value) => compactMetricName(String(value))} />
              {usableKeys.map((key, index) => (
                <Line
                  connectNulls
                  dataKey={key}
                  dot={false}
                  isAnimationActive={false}
                  key={key}
                  name={compactMetricName(key)}
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth={2}
                  type="monotone"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty-state empty-state--compact">
          <p>{resolvedEmptyLabel}</p>
        </div>
      )}
    </div>
  );
}
