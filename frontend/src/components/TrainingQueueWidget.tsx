import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { workRunsQueryRefetchInterval } from "../api/realtime";
import type { InferenceRun, Project, RuntimeCheck, RuntimeInstallResult, TrainingRun } from "../api/types";
import { useLanguage, type Language, type TranslationFunction } from "../i18n/LanguageProvider";
import { StatusBadge } from "./StatusBadge";

type TrainingQueueWidgetProps = {
  onNotification?: (notification: WorkCompletionNotification) => void;
  onOpenInferenceRun?: (projectId: string, runId: string) => void;
  onOpenRun: (projectId: string, runId: string) => void;
  projects: Project[];
};

type WorkQueueItem = {
  kind: "training" | "inference";
  project: Project;
  run: TrainingRun | InferenceRun;
};

type OpenTrainingQueuePanel = "queue" | "runtime" | null;

export type WorkCompletionNotification = {
  createdAt: string;
  id: string;
  kind: "training" | "inference";
  projectId: string;
  runId: string;
  title: string;
  body: string;
  tone: "success" | "danger";
};

function isActiveTrainingStatus(status: string): boolean {
  return status === "queued" || status === "pending" || status === "running" || status === "cancel_requested";
}

function isTerminalTrainingStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}

function isVisibleQueueStatus(status: string): boolean {
  return status.trim().toLowerCase() !== "completed";
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

export function TrainingQueueWidget({
  onNotification,
  onOpenInferenceRun,
  onOpenRun,
  projects,
}: TrainingQueueWidgetProps) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [openPanel, setOpenPanel] = useState<OpenTrainingQueuePanel>(null);
  const [notifications, setNotifications] = useState<WorkCompletionNotification[]>([]);
  const widgetRef = useRef<HTMLElement | null>(null);
  const previousRunStatusesRef = useRef<Map<string, string>>(new Map());
  const notifiedRunStatusesRef = useRef<Set<string>>(new Set());
  const runQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: projects.length > 0,
      queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${project.id}/training-runs`),
      queryKey: ["projects", project.id, "training-runs"],
      refetchInterval: workRunsQueryRefetchInterval,
    })),
  });
  const inferenceRunQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: projects.length > 0,
      queryFn: () => apiGet<InferenceRun[]>(`/api/projects/${project.id}/inference-runs`),
      queryKey: ["projects", project.id, "inference-runs"],
      refetchInterval: workRunsQueryRefetchInterval,
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

  useEffect(() => {
    if (!openPanel) return;

    function closeWhenPointerStartsOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (widgetRef.current?.contains(target)) return;
      setOpenPanel(null);
    }

    document.addEventListener("pointerdown", closeWhenPointerStartsOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeWhenPointerStartsOutside, true);
    };
  }, [openPanel]);

  const items = useMemo<WorkQueueItem[]>(
    () =>
      [
        ...projects
        .flatMap((project, index) =>
          (runQueries[index]?.data ?? []).map((run) => ({
            kind: "training" as const,
            project,
            run,
          })),
        ),
        ...projects.flatMap((project, index) =>
          (inferenceRunQueries[index]?.data ?? []).map((run) => ({
            kind: "inference" as const,
            project,
            run,
          })),
        ),
      ].sort((left, right) => {
        const rankDiff = statusRank(left.run.status) - statusRank(right.run.status);
        if (rankDiff !== 0) return rankDiff;
        return new Date(right.run.updated_at).getTime() - new Date(left.run.updated_at).getTime();
      }),
    [inferenceRunQueries, projects, runQueries],
  );

  useEffect(() => {
    if (items.length === 0) return;

    const previousStatuses = previousRunStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    const nextNotifications: WorkCompletionNotification[] = [];

    for (const item of items) {
      const notificationKey = `${item.kind}:${item.project.id}:${item.run.id}`;
      const normalizedStatus = item.run.status.trim().toLowerCase();
      const previousStatus = previousStatuses.get(notificationKey);
      nextStatuses.set(notificationKey, normalizedStatus);

      if (
        !previousStatus ||
        !isActiveTrainingStatus(previousStatus) ||
        !isTerminalTrainingStatus(normalizedStatus)
      ) {
        continue;
      }

      const statusNotificationKey = `${notificationKey}:${normalizedStatus}`;
      if (notifiedRunStatusesRef.current.has(statusNotificationKey)) {
        continue;
      }
      notifiedRunStatusesRef.current.add(statusNotificationKey);

      const title =
        item.kind === "training"
          ? normalizedStatus === "completed"
            ? t("trainingNotification.completedTitle")
            : t("trainingNotification.failedTitle")
          : normalizedStatus === "completed"
            ? t("inferenceNotification.completedTitle")
            : t("inferenceNotification.failedTitle");
      const body = t(item.kind === "training" ? "trainingNotification.body" : "inferenceNotification.body", {
        project: item.project.name,
        run: item.run.name,
      });
      const notification: WorkCompletionNotification = {
        createdAt: new Date().toISOString(),
        id: statusNotificationKey,
        kind: item.kind,
        projectId: item.project.id,
        runId: item.run.id,
        title,
        body,
        tone: normalizedStatus === "completed" ? "success" : "danger",
      };
      nextNotifications.push(notification);
      onNotification?.(notification);

      if (typeof Notification !== "undefined") {
        const showBrowserNotification = () => {
          const browserNotification = new Notification(title, {
            body,
            tag: `visionops-${item.kind}-${item.run.id}`,
          });
          browserNotification.onclick = () => {
            if (item.kind === "training") {
              onOpenRun(item.project.id, item.run.id);
              return;
            }
            onOpenInferenceRun?.(item.project.id, item.run.id);
          };
        };

        if (Notification.permission === "granted") {
          showBrowserNotification();
        } else if (Notification.permission === "default" && typeof Notification.requestPermission === "function") {
          void Notification.requestPermission().then((permission) => {
            if (permission === "granted") {
              showBrowserNotification();
            }
          });
        }
      }
    }

    previousRunStatusesRef.current = nextStatuses;
    if (nextNotifications.length > 0) {
      setNotifications((current) => [...nextNotifications, ...current].slice(0, 4));
    }
  }, [items, onNotification, onOpenInferenceRun, onOpenRun, t]);

  const queueItems = items.filter((item) => isVisibleQueueStatus(item.run.status));
  const trainingItems = queueItems.filter((item) => item.kind === "training");
  const inferenceItems = queueItems.filter((item) => item.kind === "inference");
  const visibleTrainingItems = trainingItems.slice(0, 8);
  const visibleInferenceItems = inferenceItems.slice(0, 8);
  const runningCount = items.filter((item) => item.run.status === "running").length;
  const queuedCount = items.filter((item) => item.run.status === "queued" || item.run.status === "pending").length;
  const failedCount = items.filter((item) => item.run.status === "failed").length;
  const activeCount = items.filter((item) => isActiveTrainingStatus(item.run.status)).length;
  const isFetching = runQueries.some((query) => query.isFetching) || inferenceRunQueries.some((query) => query.isFetching);
  const compactSummary =
    activeCount > 0
      ? t("trainingQueue.summaryActive", { queued: queuedCount, running: runningCount })
      : failedCount > 0
        ? t("trainingQueue.summaryFailed", { failed: failedCount })
        : t("trainingQueue.summaryIdle");
  const trainingSummary = t("trainingQueue.summaryLine", {
    failed: failedCount,
    queued: queuedCount,
    running: runningCount,
  });
  const projectVersionSummary = t("trainingQueue.productMetadata");
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
  function renderWorkRow({ kind, project, run }: WorkQueueItem) {
    return (
      <button
        className="training-queue-widget__row"
        key={`${kind}:${project.id}:${run.id}`}
        onClick={() => {
          if (kind === "training") {
            onOpenRun(project.id, run.id);
            return;
          }
          onOpenInferenceRun?.(project.id, run.id);
        }}
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
    );
  }

  return (
    <aside className="training-queue-widget" data-open={openPanel ? "true" : undefined} ref={widgetRef}>
      {notifications.length > 0 ? (
        <div className="training-queue-widget__notifications" role="status">
          {notifications.map((notification) => (
            <button
              className="training-queue-widget__notification"
              data-tone={notification.tone}
              key={notification.id}
              onClick={() => {
                if (notification.kind === "training") {
                  onOpenRun(notification.projectId, notification.runId);
                  return;
                }
                onOpenInferenceRun?.(notification.projectId, notification.runId);
              }}
              type="button"
            >
              <strong>{notification.title}</strong>
              <span>{notification.body}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="training-queue-widget__summary">
        <button
          aria-expanded={openPanel === "runtime"}
          className="training-queue-widget__summary-button training-queue-widget__summary-button--runtime"
          onClick={() => setOpenPanel((current) => (current === "runtime" ? null : "runtime"))}
          type="button"
        >
          <span className="training-queue-widget__summary-section">
            <strong>
              {runtimeIcon}
              {runtimeSummary}
            </strong>
          </span>
          {runtimeQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={16} /> : null}
          {openPanel === "runtime" ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronUp aria-hidden="true" size={16} />}
        </button>
        <div className="training-queue-widget__version" title={projectVersionSummary}>
          <span className="training-queue-widget__summary-section">
            <strong>{projectVersionSummary}</strong>
          </span>
        </div>
        <button
          aria-expanded={openPanel === "queue"}
          className="training-queue-widget__summary-button training-queue-widget__summary-button--queue"
          onClick={() => setOpenPanel((current) => (current === "queue" ? null : "queue"))}
          type="button"
        >
          <span className="training-queue-widget__summary-section">
            <strong>{trainingSummary}</strong>
          </span>
          {isFetching ? <Loader2 aria-hidden="true" className="spin" size={16} /> : null}
          {openPanel === "queue" ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronUp aria-hidden="true" size={16} />}
        </button>
      </div>

      {openPanel === "queue" ? (
        <div className="training-queue-widget__panel training-queue-widget__panel--queue" data-panel="queue">
          <section className="training-queue-widget__section">
            <div className="training-queue-widget__header">
              <strong>{t("trainingQueue.recent")}</strong>
              <span>
                {compactSummary} · {t("trainingQueue.count", { count: queueItems.length })}
              </span>
            </div>
            {queueItems.length > 0 ? (
              <div className="training-queue-widget__section-groups">
                <div className="training-queue-widget__section-group">
                  <div className="training-queue-widget__subheader">
                    <strong>{t("trainingQueue.kindTraining")}</strong>
                    <span>{t("trainingQueue.count", { count: trainingItems.length })}</span>
                  </div>
                  {visibleTrainingItems.length > 0 ? (
                    <div className="training-queue-widget__list">
                      {visibleTrainingItems.map(renderWorkRow)}
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact">
                      <p>{t("trainingQueue.empty")}</p>
                    </div>
                  )}
                </div>
                <div className="training-queue-widget__section-group">
                  <div className="training-queue-widget__subheader">
                    <strong>{t("trainingQueue.kindInference")}</strong>
                    <span>{t("trainingQueue.count", { count: inferenceItems.length })}</span>
                  </div>
                  {visibleInferenceItems.length > 0 ? (
                    <div className="training-queue-widget__list">
                      {visibleInferenceItems.map(renderWorkRow)}
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact">
                      <p>{t("trainingQueue.inferenceEmpty")}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("trainingQueue.queueEmpty")}</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {openPanel === "runtime" ? (
        <div className="training-queue-widget__panel training-queue-widget__panel--runtime" data-panel="runtime">
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
