import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, GitBranch, Loader2, Play, Plus, X, XCircle } from "lucide-react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost, apiUrl } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage, type Language, type TranslationFunction } from "../i18n/LanguageProvider";
import { TrainingRunPage } from "./TrainingRunPage";
import type {
  Dataset,
  DatasetSplit,
  DatasetSplitCreate,
  InferencePrediction,
  InferenceRun,
  JsonObject,
  ModelArtifact,
  RuntimeCheck,
  RuntimeInstallResult,
  TrainingRun,
  TrainingRunCreate,
  TrainingPreflight,
} from "../api/types";

export type DetailTab = "datasets" | "training" | "inference";

type ProjectDetailPageProps = {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  projectId: string;
};

const detailTabs: Array<{ key: DetailTab; labelKey: string }> = [
  { key: "datasets", labelKey: "detail.datasets" },
  { key: "training", labelKey: "detail.training" },
  { key: "inference", labelKey: "detail.inference" },
];

const trainingStatusFilters = [
  { key: "all", labelKey: "projects.filterAll" },
  { key: "queued", labelKey: "status.queued" },
  { key: "running", labelKey: "status.running" },
  { key: "completed", labelKey: "status.completed" },
  { key: "failed", labelKey: "status.failed" },
] as const;

const defaultTrainingConfig = {
  batch: 16,
  device: "cpu",
  epochs: 50,
  imgsz: 640,
  learning_rate: 0.01,
  patience: 20,
  optimizer: "auto",
  lrf: 0.01,
  momentum: 0.937,
  weight_decay: 0.0005,
  warmup_epochs: 3,
  cos_lr: false,
  close_mosaic: 10,
  cache: false,
  workers: 8,
  seed: 0,
  deterministic: true,
  amp: true,
  freeze: 0,
  dropout: 0,
  mosaic: 1,
  mixup: 0,
  degrees: 0,
  translate: 0.1,
  scale: 0.5,
  fliplr: 0.5,
};

type TrainingConfigState = typeof defaultTrainingConfig;
type TrainingPresetKey = "balanced" | "fast" | "cpu" | "accuracy";
type TrainingNumberConfigKey =
  | "epochs"
  | "batch"
  | "imgsz"
  | "learning_rate"
  | "patience"
  | "lrf"
  | "momentum"
  | "weight_decay"
  | "warmup_epochs"
  | "close_mosaic"
  | "workers"
  | "seed"
  | "freeze"
  | "dropout"
  | "mosaic"
  | "mixup"
  | "degrees"
  | "translate"
  | "scale"
  | "fliplr";
type TrainingBooleanConfigKey = "cos_lr" | "cache" | "deterministic" | "amp";

const trainingPresetOptions: Array<{
  key: TrainingPresetKey;
  labelKey: string;
  config: Partial<TrainingConfigState>;
}> = [
  {
    key: "balanced",
    labelKey: "training.presetBalanced",
    config: defaultTrainingConfig,
  },
  {
    key: "fast",
    labelKey: "training.presetFast",
    config: {
      epochs: 10,
      batch: 8,
      imgsz: 416,
      patience: 5,
      workers: 4,
      close_mosaic: 3,
      mosaic: 0.5,
      mixup: 0,
    },
  },
  {
    key: "cpu",
    labelKey: "training.presetCpu",
    config: {
      epochs: 20,
      batch: 4,
      imgsz: 416,
      patience: 8,
      device: "cpu",
      workers: 2,
      amp: false,
      cache: false,
      close_mosaic: 5,
    },
  },
  {
    key: "accuracy",
    labelKey: "training.presetAccuracy",
    config: {
      epochs: 100,
      batch: 16,
      imgsz: 768,
      learning_rate: 0.001,
      patience: 30,
      optimizer: "AdamW",
      weight_decay: 0.0007,
      warmup_epochs: 5,
      cos_lr: true,
      close_mosaic: 15,
      amp: true,
      mosaic: 1,
      mixup: 0.1,
      scale: 0.7,
    },
  },
];

const defaultInferenceConfig = {
  conf: 0.25,
  imgsz: 640,
};

type UploadKind = "images" | "labels" | "data_yaml" | "inference_input";

type ArtifactOption = {
  artifact: ModelArtifact;
  run: TrainingRun;
};

type UploadFileWithPath = File & {
  webkitRelativePath?: string;
};

type DroppedFileSystemEntry = {
  file?: (callback: (file: File) => void) => void;
  isDirectory: boolean;
  isFile: boolean;
  name: string;
};

type DroppedFileSystemDirectoryEntry = DroppedFileSystemEntry & {
  createReader: () => {
    readEntries: (callback: (entries: DroppedFileSystemEntry[]) => void) => void;
  };
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => unknown;
};

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function uploadFileName(file: UploadFileWithPath): string {
  const rawPath = file.webkitRelativePath || file.name;
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.length <= 1) return file.name;
  return parts.slice(1).join("/");
}

function appendFiles(formData: FormData, key: "images" | "labels" | "inputs", files: File[]) {
  for (const file of files) {
    formData.append(key, file, uploadFileName(file));
  }
}

function fileCountLabel(files: File[], t: TranslationFunction, language: Language): string {
  if (files.length === 0) return t("upload.none");
  const count = files.length.toLocaleString(language === "en" ? "en-US" : "ko-KR");
  return t("upload.selectedCount", { count });
}

function attachRelativePath(file: File, relativePath: string): File {
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
}

function readDirectoryEntries(directory: DroppedFileSystemDirectoryEntry) {
  return new Promise<DroppedFileSystemEntry[]>((resolve) => {
    const reader = directory.createReader();
    const entries: DroppedFileSystemEntry[] = [];

    function readBatch() {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      });
    }

    readBatch();
  });
}

async function filesFromEntry(entry: DroppedFileSystemEntry, parentPath = ""): Promise<File[]> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file?.((file) => resolve([attachRelativePath(file, relativePath)]));
    });
  }
  if (entry.isDirectory) {
    const entries = await readDirectoryEntries(entry as DroppedFileSystemDirectoryEntry);
    const nestedFiles = await Promise.all(
      entries.map((nestedEntry) => filesFromEntry(nestedEntry, relativePath)),
    );
    return nestedFiles.flat();
  }
  return [];
}

async function filesFromDrop(event: DragEvent<HTMLElement>): Promise<File[]> {
  const entries = Array.from(event.dataTransfer.items)
    .map(
      (item) =>
        (item as DataTransferItemWithEntry).webkitGetAsEntry?.() as
          | DroppedFileSystemEntry
          | null
          | undefined,
    )
    .filter((entry): entry is DroppedFileSystemEntry => Boolean(entry));
  if (entries.length === 0) {
    return Array.from(event.dataTransfer.files);
  }
  const files = await Promise.all(entries.map((entry) => filesFromEntry(entry)));
  return files.flat();
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

function splitRatioError(
  trainRatio: number,
  valRatio: number,
  seed: number,
  t: TranslationFunction,
): string | null {
  if (!isFiniteRatio(trainRatio) || !isFiniteRatio(valRatio)) {
    return t("split.validationRatioBounds");
  }
  if (Math.abs(trainRatio + valRatio - 1) > 1e-6) {
    return t("split.validationRatioSum");
  }
  if (!Number.isFinite(seed) || seed < 0) {
    return t("split.validationSeed");
  }
  return null;
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function trainingConfigError(config: typeof defaultTrainingConfig, t: TranslationFunction): string | null {
  if (!isPositiveNumber(config.epochs) || !Number.isInteger(config.epochs)) {
    return t("training.validationEpochs");
  }
  if (!isPositiveNumber(config.batch) || !Number.isInteger(config.batch)) {
    return t("training.validationBatch");
  }
  if (!isPositiveNumber(config.imgsz) || !Number.isInteger(config.imgsz)) {
    return t("training.validationImageSize");
  }
  if (!isPositiveNumber(config.learning_rate)) {
    return t("training.validationLearningRate");
  }
  if (!isPositiveNumber(config.patience) || !Number.isInteger(config.patience)) {
    return t("training.validationPatience");
  }
  if (!config.device.trim()) {
    return t("training.validationDevice");
  }
  if (!config.optimizer.trim()) {
    return t("training.validationOptimizer");
  }
  const integerKeys: TrainingNumberConfigKey[] = [
    "close_mosaic",
    "workers",
    "seed",
    "freeze",
  ];
  if (integerKeys.some((key) => !Number.isInteger(config[key]) || config[key] < 0)) {
    return t("training.validationAdvanced");
  }
  const nonNegativeKeys: TrainingNumberConfigKey[] = [
    "weight_decay",
    "warmup_epochs",
    "dropout",
    "mosaic",
    "mixup",
    "degrees",
    "translate",
    "scale",
    "fliplr",
  ];
  if (nonNegativeKeys.some((key) => !Number.isFinite(config[key]) || config[key] < 0)) {
    return t("training.validationAdvanced");
  }
  const ratioKeys: TrainingNumberConfigKey[] = ["dropout", "mosaic", "mixup", "translate", "fliplr"];
  if (ratioKeys.some((key) => config[key] > 1)) {
    return t("training.validationAdvanced");
  }
  if (!isPositiveNumber(config.lrf) || !isPositiveNumber(config.momentum)) {
    return t("training.validationAdvanced");
  }
  return null;
}

function packageLabel(packageName: string): string {
  const labels: Record<string, string> = {
    torch: "PyTorch",
    torchvision: "TorchVision",
    ultralytics: "Ultralytics",
  };
  return labels[packageName] ?? packageName;
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

function artifactOptionLabel(option: ArtifactOption): string {
  return `${option.run.name} / ${option.artifact.kind}`;
}

function predictionDetections(prediction: InferencePrediction): JsonObject[] {
  const detections = prediction.prediction_json.detections;
  return Array.isArray(detections)
    ? detections.filter((detection): detection is JsonObject => Boolean(detection && typeof detection === "object"))
    : [];
}

function detectionLabel(detection: JsonObject): string {
  const className = String(detection.class_name ?? detection.class_id ?? "object");
  const confidence = typeof detection.confidence === "number" ? detection.confidence.toFixed(2) : null;
  return confidence ? `${className} ${confidence}` : className;
}

function formatCount(value: number | null | undefined, language: Language): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(language === "en" ? "en-US" : "ko-KR")
    : "0";
}

function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function DatasetValidationSummary({ dataset }: { dataset: Dataset | null | undefined }) {
  const { language, t } = useLanguage();
  if (!dataset) {
    return (
      <div className="empty-state empty-state--compact">
        <Database aria-hidden="true" size={22} />
        <p>{t("dataset.noDatasetSelected")}</p>
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
          <span>{t("dataset.images")}</span>
          <strong>{formatCount(imageCount, language)}</strong>
        </div>
        <div>
          <span>{t("dataset.labels")}</span>
          <strong>{formatCount(labelCount, language)}</strong>
        </div>
        <div>
          <span>{t("dataset.classes")}</span>
          <strong>{formatCount(classNames.length, language)}</strong>
        </div>
      </div>

      <div className="summary-line">
        <span>{t("dataset.validation")}</span>
        <StatusBadge status={dataset.validation_status} />
      </div>

      {classNames.length > 0 ? (
        <div className="chip-list" aria-label={t("dataset.classList")}>
          {classNames.map((className) => (
            <span className="chip" key={className}>
              {className}
            </span>
          ))}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="notice notice--danger">
          <strong>{t("dataset.errorsCount", { count: errors.length })}</strong>
          <ul>
            {errors.slice(0, 3).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="notice notice--warning">
          <strong>{t("dataset.warningsCount", { count: warnings.length })}</strong>
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

function DatasetUploadPicker({
  accept,
  description,
  directory,
  files,
  inputLabel,
  kind,
  multiple = true,
  onFilesChange,
  title,
}: {
  accept?: string;
  description: string;
  directory?: boolean;
  files: File[];
  inputLabel: string;
  kind: UploadKind;
  multiple?: boolean;
  onFilesChange: (files: File[]) => void;
  title: string;
}) {
  const { language, t } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const inputId = `dataset-upload-${kind}`;
  const folderAttributes =
    directory || kind === "images" || kind === "labels"
      ? ({ directory: "", webkitdirectory: "" } as Record<string, string>)
      : {};

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const droppedFiles = await filesFromDrop(event);
    if (droppedFiles.length > 0) {
      onFilesChange(multiple ? droppedFiles : droppedFiles.slice(0, 1));
    }
  }

  return (
    <label
      className="upload-zone"
      data-dragging={isDragging ? "true" : undefined}
      htmlFor={inputId}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDrop={handleDrop}
    >
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <em>{fileCountLabel(files, t, language)}</em>
      <input
        accept={accept}
        aria-label={inputLabel}
        id={inputId}
        multiple={multiple}
        onChange={(event) => onFilesChange(Array.from(event.currentTarget.files ?? []))}
        type="file"
        {...folderAttributes}
      />
    </label>
  );
}

function RuntimePanel({
  installRuntime,
  runtime,
}: {
  installRuntime: ReturnType<typeof useMutation<RuntimeInstallResult, Error, string>>;
  runtime: RuntimeCheck | undefined;
}) {
  const { t } = useLanguage();
  if (!runtime) {
    return (
      <div className="runtime-panel">
        <div className="empty-state empty-state--compact">
          <p>{t("runtime.checking")}</p>
        </div>
      </div>
    );
  }

  const trainableLabel = runtime.ready ? t("runtime.trainable") : t("runtime.notTrainable");

  return (
    <div className="runtime-panel">
      <div className="runtime-trainable" data-ready={runtime.ready ? "true" : "false"}>
        {runtime.ready ? (
          <CheckCircle2 aria-hidden="true" size={18} />
        ) : (
          <XCircle aria-hidden="true" size={18} />
        )}
        <span>{trainableLabel}</span>
      </div>
      <div className="runtime-list">
        {Object.entries(runtime.packages).map(([packageName, packageStatus]) => (
          <div className="runtime-row" key={packageName}>
            <span>
              {packageStatus.installed ? (
                <CheckCircle2 aria-hidden="true" size={15} />
              ) : (
                <XCircle aria-hidden="true" size={15} />
              )}
              {packageLabel(packageName)}
            </span>
            <strong>
              {packageStatus.installed ? packageStatus.version ?? t("runtime.installed") : t("runtime.missing")}
            </strong>
          </div>
        ))}
        <div className="runtime-row">
          <span>
            {runtime.yolo_cli.installed ? (
              <CheckCircle2 aria-hidden="true" size={15} />
            ) : (
              <XCircle aria-hidden="true" size={15} />
            )}
            YOLO CLI
          </span>
          <strong>{runtime.yolo_cli.installed ? t("runtime.available") : t("runtime.missing")}</strong>
        </div>
      </div>
      {runtime.install_required ? (
        <div className="runtime-actions">
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
    </div>
  );
}

export function ProjectDetailPage({ activeTab, onTabChange, projectId }: ProjectDetailPageProps) {
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [labelFiles, setLabelFiles] = useState<File[]>([]);
  const [dataYamlFiles, setDataYamlFiles] = useState<File[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [splitName, setSplitName] = useState(t("split.nameDefault"));
  const previousSplitDefaultRef = useRef(t("split.nameDefault"));
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
  const [trainingPreset, setTrainingPreset] = useState<TrainingPresetKey>("balanced");
  const [trainingConfig, setTrainingConfig] = useState(defaultTrainingConfig);
  const [preflightResult, setPreflightResult] = useState<TrainingPreflight | null>(null);
  const [inferenceName, setInferenceName] = useState("");
  const [inferenceArtifactId, setInferenceArtifactId] = useState("");
  const [selectedInferenceRunId, setSelectedInferenceRunId] = useState<string | null>(null);
  const [inferenceInputType, setInferenceInputType] = useState<"image" | "folder">("folder");
  const [inferenceFiles, setInferenceFiles] = useState<File[]>([]);
  const [inferenceConfig, setInferenceConfig] = useState(defaultInferenceConfig);
  const ratioError = splitRatioError(trainRatio, valRatio, seed, t);
  const configError = trainingConfigError(trainingConfig, t);
  const trainingNameError = trainingName.trim() ? null : t("training.nameRequired");
  const splitSelectionError = trainingSplitId ? null : t("training.splitRequired");
  const trainingFormError = trainingNameError ?? splitSelectionError ?? configError;

  useEffect(() => {
    const nextDefault = t("split.nameDefault");
    setSplitName((currentName) =>
      currentName === previousSplitDefaultRef.current ? nextDefault : currentName,
    );
    previousSplitDefaultRef.current = nextDefault;
  }, [t]);

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
    mutationFn: (body: FormData) =>
      apiPost<Dataset>(`/api/projects/${projectId}/datasets/upload`, body),
    onSuccess: (dataset) => {
      setDatasetDialogOpen(false);
      setDatasetName("");
      setImageFiles([]);
      setLabelFiles([]);
      setDataYamlFiles([]);
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
          datasetName: dataset?.name ?? t("dataset.dataset"),
          split,
        }));
      }),
    [t, trainingSplitQueries, visibleDatasets],
  );

  const trainingRunsQuery = useQuery({
    enabled: activeTab === "training" || activeTab === "inference",
    queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${projectId}/training-runs`),
    queryKey: ["projects", projectId, "training-runs"],
  });
  const trainingRuns = trainingRunsQuery.data ?? [];

  const artifactQueries = useQueries({
    queries: trainingRuns.map((run) => ({
      enabled: activeTab === "inference",
      queryFn: () =>
        apiGet<ModelArtifact[]>(`/api/projects/${projectId}/training-runs/${run.id}/artifacts`),
      queryKey: ["projects", projectId, "training-runs", run.id, "artifacts"],
    })),
  });

  const inferenceRunsQuery = useQuery({
    enabled: activeTab === "inference",
    queryFn: () => apiGet<InferenceRun[]>(`/api/projects/${projectId}/inference-runs`),
    queryKey: ["projects", projectId, "inference-runs"],
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      return runs.some((run) => run.status === "queued" || run.status === "running") ? 2000 : false;
    },
  });

  const runtimeQuery = useQuery({
    enabled: activeTab === "training",
    queryFn: () => apiGet<RuntimeCheck>("/api/runtime/check"),
    queryKey: ["runtime", "check"],
  });

  const artifactOptions = artifactQueries.flatMap((query, index) => {
    const run = trainingRuns[index];
    if (!run) return [];
    return (query.data ?? []).map((artifact) => ({ artifact, run }));
  });
  const selectedInferenceArtifactId = inferenceArtifactId || artifactOptions[0]?.artifact.id || "";
  const inferenceRuns = inferenceRunsQuery.data ?? [];
  const selectedInferenceRun =
    inferenceRuns.find((run) => run.id === selectedInferenceRunId) ?? inferenceRuns[0] ?? null;
  const inferencePredictionsQuery = useQuery({
    enabled: activeTab === "inference" && Boolean(selectedInferenceRun),
    queryFn: () =>
      apiGet<InferencePrediction[]>(
        `/api/projects/${projectId}/inference-runs/${selectedInferenceRun?.id as string}/predictions`,
      ),
    queryKey: ["projects", projectId, "inference-runs", selectedInferenceRun?.id, "predictions"],
    refetchInterval:
      selectedInferenceRun?.status === "queued" || selectedInferenceRun?.status === "running"
        ? 2000
        : false,
  });
  const inferencePredictions = inferencePredictionsQuery.data ?? [];
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

  useEffect(() => {
    if (inferenceArtifactId && artifactOptions.some((option) => option.artifact.id === inferenceArtifactId)) {
      return;
    }
    setInferenceArtifactId(artifactOptions[0]?.artifact.id ?? "");
  }, [artifactOptions, inferenceArtifactId]);

  useEffect(() => {
    if (!inferenceRunsQuery.data) return;
    const nextRun =
      inferenceRuns.find((run) => run.id === selectedInferenceRunId) ?? inferenceRuns[0] ?? null;
    if (nextRun?.id === selectedInferenceRunId) return;
    setSelectedInferenceRunId(nextRun?.id ?? null);
  }, [inferenceRuns, inferenceRunsQuery.data, selectedInferenceRunId]);

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

  const runTrainingPreflight = useMutation({
    mutationFn: (body: TrainingRunCreate) =>
      apiPost<TrainingPreflight>(`/api/projects/${projectId}/training-runs/preflight`, body),
  });

  const installRuntime = useMutation({
    mutationFn: (profile: string) =>
      apiPost<RuntimeInstallResult>("/api/runtime/install", { profile }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime", "check"] });
    },
  });

  const createInferenceRun = useMutation({
    mutationFn: (body: FormData) =>
      apiPost<InferenceRun>(`/api/projects/${projectId}/inference-runs/upload`, body),
    onSuccess: (run) => {
      setInferenceName("");
      setInferenceFiles([]);
      setSelectedInferenceRunId(run.id);
      queryClient.setQueryData<InferenceRun[]>(
        ["projects", projectId, "inference-runs"],
        (currentRuns = []) => [run, ...currentRuns.filter((currentRun) => currentRun.id !== run.id)],
      );
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "inference-runs"] });
    },
  });

  function openDatasetDialog() {
    createDataset.reset();
    setDatasetDialogOpen(true);
  }

  function closeDatasetDialog() {
    if (createDataset.isPending) return;
    setDatasetDialogOpen(false);
    setDatasetName("");
    setImageFiles([]);
    setLabelFiles([]);
    setDataYamlFiles([]);
    createDataset.reset();
  }

  function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = datasetName.trim();
    const dataYamlFile = dataYamlFiles[0];
    if (
      !trimmedName ||
      imageFiles.length === 0 ||
      labelFiles.length === 0 ||
      !dataYamlFile ||
      createDataset.isPending
    ) {
      return;
    }

    const formData = new FormData();
    formData.append("name", trimmedName);
    appendFiles(formData, "images", imageFiles);
    appendFiles(formData, "labels", labelFiles);
    formData.append("data_yaml", dataYamlFile, dataYamlFile.name);
    createDataset.mutate(formData);
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

  function handleInferenceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = inferenceName.trim();
    if (
      !trimmedName ||
      !selectedInferenceArtifactId ||
      inferenceFiles.length === 0 ||
      createInferenceRun.isPending
    ) {
      return;
    }

    const formData = new FormData();
    formData.append("name", trimmedName);
    formData.append("model_artifact_id", selectedInferenceArtifactId);
    formData.append("input_type", inferenceInputType);
    formData.append("conf", String(inferenceConfig.conf));
    formData.append("imgsz", String(inferenceConfig.imgsz));
    appendFiles(formData, "inputs", inferenceFiles);
    createInferenceRun.mutate(formData);
  }

  async function handleTrainingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = trainingName.trim();
    if (!trimmedName || !trainingSplitId || configError || createTrainingRun.isPending) return;

    const body = {
      config: trainingConfig,
      model_name: trainingModelName,
      name: trimmedName,
      split_id: trainingSplitId,
    };
    const preflight = await runTrainingPreflight.mutateAsync(body);
    setPreflightResult(preflight);
    if (!preflight.can_start) return;
    createTrainingRun.mutate(body);
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
    key: TrainingNumberConfigKey,
    value: number,
  ) {
    if (!Number.isFinite(value)) return;
    updateTrainingConfig(key, value);
  }

  function updateTrainingBooleanConfig(key: TrainingBooleanConfigKey, value: boolean) {
    updateTrainingConfig(key, value);
  }

  function applyTrainingPreset(presetKey: TrainingPresetKey) {
    const preset = trainingPresetOptions.find((option) => option.key === presetKey);
    if (!preset) return;
    setTrainingPreset(presetKey);
    setTrainingConfig((currentConfig) => ({
      ...currentConfig,
      ...preset.config,
    }));
  }

  function updateInferenceNumberConfig(
    key: keyof typeof defaultInferenceConfig,
    value: number,
  ) {
    if (!Number.isFinite(value)) return;
    setInferenceConfig((currentConfig) => ({
      ...currentConfig,
      [key]: value,
    }));
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
      <div className="tab-bar" role="tablist" aria-label={t("project.detailFallback")}>
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
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

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
                <p className="section-label">{t("detail.datasets")}</p>
                <h2>{t("dataset.list")}</h2>
              </div>
              <div className="panel__actions">
                {datasetsQuery.isFetching ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
                <button className="primary-button" onClick={openDatasetDialog} type="button">
                  <Plus aria-hidden="true" size={17} />
                  <span>{t("dataset.registered")}</span>
                </button>
              </div>
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
                  <span className="dataset-row__thumbnail" aria-hidden="true">
                    {dataset.image_count > 0 ? (
                      <img
                        alt=""
                        data-dataset-thumbnail={dataset.id}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                        src={apiUrl(`/api/projects/${projectId}/datasets/${dataset.id}/thumbnail`)}
                      />
                    ) : (
                      <Database aria-hidden="true" size={18} />
                    )}
                  </span>
                  <span className="dataset-row__content">
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
                <p>{t("dataset.empty")}</p>
              </div>
            ) : null}

            {datasetsQuery.isError ? (
              <div className="notice notice--danger" role="alert">
                {t("dataset.loadError")}
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel__header">
              <div>
                <p className="section-label">{t("dataset.validation")}</p>
                <h2>{t("training.summaryMetrics")}</h2>
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
                <h2>{t("training.create")}</h2>
              </div>
            </div>
            <form className="split-form" onSubmit={handleSplitSubmit}>
              <label className="field">
                <span>{t("form.name")}</span>
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
                  {t("split.createError")}
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
                <span>{t("dataset.createSplit")}</span>
              </button>
            </form>
          </div>

          <div className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="section-label">Split</p>
                <h2>{t("split.list")}</h2>
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
                    {formatCount(split.train_count, language)} / {formatCount(split.val_count, language)}
                  </span>
                </div>
              ))}
            </div>
            {selectedDatasetId && !splitsQuery.isLoading && (splitsQuery.data ?? []).length === 0 ? (
              <div className="empty-state empty-state--compact">
                <GitBranch aria-hidden="true" size={22} />
                <p>{t("split.empty")}</p>
              </div>
            ) : null}
            {!selectedDatasetId ? (
              <div className="empty-state empty-state--compact">
                <GitBranch aria-hidden="true" size={22} />
                <p>{t("dataset.noDatasetSelected")}</p>
              </div>
            ) : null}
          </div>

          {datasetDialogOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="dataset-upload-title"
                aria-modal="true"
                className="modal-panel modal-panel--wide"
                role="dialog"
              >
                <form className="modal-form" onSubmit={handleDatasetSubmit}>
                  <div className="panel__header">
                    <div>
                      <p className="section-label">{t("dataset.register")}</p>
                      <h2 id="dataset-upload-title">{t("dataset.upload")}</h2>
                    </div>
                    <button
                      aria-label={t("dataset.closeUpload")}
                      className="icon-button"
                      disabled={createDataset.isPending}
                      onClick={closeDatasetDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                  <label className="field">
                    <span>{t("form.name")}</span>
                    <input
                      autoFocus
                      onChange={(event) => setDatasetName(event.target.value)}
                      placeholder={t("dataset.namePlaceholder")}
                      required
                      type="text"
                      value={datasetName}
                    />
                  </label>
                  <DatasetUploadPicker
                    accept=".jpg,.jpeg,.png,.bmp,.webp"
                    description={t("dataset.imageFolderDescription")}
                    files={imageFiles}
                    inputLabel={t("dataset.imageFolderSelect")}
                    kind="images"
                    onFilesChange={setImageFiles}
                    title={t("dataset.imageFolder")}
                  />
                  <DatasetUploadPicker
                    accept=".txt"
                    description={t("dataset.labelFolderDescription")}
                    files={labelFiles}
                    inputLabel={t("dataset.labelFolderSelect")}
                    kind="labels"
                    onFilesChange={setLabelFiles}
                    title={t("dataset.labelFolder")}
                  />
                  <DatasetUploadPicker
                    accept=".yaml,.yml"
                    description={t("dataset.yamlDescription")}
                    files={dataYamlFiles}
                    inputLabel="data.yaml"
                    kind="data_yaml"
                    multiple={false}
                    onFilesChange={setDataYamlFiles}
                    title="data.yaml"
                  />
                  {createDataset.isError ? (
                    <div className="notice notice--danger" role="alert">
                      {createDataset.error instanceof Error
                        ? createDataset.error.message
                        : t("dataset.uploadError")}
                    </div>
                  ) : null}
                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={createDataset.isPending}
                      onClick={closeDatasetDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        !datasetName.trim() ||
                        imageFiles.length === 0 ||
                        labelFiles.length === 0 ||
                        dataYamlFiles.length === 0 ||
                        createDataset.isPending
                      }
                      type="submit"
                    >
                      {createDataset.isPending ? (
                        <Loader2 aria-hidden="true" className="spin" size={17} />
                      ) : (
                        <Plus aria-hidden="true" size={17} />
                      )}
                      <span>{t("dataset.register")}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
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
                  <p className="section-label">{t("detail.training")}</p>
                  <h2>{t("training.list")}</h2>
                </div>
                {trainingRunsQuery.isFetching ? (
                  <Loader2 aria-hidden="true" className="spin" size={18} />
                ) : null}
              </div>

              <div className="segment-control" aria-label={t("training.filter")}>
                {trainingStatusFilters.map((filter) => (
                  <button
                    aria-pressed={trainingStatusFilter === filter.key}
                    key={filter.key}
                    onClick={() => setTrainingStatusFilter(filter.key)}
                    type="button"
                  >
                    {t(filter.labelKey)}
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
                          {run.model_name} · {formatDate(run.created_at, language)}
                        </small>
                      </span>
                      <StatusBadge status={run.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state empty-state--compact">
                  <p>
                    {trainingRunsQuery.isLoading ? t("training.listLoading") : t("training.listEmpty")}
                  </p>
                </div>
              )}

              {trainingRunsQuery.isError ? (
                <div className="notice notice--danger" role="alert">
                  {t("training.listLoadError")}
                </div>
              ) : null}
            </div>

            <form className="panel form-panel training-form" onSubmit={handleTrainingSubmit}>
              <div className="panel__header">
                <div>
                  <p className="section-label">{t("training.create")}</p>
                  <h2>{t("training.new")}</h2>
                </div>
              </div>

              <label className="field">
                <span>{t("form.name")}</span>
                <input
                  onChange={(event) => setTrainingName(event.target.value)}
                  placeholder={t("training.namePlaceholder")}
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
                <div className="notice notice--warning">{t("dataset.loading")}</div>
              ) : null}
              {!datasetsQuery.isLoading && visibleDatasets.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <Database aria-hidden="true" size={22} />
                  <p>{t("dataset.empty")}</p>
                  <small>{t("training.datasetRequired")}</small>
                </div>
              ) : null}
              {visibleDatasets.length > 0 && trainingSplitOptions.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <GitBranch aria-hidden="true" size={22} />
                  <p>{t("split.empty")}</p>
                  <small>{t("training.splitRequiredHelp")}</small>
                </div>
              ) : null}

              <label className="field">
                <span>{t("training.hyperparameterPreset")}</span>
                <select
                  aria-label={t("training.hyperparameterPreset")}
                  onChange={(event) => applyTrainingPreset(event.target.value as TrainingPresetKey)}
                  value={trainingPreset}
                >
                  {trainingPresetOptions.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {t(preset.labelKey)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>{t("training.modelPreset")}</span>
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
                  <span>optimizer</span>
                  <select
                    onChange={(event) => updateTrainingConfig("optimizer", event.target.value)}
                    value={trainingConfig.optimizer}
                  >
                    <option value="auto">auto</option>
                    <option value="SGD">SGD</option>
                    <option value="Adam">Adam</option>
                    <option value="AdamW">AdamW</option>
                    <option value="NAdam">NAdam</option>
                    <option value="RAdam">RAdam</option>
                    <option value="RMSProp">RMSProp</option>
                  </select>
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
                  <select
                    onChange={(event) => updateTrainingConfig("device", event.target.value)}
                    value={trainingConfig.device}
                  >
                    {(runtimeQuery.data?.devices ?? [
                      { id: "cpu", label: "CPU", kind: "cpu", available: true, details: {} },
                    ]).map((device) => (
                      <option disabled={!device.available} key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <details className="advanced-settings">
                <summary>{t("training.advancedHyperparameters")}</summary>
                <div className="field-row field-row--two">
                  <label className="field">
                    <span>lrf</span>
                    <input
                      min={0.000001}
                      onChange={(event) => updateTrainingNumberConfig("lrf", event.target.valueAsNumber)}
                      step={0.001}
                      type="number"
                      value={trainingConfig.lrf}
                    />
                  </label>
                  <label className="field">
                    <span>momentum</span>
                    <input
                      min={0.000001}
                      onChange={(event) => updateTrainingNumberConfig("momentum", event.target.valueAsNumber)}
                      step={0.001}
                      type="number"
                      value={trainingConfig.momentum}
                    />
                  </label>
                  <label className="field">
                    <span>weight decay</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("weight_decay", event.target.valueAsNumber)}
                      step={0.0001}
                      type="number"
                      value={trainingConfig.weight_decay}
                    />
                  </label>
                  <label className="field">
                    <span>warmup epochs</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("warmup_epochs", event.target.valueAsNumber)}
                      step={0.5}
                      type="number"
                      value={trainingConfig.warmup_epochs}
                    />
                  </label>
                  <label className="field">
                    <span>close mosaic</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("close_mosaic", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.close_mosaic}
                    />
                  </label>
                  <label className="field">
                    <span>workers</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("workers", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.workers}
                    />
                  </label>
                  <label className="field">
                    <span>seed</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("seed", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.seed}
                    />
                  </label>
                  <label className="field">
                    <span>freeze</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("freeze", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.freeze}
                    />
                  </label>
                  <label className="field">
                    <span>dropout</span>
                    <input
                      max={1}
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("dropout", event.target.valueAsNumber)}
                      step={0.01}
                      type="number"
                      value={trainingConfig.dropout}
                    />
                  </label>
                  <label className="field">
                    <span>mosaic</span>
                    <input
                      max={1}
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("mosaic", event.target.valueAsNumber)}
                      step={0.05}
                      type="number"
                      value={trainingConfig.mosaic}
                    />
                  </label>
                  <label className="field">
                    <span>mixup</span>
                    <input
                      max={1}
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("mixup", event.target.valueAsNumber)}
                      step={0.05}
                      type="number"
                      value={trainingConfig.mixup}
                    />
                  </label>
                  <label className="field">
                    <span>degrees</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("degrees", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.degrees}
                    />
                  </label>
                  <label className="field">
                    <span>translate</span>
                    <input
                      max={1}
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("translate", event.target.valueAsNumber)}
                      step={0.01}
                      type="number"
                      value={trainingConfig.translate}
                    />
                  </label>
                  <label className="field">
                    <span>scale</span>
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("scale", event.target.valueAsNumber)}
                      step={0.05}
                      type="number"
                      value={trainingConfig.scale}
                    />
                  </label>
                  <label className="field">
                    <span>fliplr</span>
                    <input
                      max={1}
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("fliplr", event.target.valueAsNumber)}
                      step={0.05}
                      type="number"
                      value={trainingConfig.fliplr}
                    />
                  </label>
                </div>
                <div className="toggle-grid">
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.cos_lr}
                      onChange={(event) => updateTrainingBooleanConfig("cos_lr", event.target.checked)}
                      type="checkbox"
                    />
                    <span>cos lr</span>
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.cache}
                      onChange={(event) => updateTrainingBooleanConfig("cache", event.target.checked)}
                      type="checkbox"
                    />
                    <span>cache</span>
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.deterministic}
                      onChange={(event) => updateTrainingBooleanConfig("deterministic", event.target.checked)}
                      type="checkbox"
                    />
                    <span>deterministic</span>
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.amp}
                      onChange={(event) => updateTrainingBooleanConfig("amp", event.target.checked)}
                      type="checkbox"
                    />
                    <span>amp</span>
                  </label>
                </div>
              </details>

              <div className="runtime-panel-wrap">
                <div className="panel__header panel__header--compact">
                  <div>
                    <p className="section-label">Runtime</p>
                    <h2>{t("runtime.trainingEnvironment")}</h2>
                  </div>
                  {runtimeQuery.isFetching ? (
                    <Loader2 aria-hidden="true" className="spin" size={18} />
                  ) : null}
                </div>
                <RuntimePanel installRuntime={installRuntime} runtime={runtimeQuery.data} />
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
                    : t("training.createError")}
                </div>
              ) : null}
              {preflightResult && !preflightResult.can_start ? (
                <div className="notice notice--danger" role="alert">
                  <strong>{t("training.preflightIssues")}</strong>
                  <ul>
                    {preflightResult.blocking_issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preflightResult?.warnings.length ? (
                <div className="notice notice--warning" role="status">
                  <strong>{t("training.preflightWarnings")}</strong>
                  <ul>
                    {preflightResult.warnings.slice(0, 3).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <button
                className="primary-button"
                disabled={
                  Boolean(trainingFormError) ||
                  createTrainingRun.isPending ||
                  runTrainingPreflight.isPending
                }
                type="submit"
              >
                {createTrainingRun.isPending || runTrainingPreflight.isPending ? (
                  <Loader2 aria-hidden="true" className="spin" size={17} />
                ) : (
                  <Play aria-hidden="true" size={17} />
                )}
                <span>{t("training.start")}</span>
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
        <section
          aria-labelledby="inference-tab"
          className="inference-grid"
          id="inference-panel"
          role="tabpanel"
        >
          <form className="panel form-panel" onSubmit={handleInferenceSubmit}>
            <div className="panel__header">
              <div>
                <p className="section-label">Inference</p>
                <h2>{t("inference.run")}</h2>
              </div>
              {trainingRunsQuery.isFetching ? (
                <Loader2 aria-hidden="true" className="spin" size={18} />
              ) : null}
            </div>

            <label className="field">
              <span>{t("form.name")}</span>
              <input
                onChange={(event) => setInferenceName(event.target.value)}
                placeholder={t("inference.namePlaceholder")}
                required
                type="text"
                value={inferenceName}
              />
            </label>

            <label className="field">
              <span>{t("inference.model")}</span>
              <select
                disabled={artifactOptions.length === 0}
                onChange={(event) => setInferenceArtifactId(event.target.value)}
                required
                value={selectedInferenceArtifactId}
              >
                {artifactOptions.map((option) => (
                  <option key={option.artifact.id} value={option.artifact.id}>
                    {artifactOptionLabel(option)} - {fileName(option.artifact.path)}
                  </option>
                ))}
              </select>
            </label>

            {artifactOptions.length === 0 ? (
              <div className="empty-state empty-state--compact">
                <p>{t("inference.availableModelEmpty")}</p>
                <small>{t("inference.availableModelHelp")}</small>
              </div>
            ) : null}

            <label className="field">
              <span>{t("inference.inputType")}</span>
              <select
                aria-label={t("inference.inputTypeLabel")}
                onChange={(event) => {
                  setInferenceInputType(event.target.value as "image" | "folder");
                  setInferenceFiles([]);
                }}
                value={inferenceInputType}
              >
                <option value="folder">{t("inference.folder")}</option>
                <option value="image">{t("inference.image")}</option>
              </select>
            </label>

            <DatasetUploadPicker
              accept=".jpg,.jpeg,.png,.bmp,.webp"
              description={
                inferenceInputType === "folder"
                  ? t("inference.folderDescription")
                  : t("inference.imageDescription")
              }
              directory={inferenceInputType === "folder"}
              files={inferenceFiles}
              inputLabel={
                inferenceInputType === "folder" ? t("inference.folderSelect") : t("inference.imageSelect")
              }
              kind="inference_input"
              multiple={inferenceInputType === "folder"}
              onFilesChange={(files) =>
                setInferenceFiles(inferenceInputType === "folder" ? files : files.slice(0, 1))
              }
              title={inferenceInputType === "folder" ? t("dataset.imageFolder") : t("inference.image")}
            />

            <div className="field-row field-row--two">
              <label className="field">
                <span>conf</span>
                <input
                  max={1}
                  min={0}
                  onChange={(event) =>
                    updateInferenceNumberConfig("conf", event.target.valueAsNumber)
                  }
                  step={0.01}
                  type="number"
                  value={inferenceConfig.conf}
                />
              </label>
              <label className="field">
                <span>imgsz</span>
                <input
                  min={1}
                  onChange={(event) =>
                    updateInferenceNumberConfig("imgsz", event.target.valueAsNumber)
                  }
                  step={1}
                  type="number"
                  value={inferenceConfig.imgsz}
                />
              </label>
            </div>

            {createInferenceRun.isError ? (
              <div className="notice notice--danger" role="alert">
                {createInferenceRun.error instanceof Error
                  ? createInferenceRun.error.message
                  : t("inference.createError")}
              </div>
            ) : null}

            <button
              className="primary-button"
              disabled={
                !inferenceName.trim() ||
                !selectedInferenceArtifactId ||
                inferenceFiles.length === 0 ||
                createInferenceRun.isPending
              }
              type="submit"
            >
              {createInferenceRun.isPending ? (
                <Loader2 aria-hidden="true" className="spin" size={17} />
              ) : (
                <Play aria-hidden="true" size={17} />
              )}
              <span>{t("inference.start")}</span>
            </button>
          </form>

          <div className="panel panel--wide">
            <div className="panel__header">
              <div>
                <p className="section-label">Runs</p>
                <h2>{t("inference.runs")}</h2>
              </div>
              {inferenceRunsQuery.isFetching ? (
                <Loader2 aria-hidden="true" className="spin" size={18} />
              ) : null}
            </div>
            {inferenceRuns.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("projects.columnName")}</th>
                      <th>ID</th>
                      <th>{t("projects.columnStatus")}</th>
                      <th>{t("inference.input")}</th>
                      <th>{t("inference.predictions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inferenceRuns.map((run) => (
                      <tr
                        data-selected={selectedInferenceRun?.id === run.id ? "true" : undefined}
                        key={run.id}
                        onClick={() => setSelectedInferenceRunId(run.id)}
                      >
                        <td>{run.name}</td>
                        <td>{run.id}</td>
                        <td>
                          <StatusBadge status={run.status} />
                        </td>
                        <td>{run.input_path}</td>
                        <td>{run.prediction_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("inference.noRuns")}</p>
              </div>
            )}

            {selectedInferenceRun ? (
              <div className="inference-results">
                <div className="panel__header panel__header--compact">
                  <div>
                    <p className="section-label">Predictions</p>
                    <h2>{t("inference.results")}</h2>
                  </div>
                  {inferencePredictionsQuery.isFetching ? (
                    <Loader2 aria-hidden="true" className="spin" size={18} />
                  ) : null}
                </div>

                {selectedInferenceRun.status !== "completed" ? (
                  <div className="empty-state empty-state--compact">
                    <p>{t("inference.resultsPending")}</p>
                    <small>{t("inference.resultsPendingHelp")}</small>
                  </div>
                ) : inferencePredictions.length > 0 ? (
                  <div className="prediction-grid">
                    {inferencePredictions.map((prediction) => {
                      const detections = predictionDetections(prediction);
                      return (
                        <article className="prediction-card" key={prediction.id}>
                          <img
                            alt={t("inference.resultAlt", { name: fileName(prediction.image_path) })}
                            src={apiUrl(
                              `/api/projects/${projectId}/inference-runs/${selectedInferenceRun.id}/predictions/${prediction.id}/image`,
                            )}
                          />
                          <div className="prediction-card__body">
                            <strong>{fileName(prediction.image_path)}</strong>
                            <span>
                              {t("inference.objectCount", {
                                count: detections.length,
                                confidence: prediction.max_confidence.toFixed(2),
                              })}
                            </span>
                            {detections.length > 0 ? (
                              <div className="prediction-tags">
                                {detections.slice(0, 6).map((detection, index) => (
                                  <em key={`${prediction.id}-${index}`}>
                                    {detectionLabel(detection)}
                                  </em>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state empty-state--compact">
                    <p>{t("inference.noResultImage")}</p>
                    <small>{t("inference.noResultImageHelp")}</small>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
