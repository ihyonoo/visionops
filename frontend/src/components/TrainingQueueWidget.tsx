import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import type { Project, RuntimeCheck, RuntimeInstallResult, TrainingRun } from "../api/types";
import { useLanguage, type Language, type TranslationFunction } from "../i18n/LanguageProvider";
import { StatusBadge } from "./StatusBadge";

type TrainingQueueWidgetProps = {
  onOpenRun: (projectId: string, runId: string) => void;
  projects: Project[];
};

type TrainingQueueItem = {
  project: Project;
  run: TrainingRun;
};

function isActiveTrainingStatus(status: string): boolean {
  return status === "queued" || status === "pending" || status === "running" || status === "cancel_requested";
}

function statusRank(status: string): number {
  if (status === "running") return 0;
  if (status === "queued" || status === "pending") return 1;
  if (status === "failed" || status === "cancel_requested") return 2;
  return 3;
}

function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function packageLabel(packageName: string): string {
  const labels: Record<string, string> = {
    torch: "PyTorch",
    torchvision: "TorchVision",
    ultralytics: "Ultralytics",
  };
  return labels[packageName] ?? packageName;
}

function packageVersion(runtime: RuntimeCheck, packageName: string, fallback: string): string {
  const packageStatus = runtime.packages[packageName];
  if (!packageStatus?.installed) return fallback;
  return packageStatus.version ?? "OK";
}

function acceleratorSummary(runtime: RuntimeCheck, t: TranslationFunction): string {
  const accelerators = runtime.devices.filter((device) => device.available && device.kind !== "cpu");
  if (accelerators.length > 0) {
    return t("runtime.gpuCount", { count: accelerators.length });
  }
  const cpu = runtime.devices.find((device) => device.available && device.kind === "cpu");
  return cpu ? "CPU" : t("runtime.noDevice");
}

export function TrainingQueueWidget({ onOpenRun, projects }: TrainingQueueWidgetProps) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const runQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: projects.length > 0,
      queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${project.id}/training-runs`),
      queryKey: ["projects", project.id, "training-runs"],
      refetchInterval: 5000,
    })),
  });
  const runtimeQuery = useQuery({
    queryFn: () => apiGet<RuntimeCheck>("/api/runtime/check"),
    queryKey: ["runtime", "check"],
    refetchInterval: 10000,
  });
  const installRuntime = useMutation({
    mutationFn: (profile: string) =>
      apiPost<RuntimeInstallResult>("/api/runtime/install", { profile }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime", "check"] });
    },
  });

  const items = useMemo<TrainingQueueItem[]>(
    () =>
      projects
        .flatMap((project, index) =>
          (runQueries[index]?.data ?? []).map((run) => ({
            project,
            run,
          })),
        )
        .sort((left, right) => {
          const rankDiff = statusRank(left.run.status) - statusRank(right.run.status);
          if (rankDiff !== 0) return rankDiff;
          return new Date(right.run.updated_at).getTime() - new Date(left.run.updated_at).getTime();
        }),
    [projects, runQueries],
  );

  const visibleItems = items.slice(0, 8);
  const runningCount = items.filter((item) => item.run.status === "running").length;
  const queuedCount = items.filter((item) => item.run.status === "queued" || item.run.status === "pending").length;
  const failedCount = items.filter((item) => item.run.status === "failed").length;
  const activeCount = items.filter((item) => isActiveTrainingStatus(item.run.status)).length;
  const isFetching = runQueries.some((query) => query.isFetching);
  const compactSummary =
    activeCount > 0
      ? t("trainingQueue.summaryActive", { queued: queuedCount, running: runningCount })
      : failedCount > 0
        ? t("trainingQueue.summaryFailed", { failed: failedCount })
        : t("trainingQueue.summaryIdle");
  const latestItem = [...items].sort(
    (left, right) => new Date(right.run.updated_at).getTime() - new Date(left.run.updated_at).getTime(),
  )[0];
  const latestRunLabel = latestItem?.run.name ?? t("trainingQueue.none");
  const trainingSummary = t("trainingQueue.summaryLine", {
    failed: failedCount,
    latest: latestRunLabel,
    queued: queuedCount,
    running: runningCount,
  });
  const runtime = runtimeQuery.data;
  const runtimeStateLabel = runtime
    ? runtime.ready
      ? t("runtime.trainable")
      : t("runtime.notTrainable")
    : t("runtime.checking");
  const runtimeSummary = runtime
    ? t("runtime.summaryLine", {
        device: acceleratorSummary(runtime, t),
        torch: packageVersion(runtime, "torch", t("runtime.missing")),
        ultralytics: packageVersion(runtime, "ultralytics", t("runtime.missing")),
        yolo: runtime.yolo_cli.installed ? "OK" : t("runtime.missing"),
      })
    : t("runtime.summaryChecking");
  const runtimeIcon = runtime ? (
    runtime.ready ? (
      <CheckCircle2 aria-hidden="true" size={16} />
    ) : (
      <XCircle aria-hidden="true" size={16} />
    )
  ) : runtimeQuery.isFetching ? (
    <Loader2 aria-hidden="true" className="spin" size={16} />
  ) : null;

  return (
    <aside className="training-queue-widget" data-open={isOpen ? "true" : undefined}>
      <button
        className="training-queue-widget__summary"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="training-queue-widget__summary-section">
          <strong>{trainingSummary}</strong>
        </span>
        <span className="training-queue-widget__summary-section">
          <strong>
            {runtimeIcon}
            {runtimeSummary}
          </strong>
        </span>
        {isFetching || runtimeQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={16} /> : null}
        {isOpen ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronUp aria-hidden="true" size={16} />}
      </button>

      {isOpen ? (
        <div className="training-queue-widget__panel">
          <section className="training-queue-widget__section">
            <div className="training-queue-widget__header">
              <strong>{t("trainingQueue.recent")}</strong>
              <span>
                {compactSummary} · {t("trainingQueue.count", { count: items.length })}
              </span>
            </div>
            {visibleItems.length > 0 ? (
              <div className="training-queue-widget__list">
                {visibleItems.map(({ project, run }) => (
                  <button
                    className="training-queue-widget__row"
                    key={`${project.id}:${run.id}`}
                    onClick={() => onOpenRun(project.id, run.id)}
                    type="button"
                  >
                    <span>
                      <strong>{run.name}</strong>
                      <small>
                        {project.name} · {formatDate(run.updated_at, language)}
                      </small>
                    </span>
                    <StatusBadge status={run.status} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("trainingQueue.empty")}</p>
              </div>
            )}
          </section>
          <section className="training-queue-widget__section training-queue-widget__runtime">
            <div className="training-queue-widget__header">
              <strong>{t("runtime.trainingEnvironment")}</strong>
              <span>{runtimeStateLabel}</span>
            </div>
            {runtime ? (
              <>
                <div className="training-queue-widget__runtime-status" data-ready={runtime.ready ? "true" : "false"}>
                  {runtime.ready ? (
                    <CheckCircle2 aria-hidden="true" size={18} />
                  ) : (
                    <XCircle aria-hidden="true" size={18} />
                  )}
                  <span>{runtimeStateLabel}</span>
                </div>
                <div className="training-queue-widget__runtime-list">
                  {Object.entries(runtime.packages).map(([packageName, packageStatus]) => (
                    <div className="training-queue-widget__runtime-row" key={packageName}>
                      <span>{packageLabel(packageName)}</span>
                      <strong>
                        {packageStatus.installed ? packageStatus.version ?? t("runtime.installed") : t("runtime.missing")}
                      </strong>
                    </div>
                  ))}
                  <div className="training-queue-widget__runtime-row">
                    <span>YOLO CLI</span>
                    <strong>{runtime.yolo_cli.installed ? t("runtime.available") : t("runtime.missing")}</strong>
                  </div>
                </div>
                {runtime.install_required ? (
                  <div className="training-queue-widget__runtime-actions">
                    {runtime.install_options.map((option) => (
                      <button
                        className="secondary-button"
                        disabled={installRuntime.isPending}
                        key={option.profile}
                        onClick={() => installRuntime.mutate(option.profile)}
                        type="button"
                      >
                        {t("runtime.installAction", { label: option.label })}
                      </button>
                    ))}
                  </div>
                ) : null}
                {installRuntime.data ? (
                  <div className="notice notice--warning" role="status">
                    {installRuntime.data.message}
                  </div>
                ) : null}
                {installRuntime.isError ? (
                  <div className="notice notice--danger" role="alert">
                    {t("runtime.installError")}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("runtime.checking")}</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
