import { useQuery } from "@tanstack/react-query";
import { Box, Clock3, FileArchive, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";

import { apiGet } from "../api/client";
import type { JsonObject, ModelArtifact, TrainingMetrics, TrainingRun } from "../api/types";
import { LogViewer } from "../components/LogViewer";
import { MetricChart } from "../components/MetricChart";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage, type Language } from "../i18n/LanguageProvider";

type TrainingRunPageProps = {
  initialRun?: TrainingRun | null;
  projectId: string;
  runId: string | null;
};

const SUMMARY_PRIORITY_KEYS = [
  "best_mAP50",
  "best_mAP50_95",
  "best_mAP50-95",
  "best_precision",
  "best_recall",
  "metrics/mAP50(B)",
  "metrics/mAP50-95(B)",
  "metrics/precision(B)",
  "metrics/recall(B)",
  "mAP50",
  "mAP50-95",
  "precision",
  "recall",
];

const LOSS_PRIORITY_KEYS = [
  "train/box_loss",
  "train/cls_loss",
  "train/dfl_loss",
  "val/box_loss",
  "val/cls_loss",
  "val/dfl_loss",
];

const QUALITY_PRIORITY_KEYS = [
  "metrics/mAP50(B)",
  "metrics/mAP50-95(B)",
  "metrics/precision(B)",
  "metrics/recall(B)",
  "mAP50",
  "mAP50-95",
  "precision",
  "recall",
  "fitness",
];

function formatDateTime(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatElapsed(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
  language: Language,
): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";

  const totalSeconds = Math.round((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (language === "en") {
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    best_mAP50: "Best mAP50",
    best_mAP50_95: "Best mAP50-95",
    "best_mAP50-95": "Best mAP50-95",
    best_precision: "Best Precision",
    best_recall: "Best Recall",
    last_epoch: "Last epoch",
    "metrics/mAP50(B)": "mAP50",
    "metrics/mAP50-95(B)": "mAP50-95",
    "metrics/precision(B)": "Precision",
    "metrics/recall(B)": "Recall",
  };
  return labels[key] ?? key.replace(/^metrics\//, "").replace(/\(B\)$/u, "");
}

function formatMetricValue(value: number): string {
  if (Math.abs(value) < 1 && value !== 0) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(3).replace(/\.?0+$/u, "");
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function orderedNumericKeys(
  rows: JsonObject[],
  priorityKeys: string[],
  fallbackMatch: (key: string) => boolean,
  limit = 5,
): string[] {
  const availableKeys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (isFiniteNumber(value)) availableKeys.add(key);
    }
  }

  const priority = priorityKeys.filter((key) => availableKeys.has(key));
  const fallback = Array.from(availableKeys)
    .filter((key) => !priority.includes(key) && fallbackMatch(key))
    .sort((left, right) => left.localeCompare(right));

  return [...priority, ...fallback].slice(0, limit);
}

function summaryMetrics(summary: JsonObject): Array<{ key: string; label: string; value: number }> {
  const numericEntries = Object.entries(summary).filter((entry): entry is [string, number] =>
    isFiniteNumber(entry[1]),
  );
  const priorityMetrics = SUMMARY_PRIORITY_KEYS.flatMap((key) => {
    const value = summary[key];
    return isFiniteNumber(value) ? [{ key, label: metricLabel(key), value }] : [];
  });
  const fallbackMetrics = numericEntries
    .filter(
      ([key]) =>
        !priorityMetrics.some((metric) => metric.key === key) &&
        (priorityMetrics.length === 0 || !/epoch/iu.test(key)),
    )
    .slice(0, Math.max(0, 4 - priorityMetrics.length))
    .map(([key, value]) => ({ key, label: metricLabel(key), value }));

  return [...priorityMetrics, ...fallbackMetrics].slice(0, 4);
}

function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function TrainingRunPage({ initialRun, projectId, runId }: TrainingRunPageProps) {
  const { language, t } = useLanguage();
  const runQuery = useQuery({
    enabled: Boolean(runId),
    initialData: initialRun ?? undefined,
    queryFn: () => apiGet<TrainingRun>(`/api/projects/${projectId}/training-runs/${runId as string}`),
    queryKey: ["projects", projectId, "training-runs", runId],
  });

  const metricsQuery = useQuery({
    enabled: Boolean(runId),
    queryFn: () =>
      apiGet<TrainingMetrics>(`/api/projects/${projectId}/training-runs/${runId as string}/metrics`),
    queryKey: ["projects", projectId, "training-runs", runId, "metrics"],
  });

  const artifactsQuery = useQuery({
    enabled: Boolean(runId),
    queryFn: () =>
      apiGet<ModelArtifact[]>(
        `/api/projects/${projectId}/training-runs/${runId as string}/artifacts`,
      ),
    queryKey: ["projects", projectId, "training-runs", runId, "artifacts"],
  });

  const run = runQuery.data ?? initialRun ?? null;
  const rows = metricsQuery.data?.rows ?? [];
  const summary = metricsQuery.data?.summary ?? run?.metrics_summary ?? {};
  const visibleSummaryMetrics = useMemo(() => summaryMetrics(summary), [summary]);
  const lossKeys = useMemo(
    () => orderedNumericKeys(rows, LOSS_PRIORITY_KEYS, (key) => key.toLowerCase().includes("loss")),
    [rows],
  );
  const qualityKeys = useMemo(
    () =>
      orderedNumericKeys(
        rows,
        QUALITY_PRIORITY_KEYS,
        (key) => /map|precision|recall|fitness/iu.test(key),
      ),
    [rows],
  );

  if (!runId || !run) {
    return (
      <section className="panel training-detail" aria-label={t("training.detail")}>
        <div className="panel__header">
          <div>
            <p className="section-label">{t("training.detail")}</p>
            <h2>{t("training.run")}</h2>
          </div>
        </div>
        <div className="empty-state empty-state--compact">
          <p>{t("training.noRunSelected")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="training-detail" aria-label={t("training.detail")}>
      <div className="panel training-detail__header">
        <div>
          <p className="section-label">{t("training.detail")}</p>
          <h2>{run.name}</h2>
        </div>
        <StatusBadge status={run.status} />
        <div className="training-detail__meta">
          <span>
            <Box aria-hidden="true" size={15} />
            {run.model_name}
          </span>
          <span>
            <Clock3 aria-hidden="true" size={15} />
            {formatElapsed(run.started_at, run.finished_at, language)}
          </span>
        </div>
      </div>

      <div className="metric-card-grid">
        {visibleSummaryMetrics.length > 0 ? (
          visibleSummaryMetrics.map((metric) => (
            <div className="metric-card" key={metric.key}>
              <span>{metric.label}</span>
              <strong>{formatMetricValue(metric.value)}</strong>
            </div>
          ))
        ) : (
          <div className="metric-card metric-card--empty">
            <span>{t("training.summaryMetrics")}</span>
            <strong>-</strong>
          </div>
        )}
      </div>

      <div className="training-info-grid">
        <div className="panel">
          <div className="panel__header">
            <div>
              <p className="section-label">{t("training.timeline")}</p>
              <h2>{t("training.elapsed")}</h2>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>{t("training.created")}</dt>
              <dd>{formatDateTime(run.created_at, language)}</dd>
            </div>
            <div>
              <dt>{t("training.started")}</dt>
              <dd>{formatDateTime(run.started_at, language)}</dd>
            </div>
            <div>
              <dt>{t("training.finished")}</dt>
              <dd>{formatDateTime(run.finished_at, language)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div>
              <p className="section-label">Config</p>
              <h2>Snapshot</h2>
            </div>
            <SlidersHorizontal aria-hidden="true" size={18} />
          </div>
          <dl className="config-grid">
            {Object.entries(run.config ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatConfigValue(value)}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(run.config ?? {}).length === 0 ? (
            <div className="empty-state empty-state--compact">
              <p>{t("training.emptyConfig")}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="chart-grid">
        <MetricChart
          emptyLabel={t("training.emptyLoss")}
          metricKeys={lossKeys}
          rows={rows}
          title="Loss"
        />
        <MetricChart
          emptyLabel={t("training.emptyQuality")}
          metricKeys={qualityKeys}
          rows={rows}
          title={t("training.qualityMetrics")}
        />
      </div>

      <div className="panel">
        <LogViewer projectId={projectId} runId={run.id} status={run.status} />
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <p className="section-label">Models</p>
            <h2>{t("training.modelFiles")}</h2>
          </div>
          <FileArchive aria-hidden="true" size={18} />
        </div>
        {(artifactsQuery.data ?? []).length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("training.modelKind")}</th>
                  <th>{t("training.modelPath")}</th>
                  <th>{t("training.created")}</th>
                </tr>
              </thead>
              <tbody>
                {(artifactsQuery.data ?? []).map((artifact) => (
                  <tr key={artifact.id}>
                    <td>{artifact.kind}</td>
                    <td>{artifact.path}</td>
                    <td>{formatDateTime(artifact.created_at, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            <p>{t("training.modelFilesEmpty")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
