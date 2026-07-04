import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, GitBranch, Loader2, Play, Plus } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { TrainingRunPage } from "./TrainingRunPage";
import type {
  Dataset,
  DatasetCreate,
  DatasetSplit,
  DatasetSplitCreate,
  JsonObject,
  Project,
  TrainingRun,
  TrainingRunCreate,
} from "../api/types";

export type DetailTab = "overview" | "datasets" | "training" | "inference" | "artifacts";

type ProjectDetailPageProps = {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  projectId: string;
};

const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "개요" },
  { key: "datasets", label: "데이터셋" },
  { key: "training", label: "학습" },
  { key: "inference", label: "추론" },
  { key: "artifacts", label: "아티팩트" },
];

const trainingStatusFilters = [
  { key: "all", label: "전체" },
  { key: "queued", label: "대기열" },
  { key: "running", label: "실행 중" },
  { key: "completed", label: "완료" },
  { key: "failed", label: "실패" },
] as const;

const defaultTrainingConfig = {
  batch: 16,
  device: "cpu",
  epochs: 50,
  imgsz: 640,
  learning_rate: 0.01,
  patience: 20,
};

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function numberFromSummary(summary: JsonObject | null | undefined, key: string): number | null {
  const value = summary?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function splitPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function isFiniteRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function splitRatioError(trainRatio: number, valRatio: number, seed: number): string | null {
  if (!isFiniteRatio(trainRatio) || !isFiniteRatio(valRatio)) {
    return "Train과 Val 비율은 0과 1 사이여야 합니다.";
  }
  if (Math.abs(trainRatio + valRatio - 1) > 1e-6) {
    return "Train과 Val 비율의 합은 1.0이어야 합니다.";
  }
  if (!Number.isFinite(seed) || seed < 0) {
    return "Seed는 0 이상의 숫자여야 합니다.";
  }
  return null;
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function trainingConfigError(config: typeof defaultTrainingConfig): string | null {
  if (!isPositiveNumber(config.epochs) || !Number.isInteger(config.epochs)) {
    return "epochs는 1 이상의 정수여야 합니다.";
  }
  if (!isPositiveNumber(config.batch) || !Number.isInteger(config.batch)) {
    return "batch는 1 이상의 정수여야 합니다.";
  }
  if (!isPositiveNumber(config.imgsz) || !Number.isInteger(config.imgsz)) {
    return "image size는 1 이상의 정수여야 합니다.";
  }
  if (!isPositiveNumber(config.learning_rate)) {
    return "learning rate는 양수여야 합니다.";
  }
  if (!isPositiveNumber(config.patience) || !Number.isInteger(config.patience)) {
    return "patience는 1 이상의 정수여야 합니다.";
  }
  if (!config.device.trim()) {
    return "device를 입력하세요.";
  }
  return null;
}

function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "0";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function DatasetValidationSummary({ dataset }: { dataset: Dataset | null | undefined }) {
  if (!dataset) {
    return (
      <div className="empty-state empty-state--compact">
        <Database aria-hidden="true" size={22} />
        <p>데이터셋 미선택</p>
      </div>
    );
  }

  const summary = dataset.validation_summary ?? null;
  const errors = asArray(summary?.errors);
  const warnings = asArray(summary?.warnings);
  const classNames = dataset.class_names?.length
    ? dataset.class_names
    : asArray(summary?.class_names);
  const imageCount = dataset.image_count ?? numberFromSummary(summary, "image_count") ?? 0;
  const labelCount = dataset.label_count ?? numberFromSummary(summary, "label_count") ?? 0;

  return (
    <div className="validation-summary">
      <div className="metric-row">
        <div>
          <span>이미지</span>
          <strong>{formatCount(imageCount)}</strong>
        </div>
        <div>
          <span>라벨</span>
          <strong>{formatCount(labelCount)}</strong>
        </div>
        <div>
          <span>클래스</span>
          <strong>{formatCount(classNames.length)}</strong>
        </div>
      </div>

      <div className="summary-line">
        <span>검증</span>
        <StatusBadge status={dataset.validation_status} />
      </div>

      {classNames.length > 0 ? (
        <div className="chip-list" aria-label="클래스 목록">
          {classNames.map((className) => (
            <span className="chip" key={className}>
              {className}
            </span>
          ))}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="notice notice--danger">
          <strong>오류 {errors.length}건</strong>
          <ul>
            {errors.slice(0, 3).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="notice notice--warning">
          <strong>경고 {warnings.length}건</strong>
          <ul>
            {warnings.slice(0, 3).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectDetailPage({ activeTab, onTabChange, projectId }: ProjectDetailPageProps) {
  const queryClient = useQueryClient();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [datasetName, setDatasetName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [splitName, setSplitName] = useState("기본 split");
  const [trainRatio, setTrainRatio] = useState(0.8);
  const [valRatio, setValRatio] = useState(0.2);
  const [seed, setSeed] = useState(42);
  const [pendingDatasetId, setPendingDatasetId] = useState<string | null>(null);
  const [trainingStatusFilter, setTrainingStatusFilter] =
    useState<(typeof trainingStatusFilters)[number]["key"]>("all");
  const [selectedTrainingRunId, setSelectedTrainingRunId] = useState<string | null>(null);
  const [trainingName, setTrainingName] = useState("");
  const [trainingSplitId, setTrainingSplitId] = useState("");
  const [trainingModelName, setTrainingModelName] = useState("yolo11n");
  const [trainingConfig, setTrainingConfig] = useState(defaultTrainingConfig);
  const ratioError = splitRatioError(trainRatio, valRatio, seed);
  const configError = trainingConfigError(trainingConfig);
  const trainingNameError = trainingName.trim() ? null : "학습 실행 이름을 입력하세요.";
  const splitSelectionError = trainingSplitId ? null : "학습에 사용할 Split을 선택하세요.";
  const trainingFormError = trainingNameError ?? splitSelectionError ?? configError;

  const projectQuery = useQuery({
    queryFn: () => apiGet<Project>(`/api/projects/${projectId}`),
    queryKey: ["projects", projectId],
  });

  const datasetsQuery = useQuery({
    queryFn: () => apiGet<Dataset[]>(`/api/projects/${projectId}/datasets`),
    queryKey: ["projects", projectId, "datasets"],
  });
  const datasets = datasetsQuery.data ?? [];

  const selectedDatasetFromList = useMemo(
    () => datasetsQuery.data?.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasetsQuery.data, selectedDatasetId],
  );

  const selectedDatasetQuery = useQuery({
    enabled: Boolean(selectedDatasetId),
    queryFn: () =>
      apiGet<Dataset>(`/api/projects/${projectId}/datasets/${selectedDatasetId as string}`),
    queryKey: ["projects", projectId, "datasets", selectedDatasetId],
  });

  useEffect(() => {
    if (!datasetsQuery.data) return;
    if (pendingDatasetId) {
      if (selectedDatasetId !== pendingDatasetId) {
        setPendingDatasetId(null);
      }
      return;
    }
    if (
      selectedDatasetId &&
      (datasetsQuery.data.some((dataset) => dataset.id === selectedDatasetId) ||
        selectedDatasetQuery.data?.id === selectedDatasetId ||
        selectedDatasetQuery.isFetching)
    ) {
      return;
    }
    const firstDataset = datasetsQuery.data?.[0];
    setSelectedDatasetId(firstDataset?.id ?? null);
  }, [
    datasetsQuery.data,
    pendingDatasetId,
    selectedDatasetId,
    selectedDatasetQuery.data,
    selectedDatasetQuery.isFetching,
  ]);

  const splitsQuery = useQuery({
    enabled: Boolean(selectedDatasetId),
    queryFn: () =>
      apiGet<DatasetSplit[]>(
        `/api/projects/${projectId}/datasets/${selectedDatasetId as string}/splits`,
      ),
    queryKey: ["projects", projectId, "datasets", selectedDatasetId, "splits"],
  });

  const createDataset = useMutation({
    mutationFn: (body: DatasetCreate) =>
      apiPost<Dataset>(`/api/projects/${projectId}/datasets`, body),
    onSuccess: (dataset) => {
      setDatasetName("");
      setSourcePath("");
      setPendingDatasetId(dataset.id);
      setSelectedDatasetId(dataset.id);
      queryClient.setQueryData<Dataset[]>(
        ["projects", projectId, "datasets"],
        (currentDatasets = []) => [
          dataset,
          ...currentDatasets.filter((currentDataset) => currentDataset.id !== dataset.id),
        ],
      );
      queryClient.setQueryData(["projects", projectId, "datasets", dataset.id], dataset);
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "datasets"] });
    },
  });

  const createSplit = useMutation({
    mutationFn: (body: DatasetSplitCreate) =>
      apiPost<DatasetSplit>(
        `/api/projects/${projectId}/datasets/${selectedDatasetId as string}/splits`,
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "datasets", selectedDatasetId, "splits"],
      });
    },
  });

  const selectedDataset = selectedDatasetQuery.data ?? selectedDatasetFromList;
  const visibleDatasets =
    selectedDataset && !datasets.some((dataset) => dataset.id === selectedDataset.id)
      ? [selectedDataset, ...datasets]
      : datasets;

  const trainingSplitQueries = useQueries({
    queries: visibleDatasets.map((dataset) => ({
      enabled: activeTab === "training" || activeTab === "datasets",
      queryFn: () =>
        apiGet<DatasetSplit[]>(`/api/projects/${projectId}/datasets/${dataset.id}/splits`),
      queryKey: ["projects", projectId, "datasets", dataset.id, "splits"],
    })),
  });

  const trainingSplitOptions = useMemo(
    () =>
      trainingSplitQueries.flatMap((query, index) => {
        const dataset = visibleDatasets[index];
        return (query.data ?? []).map((split) => ({
          datasetName: dataset?.name ?? "데이터셋",
          split,
        }));
      }),
    [trainingSplitQueries, visibleDatasets],
  );

  const trainingRunsQuery = useQuery({
    enabled: activeTab === "training",
    queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${projectId}/training-runs`),
    queryKey: ["projects", projectId, "training-runs"],
  });

  const trainingRuns = trainingRunsQuery.data ?? [];
  const filteredTrainingRuns = trainingRuns.filter((run) =>
    trainingStatusFilter === "all"
      ? true
      : trainingStatusFilter === "queued"
        ? run.status === "queued" || run.status === "pending"
        : run.status === trainingStatusFilter,
  );
  const selectedTrainingRun =
    filteredTrainingRuns.find((run) => run.id === selectedTrainingRunId) ??
    filteredTrainingRuns[0] ??
    null;

  useEffect(() => {
    if (trainingSplitId && trainingSplitOptions.some((option) => option.split.id === trainingSplitId)) {
      return;
    }
    setTrainingSplitId(trainingSplitOptions[0]?.split.id ?? "");
  }, [trainingSplitId, trainingSplitOptions]);

  useEffect(() => {
    if (!trainingRunsQuery.data) return;
    const nextTrainingRun =
      filteredTrainingRuns.find((run) => run.id === selectedTrainingRunId) ??
      filteredTrainingRuns[0] ??
      null;
    if (nextTrainingRun?.id === selectedTrainingRunId) {
      return;
    }
    setSelectedTrainingRunId(nextTrainingRun?.id ?? null);
  }, [filteredTrainingRuns, selectedTrainingRunId, trainingRunsQuery.data]);

  const createTrainingRun = useMutation({
    mutationFn: (body: TrainingRunCreate) =>
      apiPost<TrainingRun>(`/api/projects/${projectId}/training-runs`, body),
    onSuccess: (run) => {
      setTrainingStatusFilter("all");
      setSelectedTrainingRunId(run.id);
      setTrainingName("");
      queryClient.setQueryData<TrainingRun[]>(
        ["projects", projectId, "training-runs"],
        (currentRuns = []) => [run, ...currentRuns.filter((currentRun) => currentRun.id !== run.id)],
      );
      queryClient.setQueryData(["projects", projectId, "training-runs", run.id], run);
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "training-runs"] });
    },
  });

  function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = datasetName.trim();
    const trimmedSourcePath = sourcePath.trim();
    if (!trimmedName || !trimmedSourcePath || createDataset.isPending) return;

    createDataset.mutate({
      name: trimmedName,
      source_path: trimmedSourcePath,
    });
  }

  function handleSplitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = splitName.trim();
    if (!selectedDatasetId || !trimmedName || ratioError || createSplit.isPending) return;

    createSplit.mutate({
      name: trimmedName,
      seed,
      train_ratio: trainRatio,
      val_ratio: valRatio,
    });
  }

  function handleTrainingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = trainingName.trim();
    if (!trimmedName || !trainingSplitId || configError || createTrainingRun.isPending) return;

    createTrainingRun.mutate({
      config: trainingConfig,
      model_name: trainingModelName,
      name: trimmedName,
      split_id: trainingSplitId,
    });
  }

  function updateTrainingConfig<Key extends keyof typeof defaultTrainingConfig>(
    key: Key,
    value: (typeof defaultTrainingConfig)[Key],
  ) {
    setTrainingConfig((currentConfig) => ({
      ...currentConfig,
      [key]: value,
    }));
  }

  function updateTrainingNumberConfig(
    key: Exclude<keyof typeof defaultTrainingConfig, "device">,
    value: number,
  ) {
    if (!Number.isFinite(value)) return;
    updateTrainingConfig(key, value);
  }

  function handleSelectDataset(datasetId: string) {
    setPendingDatasetId(null);
    setSelectedDatasetId(datasetId);
  }

  function moveTabFocus(nextIndex: number) {
    onTabChange(detailTabs[nextIndex].key);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  }

  return (
    <div className="page-stack">
      <section className="summary-band" aria-label="프로젝트 상세 요약">
        <div>
          <p className="section-label">현재 프로젝트</p>
          <h2>{projectQuery.data?.name ?? "불러오는 중"}</h2>
        </div>
        <div className="summary-metrics">
          <div>
            <span>데이터셋</span>
            <strong>{visibleDatasets.length}</strong>
          </div>
          <div>
            <span>유형</span>
            <strong>탐지</strong>
          </div>
          <div>
            <span>선택 데이터셋</span>
            <strong>{selectedDataset ? "1" : "0"}</strong>
          </div>
        </div>
      </section>

      <div className="tab-bar" role="tablist" aria-label="프로젝트 상세 탭">
        {detailTabs.map((tab, index) => (
          <button
            aria-controls={`${tab.key}-panel`}
            aria-selected={activeTab === tab.key}
            className="tab-button"
            id={`${tab.key}-tab`}
            key={tab.key}
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "Home" &&
                event.key !== "End"
              ) {
                return;
              }
              event.preventDefault();
              if (event.key === "Home") {
                moveTabFocus(0);
                return;
              }
              if (event.key === "End") {
                moveTabFocus(detailTabs.length - 1);
                return;
              }
              const direction = event.key === "ArrowRight" ? 1 : -1;
              moveTabFocus((index + direction + detailTabs.length) % detailTabs.length);
            }}
            onClick={() => onTabChange(tab.key)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <section
          aria-labelledby="overview-tab"
          className="content-grid"
          id="overview-panel"
          role="tabpanel"
        >
          <div className="panel">
            <div className="panel__header">
              <div>
                <p className="section-label">개요</p>
                <h2>프로젝트 정보</h2>
              </div>
              <StatusBadge status={projectQuery.isError ? "failed" : "ready"} />
            </div>
            <dl className="detail-list">
              <div>
                <dt>설명</dt>
                <dd>{projectQuery.data?.description || "-"}</dd>
              </div>
              <div>
                <dt>작업 유형</dt>
                <dd>{projectQuery.data?.task_type === "detection" ? "탐지" : "-"}</dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <div className="panel__header">
              <div>
                <p className="section-label">상태</p>
                <h2>데이터 준비</h2>
              </div>
            </div>
            <div className="pipeline-list">
              <div className="pipeline-row">
                <span
                  className="pipeline-row__dot"
                  data-tone={visibleDatasets.length ? "success" : "warning"}
                />
                <span>데이터셋 등록</span>
                <strong>{visibleDatasets.length}개</strong>
              </div>
              <div className="pipeline-row">
                <span
                  className="pipeline-row__dot"
                  data-tone={selectedDataset?.validation_status === "valid" ? "success" : "warning"}
                />
                <span>검증 상태</span>
                <strong>{selectedDataset?.validation_status === "valid" ? "유효" : "대기"}</strong>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "datasets" ? (
        <section
          aria-labelledby="datasets-tab"
          className="dataset-grid"
          id="datasets-panel"
          role="tabpanel"
        >
          <div className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="section-label">데이터셋</p>
                <h2>등록 목록</h2>
              </div>
              {datasetsQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
            </div>

            <div className="dataset-list">
              {visibleDatasets.map((dataset) => (
                <button
                  className="dataset-row"
                  data-selected={selectedDatasetId === dataset.id ? "true" : undefined}
                  key={dataset.id}
                  onClick={() => handleSelectDataset(dataset.id)}
                  type="button"
                >
                  <span>
                    <strong>{dataset.name}</strong>
                    <small>{dataset.source_path}</small>
                  </span>
                  <StatusBadge status={dataset.validation_status} />
                </button>
              ))}
            </div>

            {!datasetsQuery.isLoading && visibleDatasets.length === 0 ? (
              <div className="empty-state empty-state--compact">
                <Database aria-hidden="true" size={22} />
                <p>데이터셋 없음</p>
              </div>
            ) : null}

            {datasetsQuery.isError ? (
              <div className="notice notice--danger" role="alert">
                데이터셋을 불러오지 못했습니다.
              </div>
            ) : null}
          </div>

          <form className="panel form-panel" onSubmit={handleDatasetSubmit}>
            <div className="panel__header">
              <div>
                <p className="section-label">등록</p>
                <h2>데이터 경로</h2>
              </div>
            </div>
            <label className="field">
              <span>이름</span>
              <input
                onChange={(event) => setDatasetName(event.target.value)}
                placeholder="불량 샘플 7월"
                required
                type="text"
                value={datasetName}
              />
            </label>
            <label className="field">
              <span>소스 경로</span>
              <input
                onChange={(event) => setSourcePath(event.target.value)}
                placeholder="/data/vision_ops/line-a"
                required
                type="text"
                value={sourcePath}
              />
            </label>
            {createDataset.isError ? (
              <div className="notice notice--danger" role="alert">
                {createDataset.error instanceof Error
                  ? createDataset.error.message
                  : "데이터셋 등록에 실패했습니다."}
              </div>
            ) : null}
            <button
              className="primary-button"
              disabled={!datasetName.trim() || !sourcePath.trim() || createDataset.isPending}
              type="submit"
            >
              {createDataset.isPending ? (
                <Loader2 aria-hidden="true" className="spin" size={17} />
              ) : (
                <Plus aria-hidden="true" size={17} />
              )}
              <span>등록</span>
            </button>
          </form>

          <div className="panel">
            <div className="panel__header">
              <div>
                <p className="section-label">검증</p>
                <h2>요약</h2>
              </div>
              {selectedDatasetQuery.isFetching ? (
                <Loader2 aria-hidden="true" className="spin" size={18} />
              ) : null}
            </div>
            <DatasetValidationSummary dataset={selectedDataset} />
          </div>

          <div className="panel">
            <div className="panel__header">
              <div>
                <p className="section-label">Split</p>
                <h2>생성</h2>
              </div>
            </div>
            <form className="split-form" onSubmit={handleSplitSubmit}>
              <label className="field">
                <span>이름</span>
                <input
                  disabled={!selectedDatasetId}
                  onChange={(event) => setSplitName(event.target.value)}
                  required
                  type="text"
                  value={splitName}
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Train</span>
                  <input
                    disabled={!selectedDatasetId}
                    max={1}
                    min={0}
                    onChange={(event) => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        setTrainRatio(event.target.valueAsNumber);
                      }
                    }}
                    step={0.05}
                    type="number"
                    value={trainRatio}
                  />
                </label>
                <label className="field">
                  <span>Val</span>
                  <input
                    disabled={!selectedDatasetId}
                    max={1}
                    min={0}
                    onChange={(event) => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        setValRatio(event.target.valueAsNumber);
                      }
                    }}
                    step={0.05}
                    type="number"
                    value={valRatio}
                  />
                </label>
                <label className="field">
                  <span>Seed</span>
                  <input
                    disabled={!selectedDatasetId}
                    min={0}
                    onChange={(event) => {
                      if (Number.isFinite(event.target.valueAsNumber)) {
                        setSeed(event.target.valueAsNumber);
                      }
                    }}
                    step={1}
                    type="number"
                    value={seed}
                  />
                </label>
              </div>
              {createSplit.isError ? (
                <div className="notice notice--danger" role="alert">
                  Split 생성에 실패했습니다.
                </div>
              ) : null}
              {ratioError ? (
                <div className="notice notice--warning" role="alert">
                  {ratioError}
                </div>
              ) : null}
              <button
                className="primary-button"
                disabled={
                  !selectedDatasetId ||
                  !splitName.trim() ||
                  Boolean(ratioError) ||
                  createSplit.isPending
                }
                type="submit"
              >
                {createSplit.isPending ? (
                  <Loader2 aria-hidden="true" className="spin" size={17} />
                ) : (
                  <GitBranch aria-hidden="true" size={17} />
                )}
                <span>Split 생성</span>
              </button>
            </form>
          </div>

          <div className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="section-label">Split</p>
                <h2>목록</h2>
              </div>
              {splitsQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
            </div>
            <div className="split-list">
              {(splitsQuery.data ?? []).map((split) => (
                <div className="split-row" key={split.id}>
                  <CheckCircle2 aria-hidden="true" size={18} />
                  <span>
                    <strong>{split.name}</strong>
                    <small>
                      Train {splitPercent(split.train_ratio)} · Val {splitPercent(split.val_ratio)}
                    </small>
                  </span>
                  <span className="split-row__counts">
                    {formatCount(split.train_count)} / {formatCount(split.val_count)}
                  </span>
                </div>
              ))}
            </div>
            {selectedDatasetId && !splitsQuery.isLoading && (splitsQuery.data ?? []).length === 0 ? (
              <div className="empty-state empty-state--compact">
                <GitBranch aria-hidden="true" size={22} />
                <p>Split 없음</p>
              </div>
            ) : null}
            {!selectedDatasetId ? (
              <div className="empty-state empty-state--compact">
                <GitBranch aria-hidden="true" size={22} />
                <p>데이터셋 미선택</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "training" ? (
        <section
          aria-labelledby="training-tab"
          className="training-layout"
          id="training-panel"
          role="tabpanel"
        >
          <div className="training-sidebar">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <p className="section-label">학습</p>
                  <h2>실행 목록</h2>
                </div>
                {trainingRunsQuery.isFetching ? (
                  <Loader2 aria-hidden="true" className="spin" size={18} />
                ) : null}
              </div>

              <div className="segment-control" aria-label="학습 상태 필터">
                {trainingStatusFilters.map((filter) => (
                  <button
                    aria-pressed={trainingStatusFilter === filter.key}
                    key={filter.key}
                    onClick={() => setTrainingStatusFilter(filter.key)}
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {filteredTrainingRuns.length > 0 ? (
                <div className="training-run-list">
                  {filteredTrainingRuns.map((run) => (
                    <button
                      className="training-run-row"
                      data-selected={selectedTrainingRun?.id === run.id ? "true" : undefined}
                      key={run.id}
                      onClick={() => setSelectedTrainingRunId(run.id)}
                      type="button"
                    >
                      <span>
                        <strong>{run.name}</strong>
                        <small>
                          {run.model_name} · {formatDate(run.created_at)}
                        </small>
                      </span>
                      <StatusBadge status={run.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state empty-state--compact">
                  <p>{trainingRunsQuery.isLoading ? "학습 실행을 불러오는 중입니다." : "학습 실행 없음"}</p>
                </div>
              )}

              {trainingRunsQuery.isError ? (
                <div className="notice notice--danger" role="alert">
                  학습 실행 목록을 불러오지 못했습니다.
                </div>
              ) : null}
            </div>

            <form className="panel form-panel training-form" onSubmit={handleTrainingSubmit}>
              <div className="panel__header">
                <div>
                  <p className="section-label">생성</p>
                  <h2>새 학습 실행</h2>
                </div>
              </div>

              <label className="field">
                <span>이름</span>
                <input
                  onChange={(event) => setTrainingName(event.target.value)}
                  placeholder="라인 A 기준 모델"
                  required
                  type="text"
                  value={trainingName}
                />
              </label>

              <label className="field">
                <span>Split</span>
                <select
                  disabled={trainingSplitOptions.length === 0}
                  onChange={(event) => setTrainingSplitId(event.target.value)}
                  required
                  value={trainingSplitId}
                >
                  {trainingSplitOptions.map(({ datasetName, split }) => (
                    <option key={split.id} value={split.id}>
                      {datasetName} / {split.name}
                    </option>
                  ))}
                </select>
              </label>

              {datasetsQuery.isLoading ? (
                <div className="notice notice--warning">데이터셋을 불러오는 중입니다.</div>
              ) : null}
              {!datasetsQuery.isLoading && visibleDatasets.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <Database aria-hidden="true" size={22} />
                  <p>데이터셋 없음</p>
                  <small>데이터셋 탭에서 먼저 학습 데이터를 등록하세요.</small>
                </div>
              ) : null}
              {visibleDatasets.length > 0 && trainingSplitOptions.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <GitBranch aria-hidden="true" size={22} />
                  <p>Split 없음</p>
                  <small>학습에 사용할 Split을 먼저 생성하세요.</small>
                </div>
              ) : null}

              <label className="field">
                <span>모델 preset</span>
                <select
                  onChange={(event) => setTrainingModelName(event.target.value)}
                  value={trainingModelName}
                >
                  <option value="yolo11n">yolo11n</option>
                  <option value="yolov8n">yolov8n</option>
                  <option value="yolov8s">yolov8s</option>
                </select>
              </label>

              <div className="field-row field-row--two">
                <label className="field">
                  <span>epochs</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      updateTrainingNumberConfig("epochs", event.target.valueAsNumber)
                    }
                    step={1}
                    type="number"
                    value={trainingConfig.epochs}
                  />
                </label>
                <label className="field">
                  <span>batch</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      updateTrainingNumberConfig("batch", event.target.valueAsNumber)
                    }
                    step={1}
                    type="number"
                    value={trainingConfig.batch}
                  />
                </label>
                <label className="field">
                  <span>imgsz</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      updateTrainingNumberConfig("imgsz", event.target.valueAsNumber)
                    }
                    step={1}
                    type="number"
                    value={trainingConfig.imgsz}
                  />
                </label>
                <label className="field">
                  <span>learning rate</span>
                  <input
                    min={0.000001}
                    onChange={(event) =>
                      updateTrainingNumberConfig("learning_rate", event.target.valueAsNumber)
                    }
                    step={0.001}
                    type="number"
                    value={trainingConfig.learning_rate}
                  />
                </label>
                <label className="field">
                  <span>patience</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      updateTrainingNumberConfig("patience", event.target.valueAsNumber)
                    }
                    step={1}
                    type="number"
                    value={trainingConfig.patience}
                  />
                </label>
                <label className="field">
                  <span>device</span>
                  <input
                    onChange={(event) => updateTrainingConfig("device", event.target.value)}
                    type="text"
                    value={trainingConfig.device}
                  />
                </label>
              </div>

              {trainingFormError ? (
                <div className="notice notice--warning" role="alert">
                  {trainingFormError}
                </div>
              ) : null}
              {createTrainingRun.isError ? (
                <div className="notice notice--danger" role="alert">
                  {createTrainingRun.error instanceof Error
                    ? createTrainingRun.error.message
                    : "학습 실행 생성에 실패했습니다."}
                </div>
              ) : null}

              <button
                className="primary-button"
                disabled={Boolean(trainingFormError) || createTrainingRun.isPending}
                type="submit"
              >
                {createTrainingRun.isPending ? (
                  <Loader2 aria-hidden="true" className="spin" size={17} />
                ) : (
                  <Play aria-hidden="true" size={17} />
                )}
                <span>학습 시작</span>
              </button>
            </form>
          </div>

          <TrainingRunPage
            initialRun={selectedTrainingRun}
            projectId={projectId}
            runId={selectedTrainingRun?.id ?? selectedTrainingRunId}
          />
        </section>
      ) : null}
      {activeTab === "inference" ? (
        <PlaceholderPanel tab="inference" title="추론" status="queued" />
      ) : null}
      {activeTab === "artifacts" ? (
        <PlaceholderPanel tab="artifacts" title="아티팩트" status="queued" />
      ) : null}
    </div>
  );
}

function PlaceholderPanel({ status, tab, title }: { status: string; tab: DetailTab; title: string }) {
  return (
    <section
      aria-labelledby={`${tab}-tab`}
      className="panel placeholder-panel"
      id={`${tab}-panel`}
      role="tabpanel"
    >
      <div className="panel__header">
        <div>
          <p className="section-label">작업 영역</p>
          <h2>{title}</h2>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="empty-state empty-state--compact">
        <p>{title} 실행 없음</p>
      </div>
    </section>
  );
}
