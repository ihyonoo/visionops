import { useQuery } from "@tanstack/react-query";
import { Box, Clock3, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiGet, apiUrl } from "../api/client";
import type { JsonObject, ModelArtifact, TrainingDownload, TrainingMetrics, TrainingRun } from "../api/types";
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
    best_mAP50: "mAP50",
    best_mAP50_95: "mAP50-95",
    "best_mAP50-95": "mAP50-95",
    best_precision: "Precision",
    best_recall: "Recall",
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

function artifactDownloadLabel(artifact: ModelArtifact): string {
  return artifact.kind.endsWith(".pt") ? artifact.kind : `${artifact.kind}.pt`;
}

function fallbackDownloads(projectId: string, run: TrainingRun, artifacts: ModelArtifact[]): TrainingDownload[] {
  if (!run.artifact_path) return [];
  return [
    {
      filename: "results.csv",
      kind: "metrics",
      label: "results.csv",
      url: `/api/projects/${projectId}/training-runs/${run.id}/results.csv`,
    },
    ...artifacts.map((artifact) => ({
      filename: artifactDownloadLabel(artifact),
      kind: `model_${artifact.kind}`,
      label: artifactDownloadLabel(artifact),
      url: `/api/projects/${projectId}/training-runs/${run.id}/artifacts/${artifact.id}/download`,
    })),
  ];
}

export function TrainingRunPage({ initialRun, projectId, runId }: TrainingRunPageProps) {
  const { language, t } = useLanguage();
  const [selectedReportImage, setSelectedReportImage] = useState<TrainingDownload | null>(null);
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

  const downloadsQuery = useQuery({
    enabled: Boolean(runId),
    queryFn: () =>
      apiGet<TrainingDownload[]>(
        `/api/projects/${projectId}/training-runs/${runId as string}/downloads`,
      ),
    queryKey: ["projects", projectId, "training-runs", runId, "downloads"],
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
  const downloadLinks =
    downloadsQuery.data && downloadsQuery.data.length > 0
      ? downloadsQuery.data
      : run
        ? fallbackDownloads(projectId, run, artifactsQuery.data ?? [])
        : [];
  const downloadableLinks = downloadLinks.filter((download) => download.kind !== "report_image");
  const reportImages = downloadLinks.filter((download) => download.kind === "report_image");
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

  useEffect(() => {
    if (!selectedReportImage) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedReportImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedReportImage]);

  if (!runId || !run) {
    return (
      <section className="panel training-detail" aria-label={t("training.detail")}>
        <div className="panel__header">
          <div>
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
          <h2>{run.name}</h2>
        </div>
        <StatusBadge status={run.status} />
        <div className="training-detail__meta">
          <span className="training-detail__model">
            <Box aria-hidden="true" size={15} />
            {run.model_name}
          </span>
          <span>
            <Clock3 aria-hidden="true" size={15} />
            {formatElapsed(run.started_at, run.finished_at, language)}
          </span>
          <span>{t("training.started")} {formatDateTime(run.started_at, language)}</span>
          <span>{t("training.finished")} {formatDateTime(run.finished_at, language)}</span>
        </div>
        <div className="training-detail__summary">
          {visibleSummaryMetrics.length > 0 ? (
            visibleSummaryMetrics.map((metric) => (
              <div key={metric.key}>
                <span>{metric.label}</span>
                <strong>{formatMetricValue(metric.value)}</strong>
              </div>
            ))
          ) : (
            <div>
              <span>{t("training.summaryMetrics")}</span>
              <strong>-</strong>
            </div>
          )}
        </div>
        {downloadableLinks.length > 0 ? (
          <div className="training-detail__downloads" aria-label={t("training.download")}>
            {downloadableLinks.map((download) => (
              <a className="secondary-button" href={apiUrl(download.url)} key={download.url}>
                {download.label}
              </a>
            ))}
          </div>
        ) : null}
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

      {reportImages.length > 0 ? (
        <div className="panel training-report-panel">
          <div className="panel__header">
            <div>
              <h2>{t("training.reportImages")}</h2>
            </div>
          </div>
          <div className="training-report-grid">
            {reportImages.map((image) => (
              <figure className="training-report-card" key={image.url}>
                <button
                  aria-label={`${image.label} ${t("training.openReportImage")}`}
                  onClick={() => setSelectedReportImage(image)}
                  type="button"
                >
                  <img alt={image.label} src={apiUrl(image.url)} />
                </button>
                <figcaption>{image.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      {selectedReportImage ? (
        <div
          className="modal-backdrop training-image-modal-backdrop"
          onClick={() => setSelectedReportImage(null)}
          role="presentation"
        >
          <div
            aria-labelledby="training-report-image-title"
            aria-modal="true"
            className="training-image-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="training-image-modal__header">
              <h2 id="training-report-image-title">{selectedReportImage.label}</h2>
              <button
                aria-label={t("common.close")}
                className="icon-button"
                onClick={() => setSelectedReportImage(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <img alt={selectedReportImage.label} src={apiUrl(selectedReportImage.url)} />
          </div>
        </div>
      ) : null}

      <div className="panel training-result-log-panel">
        <div className="panel__header">
          <div>
            <h2>{t("log.saved")}</h2>
          </div>
        </div>
        <LogViewer projectId={projectId} runId={run.id} status={run.status} />
      </div>
    </section>
  );
}
