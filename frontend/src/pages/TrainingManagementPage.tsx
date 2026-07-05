import { useQuery } from "@tanstack/react-query";
import { Box, CalendarClock, FolderKanban, ImageIcon, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { apiGet, apiUrl } from "../api/client";
import type { JsonObject, Project, TrainingRun } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage, type Language } from "../i18n/LanguageProvider";

type TrainingManagementPageProps = {
  onOpenRun?: (projectId: string, runId: string) => void;
  projectId: string;
};

type TrainingSortKey = "latest" | "name" | "map50" | "precision" | "recall" | "status";

const sortOptions: Array<{ key: TrainingSortKey; labelKey: string }> = [
  { key: "latest", labelKey: "trainingManagement.sortLatest" },
  { key: "map50", labelKey: "trainingManagement.sortMap50" },
  { key: "precision", labelKey: "trainingManagement.sortPrecision" },
  { key: "recall", labelKey: "trainingManagement.sortRecall" },
  { key: "name", labelKey: "trainingManagement.sortName" },
  { key: "status", labelKey: "trainingManagement.sortStatus" },
];

const metricSortKeys: Record<Extract<TrainingSortKey, "map50" | "precision" | "recall">, string[]> = {
  map50: ["best_mAP50", "metrics/mAP50(B)", "mAP50"],
  precision: ["best_precision", "metrics/precision(B)", "precision"],
  recall: ["best_recall", "metrics/recall(B)", "recall"],
};

const statusPriority: Record<string, number> = {
  running: 0,
  queued: 1,
  completed: 2,
  failed: 3,
  canceled: 4,
  cancelled: 4,
};

function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
    "metrics/mAP50(B)": "mAP50",
    "metrics/mAP50-95(B)": "mAP50-95",
    "metrics/precision(B)": "Precision",
    "metrics/recall(B)": "Recall",
  };
  return labels[key] ?? key.replace(/^metrics\//u, "").replace(/\(B\)$/u, "");
}

function formatMetricValue(value: number): string {
  if (Math.abs(value) < 1 && value !== 0) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(3).replace(/\.?0+$/u, "");
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function runFreshness(run: TrainingRun): number {
  return Math.max(timestamp(run.finished_at), timestamp(run.updated_at), timestamp(run.created_at));
}

function summaryMetricValue(summary: JsonObject | null, keys: string[]): number | null {
  if (!summary) return null;
  for (const key of keys) {
    const value = summary[key];
    if (isFiniteNumber(value)) return value;
  }
  return null;
}

function compareNullableMetric(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function trainingRunMetrics(summary: JsonObject | null): Array<{ key: string; label: string; value: number }> {
  if (!summary) return [];
  const priorityKeys = [
    "best_mAP50",
    "best_mAP50_95",
    "best_mAP50-95",
    "best_precision",
    "best_recall",
    "metrics/mAP50(B)",
    "metrics/mAP50-95(B)",
    "metrics/precision(B)",
    "metrics/recall(B)",
  ];
  const keys = [
    ...priorityKeys.filter((key) => isFiniteNumber(summary[key])),
    ...Object.keys(summary).filter(
      (key) => !priorityKeys.includes(key) && isFiniteNumber(summary[key]),
    ),
  ];
  return keys.slice(0, 3).map((key) => ({
    key,
    label: metricLabel(key),
    value: summary[key] as number,
  }));
}

export function TrainingManagementPage({
  onOpenRun = () => undefined,
  projectId,
}: TrainingManagementPageProps) {
  const { language, t } = useLanguage();
  const [sortKey, setSortKey] = useState<TrainingSortKey>("latest");

  const projectQuery = useQuery({
    queryFn: () => apiGet<Project>(`/api/projects/${projectId}`),
    queryKey: ["projects", projectId],
  });

  const trainingRunsQuery = useQuery({
    queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${projectId}/training-runs`),
    queryKey: ["projects", projectId, "training-runs"],
  });
  const trainingRuns = trainingRunsQuery.data ?? [];
  const sortedTrainingRuns = useMemo(() => {
    return [...trainingRuns].sort((left, right) => {
      if (sortKey === "name") {
        const nameCompare = left.name.localeCompare(right.name, language === "ko" ? "ko-KR" : "en-US", {
          numeric: true,
          sensitivity: "base",
        });
        return nameCompare || runFreshness(right) - runFreshness(left);
      }
      if (sortKey === "status") {
        const statusCompare =
          (statusPriority[left.status] ?? 99) - (statusPriority[right.status] ?? 99);
        return statusCompare || runFreshness(right) - runFreshness(left);
      }
      if (sortKey === "map50" || sortKey === "precision" || sortKey === "recall") {
        const metricCompare = compareNullableMetric(
          summaryMetricValue(left.metrics_summary, metricSortKeys[sortKey]),
          summaryMetricValue(right.metrics_summary, metricSortKeys[sortKey]),
        );
        return metricCompare || runFreshness(right) - runFreshness(left);
      }
      return runFreshness(right) - runFreshness(left);
    });
  }, [language, sortKey, trainingRuns]);

  return (
    <section className="training-management">
      {projectQuery.isError ? (
        <div className="empty-state empty-state--page">
          <span className="empty-state__icon" aria-hidden="true">
            <FolderKanban size={34} />
          </span>
          <div>
            <h2>{t("projects.empty")}</h2>
            <p>{t("trainingManagement.projectRequired")}</p>
          </div>
        </div>
      ) : null}

      {projectQuery.data ? (
        <div className="training-management__layout">
          <div className="training-result-list-panel">
            <div className="panel__header">
              <div>
                <h2>{t("trainingManagement.runs")}</h2>
                <p>{projectQuery.data.name}</p>
              </div>
              <div className="training-result-toolbar">
                {projectQuery.isFetching || trainingRunsQuery.isFetching ? (
                  <Loader2 aria-hidden="true" className="spin" size={18} />
                ) : null}
                <label>
                  <span>{t("trainingManagement.sort")}</span>
                  <select
                    aria-label={t("trainingManagement.sort")}
                    onChange={(event) => setSortKey(event.target.value as TrainingSortKey)}
                    value={sortKey}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {trainingRuns.length > 0 ? (
              <div className="training-result-card-grid">
                {sortedTrainingRuns.map((run) => {
                  const metrics = trainingRunMetrics(run.metrics_summary);
                  return (
                    <button
                      className="training-result-card"
                      key={run.id}
                      onClick={() => onOpenRun(projectId, run.id)}
                      type="button"
                    >
                      <span className="training-result-card__thumbnail">
                        <ImageIcon aria-hidden="true" size={22} />
                        {run.artifact_path ? (
                          <img
                            alt=""
                            data-training-thumbnail={run.id}
                            onError={(event) => {
                              event.currentTarget.hidden = true;
                            }}
                            src={apiUrl(`/api/projects/${projectId}/training-runs/${run.id}/thumbnail`)}
                          />
                        ) : null}
                      </span>
                      <span className="training-result-card__body">
                        <span className="training-result-card__title">
                          <strong>{run.name}</strong>
                          <StatusBadge status={run.status} />
                        </span>
                        <span className="training-result-card__meta">
                          <span>
                            <Box aria-hidden="true" size={14} />
                            {run.model_name}
                          </span>
                          <span>
                            <CalendarClock aria-hidden="true" size={14} />
                            {formatDate(run.created_at, language)}
                          </span>
                        </span>
                        {metrics.length > 0 ? (
                          <span className="training-result-card__metrics">
                            {metrics.map((metric) => (
                              <span key={metric.key}>
                                <small>{metric.label}</small>
                                <strong>{formatMetricValue(metric.value)}</strong>
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>
                  {trainingRunsQuery.isLoading
                    ? t("training.listLoading")
                    : t("trainingManagement.empty")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
