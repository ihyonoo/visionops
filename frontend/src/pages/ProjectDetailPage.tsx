import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Database,
  GitBranch,
  Info,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DragEvent,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { apiDelete, apiGet, apiPatch, apiPost, apiUrl } from "../api/client";
import {
  isActiveWorkStatus,
  isTerminalWorkStatus,
  shouldRefetchPredictionResults,
  workRunsQueryRefetchInterval,
} from "../api/realtime";
import { LogViewer } from "../components/LogViewer";
import { LocalPathActions } from "../components/LocalPathActions";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage, type Language, type TranslationFunction } from "../i18n/LanguageProvider";
import { isManagedVisionOpsPath } from "../utils/localPaths";
import { TrainingRunPage } from "./TrainingRunPage";
import type {
  Dataset,
  DatasetSplit,
  DatasetSplitCreate,
  DatasetSplitUpdate,
  InferencePrediction,
  InferenceRun,
  ModelArtifact,
  RuntimeCheck,
  TrainingRun,
  TrainingRunCreate,
  TrainingPreflight,
} from "../api/types";

export type DetailTab = "datasets" | "training" | "inference";

type ProjectDetailPageProps = {
  activeTab: DetailTab;
  focusedInferenceRunId?: string | null;
  onTabChange: (tab: DetailTab) => void;
  projectId: string;
};

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
type TrainingModelGroup = "YOLO26" | "YOLO12" | "YOLO11" | "YOLOv10" | "YOLOv9" | "YOLOv8";
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

const trainingModelSizeConfig: Record<string, Partial<TrainingConfigState>> = {
  t: { batch: 16, epochs: 50, imgsz: 640 },
  n: { batch: 16, epochs: 50, imgsz: 640 },
  s: { batch: 16, epochs: 60, imgsz: 640 },
  m: { batch: 8, epochs: 80, imgsz: 640 },
  b: { batch: 8, epochs: 80, imgsz: 640 },
  c: { batch: 6, epochs: 100, imgsz: 640 },
  l: { batch: 6, epochs: 100, imgsz: 640 },
  e: { batch: 4, epochs: 100, imgsz: 640 },
  x: { batch: 4, epochs: 100, imgsz: 640 },
};

function trainingModelOption(value: string, size: string, label: string) {
  return {
    value,
    label: `${value} · ${label}`,
    config: trainingModelSizeConfig[size],
  };
}

const trainingModelGroups: Array<{
  group: TrainingModelGroup;
  options: Array<{
    value: string;
    label: string;
    config: Partial<TrainingConfigState>;
  }>;
}> = [
  {
    group: "YOLO26",
    options: [
      trainingModelOption("yolo26n", "n", "nano"),
      trainingModelOption("yolo26s", "s", "small"),
      trainingModelOption("yolo26m", "m", "medium"),
      trainingModelOption("yolo26l", "l", "large"),
      trainingModelOption("yolo26x", "x", "xlarge"),
    ],
  },
  {
    group: "YOLO12",
    options: [
      trainingModelOption("yolo12n", "n", "nano"),
      trainingModelOption("yolo12s", "s", "small"),
      trainingModelOption("yolo12m", "m", "medium"),
      trainingModelOption("yolo12l", "l", "large"),
      trainingModelOption("yolo12x", "x", "xlarge"),
    ],
  },
  {
    group: "YOLO11",
    options: [
      trainingModelOption("yolo11n", "n", "nano"),
      trainingModelOption("yolo11s", "s", "small"),
      trainingModelOption("yolo11m", "m", "medium"),
      trainingModelOption("yolo11l", "l", "large"),
      trainingModelOption("yolo11x", "x", "xlarge"),
    ],
  },
  {
    group: "YOLOv10",
    options: [
      trainingModelOption("yolov10n", "n", "nano"),
      trainingModelOption("yolov10s", "s", "small"),
      trainingModelOption("yolov10m", "m", "medium"),
      trainingModelOption("yolov10b", "b", "balanced"),
      trainingModelOption("yolov10l", "l", "large"),
      trainingModelOption("yolov10x", "x", "xlarge"),
    ],
  },
  {
    group: "YOLOv9",
    options: [
      trainingModelOption("yolov9t", "t", "tiny"),
      trainingModelOption("yolov9s", "s", "small"),
      trainingModelOption("yolov9m", "m", "medium"),
      trainingModelOption("yolov9c", "c", "compact"),
      trainingModelOption("yolov9e", "e", "extended"),
    ],
  },
  {
    group: "YOLOv8",
    options: [
      trainingModelOption("yolov8n", "n", "nano"),
      trainingModelOption("yolov8s", "s", "small"),
      trainingModelOption("yolov8m", "m", "medium"),
      trainingModelOption("yolov8l", "l", "large"),
      trainingModelOption("yolov8x", "x", "xlarge"),
    ],
  },
];

const trainingModelOptions = trainingModelGroups.flatMap((group) => group.options);

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

function uploadFileName(file: UploadFileWithPath, preserveRelativePath = false): string {
  const rawPath = file.webkitRelativePath || file.name;
  if (preserveRelativePath) return rawPath;
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.length <= 1) return file.name;
  return parts.slice(1).join("/");
}

function appendFiles(
  formData: FormData,
  key: "images" | "labels" | "inputs",
  files: File[],
  options: { preserveRelativePath?: boolean } = {},
) {
  for (const file of files) {
    formData.append(key, file, uploadFileName(file, options.preserveRelativePath));
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

function splitPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function isFiniteRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function splitRatioError(
  trainRatio: number,
  valRatio: number,
  testRatio: number,
  seed: number,
  t: TranslationFunction,
): string | null {
  if (!isFiniteRatio(trainRatio) || !isFiniteRatio(valRatio) || !isFiniteRatio(testRatio)) {
    return t("split.validationRatioBounds");
  }
  if (Math.abs(trainRatio + valRatio + testRatio - 1) > 1e-6) {
    return t("split.validationRatioSum");
  }
  if (!Number.isFinite(seed) || seed < 0) {
    return t("split.validationSeed");
  }
  return null;
}

function parseNumberInput(value: string): number {
  if (!value.trim()) return Number.NaN;
  return Number(value);
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

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

function isLongInternalId(value: string): boolean {
  return /^[a-f0-9]{24,}$/iu.test(value);
}

function shortInternalId(value: string): string {
  return isLongInternalId(value) ? `#${value.slice(0, 8)}` : value;
}

function artifactOptionLabel(option: ArtifactOption): string {
  return `${option.run.name} / ${option.artifact.kind}`;
}

function predictionImageUrl(
  projectId: string,
  runId: string,
  prediction: InferencePrediction,
): string {
  const cacheKey = encodeURIComponent(`${prediction.output_image_path}:${prediction.updated_at}`);
  return apiUrl(
    `/api/projects/${projectId}/inference-runs/${runId}/predictions/${prediction.id}/image?v=${cacheKey}`,
  );
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

function ParameterHelp({
  expanded,
  label,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      aria-expanded={expanded}
      aria-label={t("help.parameter", { name: label })}
      className="parameter-help__button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      <Info aria-hidden="true" size={14} />
    </button>
  );
}

function FieldLabel({ label, help }: { label: string; help: string }) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <span className="field-label">
      <span className="field-label__row">
        <span className="field-label__text">{label}</span>
        <ParameterHelp
          expanded={helpOpen}
          label={label}
          onToggle={() => setHelpOpen((current) => !current)}
        />
      </span>
      {helpOpen ? (
        <span className="field-label__help" role="tooltip">
          {help}
        </span>
      ) : null}
    </span>
  );
}

export function ProjectDetailPage({
  activeTab,
  focusedInferenceRunId = null,
  onTabChange,
  projectId,
}: ProjectDetailPageProps) {
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const previousInferenceStatusesRef = useRef<Map<string, string>>(new Map());
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [datasetEditName, setDatasetEditName] = useState("");
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [deletingDataset, setDeletingDataset] = useState<Dataset | null>(null);
  const [datasetMenuId, setDatasetMenuId] = useState<string | null>(null);
  const [optimisticDatasets, setOptimisticDatasets] = useState<Dataset[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [labelFiles, setLabelFiles] = useState<File[]>([]);
  const [dataYamlFiles, setDataYamlFiles] = useState<File[]>([]);
  const [expandedSplitDatasetId, setExpandedSplitDatasetId] = useState<string | null>(null);
  const [splitDialogDatasetId, setSplitDialogDatasetId] = useState<string | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitMenuId, setSplitMenuId] = useState<string | null>(null);
  const [splitEditName, setSplitEditName] = useState("");
  const [editingSplit, setEditingSplit] = useState<DatasetSplit | null>(null);
  const [deletingSplit, setDeletingSplit] = useState<DatasetSplit | null>(null);
  const [splitName, setSplitName] = useState("");
  const [trainRatioInput, setTrainRatioInput] = useState("");
  const [valRatioInput, setValRatioInput] = useState("");
  const [testRatioInput, setTestRatioInput] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [trainingDrawerOpen, setTrainingDrawerOpen] = useState(false);
  const [advancedTrainingOpen, setAdvancedTrainingOpen] = useState(false);
  const [selectedTrainingRunId, setSelectedTrainingRunId] = useState<string | null>(null);
  const [trainingResultRunId, setTrainingResultRunId] = useState<string | null>(null);
  const [trainingName, setTrainingName] = useState("");
  const [trainingSplitId, setTrainingSplitId] = useState("");
  const [trainingModelName, setTrainingModelName] = useState("yolo26n");
  const [trainingPreset, setTrainingPreset] = useState<TrainingPresetKey>("balanced");
  const [trainingConfig, setTrainingConfig] = useState(defaultTrainingConfig);
  const [preflightResult, setPreflightResult] = useState<TrainingPreflight | null>(null);
  const [inferenceName, setInferenceName] = useState("");
  const [inferenceDialogOpen, setInferenceDialogOpen] = useState(false);
  const [inferenceArtifactId, setInferenceArtifactId] = useState("");
  const [expandedInferenceRunId, setExpandedInferenceRunId] = useState<string | null>(null);
  const [inferenceRunMenuId, setInferenceRunMenuId] = useState<string | null>(null);
  const [selectedPredictionImage, setSelectedPredictionImage] = useState<{
    label: string;
    src: string;
  } | null>(null);
  const [inferenceInputType, setInferenceInputType] = useState<"image" | "folder">("folder");
  const [inferenceFiles, setInferenceFiles] = useState<File[]>([]);
  const [inferenceConfig, setInferenceConfig] = useState(defaultInferenceConfig);
  const trainRatio = parseNumberInput(trainRatioInput);
  const valRatio = parseNumberInput(valRatioInput);
  const testRatio = parseNumberInput(testRatioInput);
  const seed = parseNumberInput(seedInput);
  const splitFormComplete =
    Boolean(splitName.trim()) &&
    Boolean(trainRatioInput.trim()) &&
    Boolean(valRatioInput.trim()) &&
    Boolean(testRatioInput.trim()) &&
    Boolean(seedInput.trim());
  const ratioError = splitFormComplete
    ? splitRatioError(trainRatio, valRatio, testRatio, seed, t)
    : t("split.validationRequired");
  const configError = trainingConfigError(trainingConfig, t);
  const trainingNameError = trainingName.trim() ? null : t("training.nameRequired");
  const splitSelectionError = trainingSplitId ? null : t("training.splitRequired");
  const trainingFormError = trainingNameError ?? splitSelectionError ?? configError;
  const trainingCommandPreview = preflightResult?.command_preview;
  const canStartAfterCommandPreview = Boolean(preflightResult?.can_start && trainingCommandPreview);

  const datasetsQuery = useQuery({
    queryFn: () => apiGet<Dataset[]>(`/api/projects/${projectId}/datasets`),
    queryKey: ["projects", projectId, "datasets"],
  });
  const datasets = datasetsQuery.data ?? [];

  const createDataset = useMutation({
    mutationFn: (body: FormData) =>
      apiPost<Dataset>(`/api/projects/${projectId}/datasets/upload`, body),
    onSuccess: (dataset) => {
      setDatasetDialogOpen(false);
      setDatasetName("");
      setImageFiles([]);
      setLabelFiles([]);
      setDataYamlFiles([]);
      setOptimisticDatasets((currentDatasets) => [
        dataset,
        ...currentDatasets.filter((currentDataset) => currentDataset.id !== dataset.id),
      ]);
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

  const updateDataset = useMutation({
    mutationFn: ({ body, id }: { body: { name: string }; id: string }) =>
      apiPatch<Dataset>(`/api/projects/${projectId}/datasets/${id}`, body),
    onSuccess: (dataset) => {
      setEditingDataset(null);
      setDatasetEditName("");
      setDatasetMenuId(null);
      setOptimisticDatasets((currentDatasets) =>
        currentDatasets.map((currentDataset) =>
          currentDataset.id === dataset.id ? dataset : currentDataset,
        ),
      );
      queryClient.setQueryData<Dataset[]>(
        ["projects", projectId, "datasets"],
        (currentDatasets = []) =>
          currentDatasets.map((currentDataset) =>
            currentDataset.id === dataset.id ? dataset : currentDataset,
          ),
      );
      queryClient.setQueryData(["projects", projectId, "datasets", dataset.id], dataset);
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "datasets"] });
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "datasets", dataset.id] });
    },
  });

  const deleteDataset = useMutation({
    mutationFn: (datasetId: string) =>
      apiDelete(`/api/projects/${projectId}/datasets/${datasetId}`),
    onSuccess: (_result, datasetId) => {
      setDeletingDataset(null);
      setDatasetMenuId(null);
      setOptimisticDatasets((currentDatasets) =>
        currentDatasets.filter((currentDataset) => currentDataset.id !== datasetId),
      );
      queryClient.setQueryData<Dataset[]>(
        ["projects", projectId, "datasets"],
        (currentDatasets = []) =>
          currentDatasets.filter((currentDataset) => currentDataset.id !== datasetId),
      );
      queryClient.removeQueries({ queryKey: ["projects", projectId, "datasets", datasetId] });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "datasets", datasetId, "splits"],
      });
      if (expandedSplitDatasetId === datasetId) {
        setExpandedSplitDatasetId(null);
      }
      if (splitDialogDatasetId === datasetId) {
        setSplitDialogOpen(false);
        setSplitDialogDatasetId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "datasets"] });
    },
  });

  const createSplit = useMutation({
    mutationFn: ({ body, datasetId }: { body: DatasetSplitCreate; datasetId: string }) =>
      apiPost<DatasetSplit>(
        `/api/projects/${projectId}/datasets/${datasetId}/splits`,
        body,
      ),
    onSuccess: (_split, { datasetId }) => {
      setSplitDialogOpen(false);
      setSplitDialogDatasetId(null);
      setSplitName("");
      setTrainRatioInput("");
      setValRatioInput("");
      setTestRatioInput("");
      setSeedInput("");
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "datasets", datasetId, "splits"],
      });
    },
  });

  const updateSplit = useMutation({
    mutationFn: ({
      body,
      datasetId,
      id,
    }: {
      body: DatasetSplitUpdate;
      datasetId: string;
      id: string;
    }) =>
      apiPatch<DatasetSplit>(
        `/api/projects/${projectId}/datasets/${datasetId}/splits/${id}`,
        body,
      ),
    onSuccess: (split) => {
      setEditingSplit(null);
      setSplitEditName("");
      setSplitMenuId(null);
      queryClient.setQueryData<DatasetSplit[]>(
        ["projects", projectId, "datasets", split.dataset_id, "splits"],
        (currentSplits = []) =>
          currentSplits.map((currentSplit) =>
            currentSplit.id === split.id ? split : currentSplit,
          ),
      );
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "datasets", split.dataset_id, "splits"],
      });
    },
  });

  const deleteSplit = useMutation({
    mutationFn: (split: DatasetSplit) =>
      apiDelete(`/api/projects/${projectId}/datasets/${split.dataset_id}/splits/${split.id}`),
    onSuccess: (_result, split) => {
      setDeletingSplit(null);
      setSplitMenuId(null);
      queryClient.setQueryData<DatasetSplit[]>(
        ["projects", projectId, "datasets", split.dataset_id, "splits"],
        (currentSplits = []) =>
          currentSplits.filter((currentSplit) => currentSplit.id !== split.id),
      );
      if (trainingSplitId === split.id) {
        setTrainingSplitId("");
      }
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "datasets", split.dataset_id, "splits"],
      });
    },
  });

  const visibleDatasets = useMemo(() => {
    const datasetIds = new Set(datasets.map((dataset) => dataset.id));
    return [
      ...optimisticDatasets.filter((dataset) => !datasetIds.has(dataset.id)),
      ...datasets,
    ];
  }, [datasets, optimisticDatasets]);

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
          datasetId: dataset?.id ?? split.dataset_id,
          datasetName: dataset?.name ?? t("dataset.dataset"),
          split,
        }));
      }),
    [t, trainingSplitQueries, visibleDatasets],
  );
  const selectedTrainingSplitOption =
    trainingSplitOptions.find((option) => option.split.id === trainingSplitId) ?? null;

  const trainingRunsQuery = useQuery({
    enabled: activeTab === "training" || activeTab === "inference",
    queryFn: () => apiGet<TrainingRun[]>(`/api/projects/${projectId}/training-runs`),
    queryKey: ["projects", projectId, "training-runs"],
    refetchInterval: workRunsQueryRefetchInterval,
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
    refetchInterval: workRunsQueryRefetchInterval,
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
  const inferencePredictionQueries = useQueries({
    queries: inferenceRuns.map((run) => ({
      enabled: activeTab === "inference",
      queryFn: () =>
        apiGet<InferencePrediction[]>(
          `/api/projects/${projectId}/inference-runs/${run.id}/predictions`,
        ),
      queryKey: ["projects", projectId, "inference-runs", run.id, "predictions"],
      refetchInterval: shouldRefetchPredictionResults(run),
    })),
  });
  const inferencePredictionsByRunId = useMemo(() => {
    const predictions = new Map<string, InferencePrediction[]>();
    inferenceRuns.forEach((run, index) => {
      predictions.set(run.id, inferencePredictionQueries[index]?.data ?? []);
    });
    return predictions;
  }, [inferencePredictionQueries, inferenceRuns]);
  const prioritizedTrainingRuns = useMemo(
    () =>
      [...trainingRuns].sort((left, right) => {
        const leftActive = left.status === "queued" || left.status === "pending" || left.status === "running";
        const rightActive = right.status === "queued" || right.status === "pending" || right.status === "running";
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      }),
    [trainingRuns],
  );
  const selectedSplitTrainingRuns = useMemo(
    () => prioritizedTrainingRuns.filter((run) => run.split_id === trainingSplitId),
    [prioritizedTrainingRuns, trainingSplitId],
  );
  const selectedTrainingRun =
    trainingSplitId
      ? selectedSplitTrainingRuns.find((run) => run.id === selectedTrainingRunId) ??
        selectedSplitTrainingRuns[0] ??
        null
      : null;

  useEffect(() => {
    if (!trainingSplitId || trainingSplitOptions.some((option) => option.split.id === trainingSplitId)) {
      return;
    }
    setTrainingSplitId("");
    setSelectedTrainingRunId(null);
  }, [trainingSplitId, trainingSplitOptions]);

  useEffect(() => {
    if (!trainingRunsQuery.data) return;
    if (!trainingSplitId) {
      if (selectedTrainingRunId) {
        setSelectedTrainingRunId(null);
      }
      return;
    }
    const nextTrainingRun =
      selectedSplitTrainingRuns.find((run) => run.id === selectedTrainingRunId) ??
      selectedSplitTrainingRuns[0] ??
      null;
    if (nextTrainingRun?.id === selectedTrainingRunId) {
      return;
    }
    setSelectedTrainingRunId(nextTrainingRun?.id ?? null);
  }, [selectedSplitTrainingRuns, selectedTrainingRunId, trainingRunsQuery.data, trainingSplitId]);

  useEffect(() => {
    if (inferenceArtifactId && artifactOptions.some((option) => option.artifact.id === inferenceArtifactId)) {
      return;
    }
    setInferenceArtifactId(artifactOptions[0]?.artifact.id ?? "");
  }, [artifactOptions, inferenceArtifactId]);

  useEffect(() => {
    const previousStatuses = previousInferenceStatusesRef.current;
    const nextStatuses = new Map<string, string>();

    for (const run of inferenceRuns) {
      const normalizedStatus = run.status.trim().toLowerCase();
      const previousStatus = previousStatuses.get(run.id);
      nextStatuses.set(run.id, normalizedStatus);

      if (
        previousStatus &&
        isActiveWorkStatus(previousStatus) &&
        isTerminalWorkStatus(normalizedStatus)
      ) {
        queryClient.invalidateQueries({
          queryKey: ["projects", projectId, "inference-runs", run.id],
        });
        queryClient.invalidateQueries({
          queryKey: ["projects", projectId, "inference-runs", run.id, "predictions"],
        });
      }
    }

    previousInferenceStatusesRef.current = nextStatuses;
  }, [inferenceRuns, projectId, queryClient]);

  useEffect(() => {
    if (!focusedInferenceRunId) return;
    setExpandedInferenceRunId(focusedInferenceRunId);
  }, [focusedInferenceRunId]);

  useEffect(() => {
    if (!selectedPredictionImage) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedPredictionImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPredictionImage]);

  const createTrainingRun = useMutation({
    mutationFn: (body: TrainingRunCreate) =>
      apiPost<TrainingRun>(`/api/projects/${projectId}/training-runs`, body),
    onSuccess: (run) => {
      setSelectedTrainingRunId(run.id);
      setTrainingName("");
      setTrainingDrawerOpen(false);
      setAdvancedTrainingOpen(false);
      setPreflightResult(null);
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

  const createInferenceRun = useMutation({
    mutationFn: (body: FormData) =>
      apiPost<InferenceRun>(`/api/projects/${projectId}/inference-runs/upload`, body),
    onSuccess: (run) => {
      setInferenceName("");
      setInferenceFiles([]);
      setInferenceDialogOpen(false);
      setExpandedInferenceRunId(run.id);
      queryClient.setQueryData<InferenceRun[]>(
        ["projects", projectId, "inference-runs"],
        (currentRuns = []) => [run, ...currentRuns.filter((currentRun) => currentRun.id !== run.id)],
      );
      queryClient.setQueryData(["projects", projectId, "inference-runs", run.id], run);
      queryClient.setQueryData(["projects", projectId, "inference-runs", run.id, "predictions"], []);
    },
  });

  const deleteInferenceRun = useMutation({
    mutationFn: (run: InferenceRun) =>
      apiDelete(`/api/projects/${projectId}/inference-runs/${run.id}`),
    onSuccess: (_result, run) => {
      queryClient.setQueryData<InferenceRun[]>(
        ["projects", projectId, "inference-runs"],
        (currentRuns = []) => currentRuns.filter((currentRun) => currentRun.id !== run.id),
      );
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "inference-runs", run.id, "predictions"],
      });
      if (expandedInferenceRunId === run.id) {
        setExpandedInferenceRunId(null);
      }
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

  function openDatasetEditDialog(dataset: Dataset) {
    updateDataset.reset();
    setDatasetMenuId(null);
    setEditingDataset(dataset);
    setDatasetEditName(dataset.name);
  }

  function closeDatasetEditDialog() {
    if (updateDataset.isPending) return;
    setEditingDataset(null);
    setDatasetEditName("");
    updateDataset.reset();
  }

  function openDatasetDeleteDialog(dataset: Dataset) {
    deleteDataset.reset();
    setDatasetMenuId(null);
    setDeletingDataset(dataset);
  }

  function closeDatasetDeleteDialog() {
    if (deleteDataset.isPending) return;
    setDeletingDataset(null);
    deleteDataset.reset();
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

  function handleDatasetEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = datasetEditName.trim();
    if (!editingDataset || !trimmedName || updateDataset.isPending) return;
    updateDataset.mutate({
      body: { name: trimmedName },
      id: editingDataset.id,
    });
  }

  function handleDatasetDeleteConfirm() {
    if (!deletingDataset || deleteDataset.isPending) return;
    deleteDataset.mutate(deletingDataset.id);
  }

  function openSplitDialog(datasetId: string) {
    createSplit.reset();
    setSplitDialogDatasetId(datasetId);
    setExpandedSplitDatasetId(datasetId);
    setSplitDialogOpen(true);
  }

  function closeSplitDialog() {
    if (createSplit.isPending) return;
    setSplitDialogOpen(false);
    setSplitName("");
    setTrainRatioInput("");
    setValRatioInput("");
    setTestRatioInput("");
    setSeedInput("");
    setSplitDialogDatasetId(null);
    createSplit.reset();
  }

  function openSplitEditDialog(split: DatasetSplit) {
    updateSplit.reset();
    setSplitMenuId(null);
    setSplitEditName(split.name);
    setEditingSplit(split);
  }

  function closeSplitEditDialog() {
    if (updateSplit.isPending) return;
    setEditingSplit(null);
    setSplitEditName("");
    updateSplit.reset();
  }

  function openSplitDeleteDialog(split: DatasetSplit) {
    deleteSplit.reset();
    setSplitMenuId(null);
    setDeletingSplit(split);
  }

  function closeSplitDeleteDialog() {
    if (deleteSplit.isPending) return;
    setDeletingSplit(null);
    deleteSplit.reset();
  }

  function handleSplitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = splitName.trim();
    if (!splitDialogDatasetId || !trimmedName || ratioError || createSplit.isPending) return;

    createSplit.mutate({
      body: {
        name: trimmedName,
        seed,
        train_ratio: trainRatio,
        val_ratio: valRatio,
        test_ratio: testRatio,
      },
      datasetId: splitDialogDatasetId,
    });
  }

  function handleSplitEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = splitEditName.trim();
    if (!editingSplit || !trimmedName || updateSplit.isPending) return;
    updateSplit.mutate({
      body: { name: trimmedName },
      datasetId: editingSplit.dataset_id,
      id: editingSplit.id,
    });
  }

  function handleSplitDeleteConfirm() {
    if (!deletingSplit || deleteSplit.isPending) return;
    deleteSplit.mutate(deletingSplit);
  }

  function openTrainingDrawer() {
    if (!selectedTrainingSplitOption) return;
    createTrainingRun.reset();
    runTrainingPreflight.reset();
    setPreflightResult(null);
    setTrainingDrawerOpen(true);
  }

  function closeTrainingDrawer() {
    if (createTrainingRun.isPending || runTrainingPreflight.isPending) return;
    setTrainingDrawerOpen(false);
    setAdvancedTrainingOpen(false);
  }

  function clearTrainingCommandPreview() {
    if (preflightResult !== null) {
      setPreflightResult(null);
    }
    runTrainingPreflight.reset();
  }

  function selectTrainingSplit(datasetId: string, splitId: string) {
    clearTrainingCommandPreview();
    if (trainingSplitId === splitId) {
      setTrainingSplitId("");
      setSelectedTrainingRunId(null);
      return;
    }
    setExpandedSplitDatasetId(datasetId);
    setTrainingSplitId(splitId);
  }

  function startTrainingFromSplit(datasetId: string, splitId: string) {
    selectTrainingSplit(datasetId, splitId);
    createTrainingRun.reset();
    runTrainingPreflight.reset();
    setPreflightResult(null);
    setTrainingDrawerOpen(true);
    onTabChange("training");
  }

  function openInferenceDialog() {
    createInferenceRun.reset();
    setInferenceDialogOpen(true);
  }

  function closeInferenceDialog() {
    if (createInferenceRun.isPending) return;
    setInferenceDialogOpen(false);
    createInferenceRun.reset();
  }

  function inferenceInputTypeLabel(run: InferenceRun): string {
    return run.input_type === "image" ? t("inference.image") : t("inference.folder");
  }

  function datasetSourceSummary(dataset: Dataset): string {
    return isManagedVisionOpsPath(dataset.source_path) ? t("dataset.managedSource") : dataset.source_path;
  }

  function inferenceInputSummary(run: InferenceRun): string {
    if (run.input_type === "folder" && isManagedVisionOpsPath(run.input_path)) {
      const uploadedFolderName = run.config.uploaded_folder_name;
      if (typeof uploadedFolderName === "string" && uploadedFolderName.trim()) {
        return uploadedFolderName;
      }
    }
    return fileName(run.input_path);
  }

  function inferenceFolderImageCount(run: InferenceRun): number {
    const inputImageCount = run.config.input_image_count;
    if (typeof inputImageCount === "number" && Number.isFinite(inputImageCount)) {
      return inputImageCount;
    }
    return run.prediction_count;
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
    appendFiles(formData, "inputs", inferenceFiles, {
      preserveRelativePath: inferenceInputType === "folder",
    });
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
    if (canStartAfterCommandPreview) {
      createTrainingRun.mutate(body);
      return;
    }
    const preflight = await runTrainingPreflight.mutateAsync(body);
    setPreflightResult(preflight);
  }

  function updateTrainingConfig<Key extends keyof typeof defaultTrainingConfig>(
    key: Key,
    value: (typeof defaultTrainingConfig)[Key],
  ) {
    clearTrainingCommandPreview();
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
    clearTrainingCommandPreview();
    setTrainingPreset(presetKey);
    setTrainingConfig((currentConfig) => ({
      ...currentConfig,
      ...preset.config,
    }));
  }

  function applyTrainingModel(modelName: string) {
    const modelOption = trainingModelOptions.find((option) => option.value === modelName);
    clearTrainingCommandPreview();
    setTrainingModelName(modelName);
    if (!modelOption) return;
    setTrainingConfig((currentConfig) => ({
      ...currentConfig,
      ...modelOption.config,
      close_mosaic: 10,
      mosaic: 1,
      mixup: currentConfig.mixup,
      optimizer: currentConfig.optimizer || "auto",
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

  function toggleDatasetSplits(datasetId: string) {
    setExpandedSplitDatasetId((currentId) => (currentId === datasetId ? null : datasetId));
  }

  return (
    <div className="page-stack">
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
              {visibleDatasets.map((dataset, index) => {
                const datasetSplitsQuery = trainingSplitQueries[index];
                const datasetSplits = datasetSplitsQuery?.data ?? [];
                const isSplitExpanded = expandedSplitDatasetId === dataset.id;

                return (
                  <Fragment key={dataset.id}>
                    <article
                      aria-label={dataset.name}
                      className="dataset-row"
                      data-expanded={isSplitExpanded ? "true" : undefined}
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
                        <small title={dataset.source_path}>{datasetSourceSummary(dataset)}</small>
                        <span className="dataset-row__meta">
                          <span>
                            {t("dataset.images")} {formatCount(dataset.image_count, language)}
                          </span>
                          <span>
                            {t("dataset.labels")} {formatCount(dataset.label_count, language)}
                          </span>
                          <span>
                            {t("dataset.classes")} {formatCount(dataset.class_names.length, language)}
                          </span>
                        </span>
                        {dataset.class_names.length > 0 ? (
                          <span className="dataset-row__classes" aria-label={t("dataset.classList")}>
                            {dataset.class_names.map((className) => (
                              <span className="dataset-row__class-chip" key={className}>
                                {className}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="dataset-row__actions">
                        <span className="dataset-row__menu">
                          <button
                            aria-expanded={datasetMenuId === dataset.id}
                            aria-label={t("dataset.actions", { name: dataset.name })}
                            className="dataset-row__menu-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDatasetMenuId((currentId) =>
                                currentId === dataset.id ? null : dataset.id,
                              );
                            }}
                            type="button"
                          >
                            <MoreVertical aria-hidden="true" size={18} />
                          </button>
                          {datasetMenuId === dataset.id ? (
                            <span
                              className="dataset-row__menu-popover"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button onClick={() => openDatasetEditDialog(dataset)} type="button">
                                <Pencil aria-hidden="true" size={15} />
                                <span>{t("projects.rename")}</span>
                              </button>
                              <LocalPathActions path={dataset.source_path} t={t} variant="menu" />
                              <button onClick={() => openDatasetDeleteDialog(dataset)} type="button">
                                <Trash2 aria-hidden="true" size={15} />
                                <span>{t("projects.delete")}</span>
                              </button>
                            </span>
                          ) : null}
                        </span>
                        <button
                          aria-expanded={isSplitExpanded}
                          aria-label={t("split.toggleSettings", { name: dataset.name })}
                          className="secondary-button dataset-row__split-toggle"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleDatasetSplits(dataset.id);
                          }}
                          type="button"
                        >
                          {isSplitExpanded ? (
                            <ChevronUp aria-hidden="true" size={15} />
                          ) : (
                            <ChevronDown aria-hidden="true" size={15} />
                          )}
                          <span>
                            {t(isSplitExpanded ? "split.toggleClose" : "split.toggleOpen", {
                              count: datasetSplits.length,
                            })}
                          </span>
                        </button>
                      </span>
                    </article>
                    {isSplitExpanded ? (
                      <div className="dataset-row-detail">
                        <div className="dataset-row-detail__section">
                          <div className="dataset-row-detail__header">
                            <div>
                              <h3>{t("split.list")}</h3>
                            </div>
                            <div className="dataset-row-detail__actions">
                              {datasetSplitsQuery?.isFetching ? (
                                <Loader2 aria-hidden="true" className="spin" size={18} />
                              ) : null}
                              <button
                                className="primary-button"
                                onClick={() => openSplitDialog(dataset.id)}
                                type="button"
                              >
                                <Plus aria-hidden="true" size={17} />
                                <span>{t("dataset.createSplit")}</span>
                              </button>
                            </div>
                          </div>
                          <div className="split-list">
                            {datasetSplits.map((split) => (
                              <div className="split-row" key={split.id}>
                                <span>
                                  <strong>{split.name}</strong>
                                  <small>
                                    Train {splitPercent(split.train_ratio)} · Val{" "}
                                    {splitPercent(split.val_ratio)} · Test{" "}
                                    {splitPercent(split.test_ratio)}
                                  </small>
                                </span>
                                <span className="split-row__counts">
                                  {formatCount(split.train_count, language)} /{" "}
                                  {formatCount(split.val_count, language)} /{" "}
                                  {formatCount(split.test_count, language)}
                                </span>
                                <button
                                  className="secondary-button"
                                  onClick={() => startTrainingFromSplit(dataset.id, split.id)}
                                  type="button"
                                >
                                  <Play aria-hidden="true" size={15} />
                                  <span>{t("training.trainThisSplit")}</span>
                                </button>
                                <span className="split-row__menu">
                                  <button
                                    aria-expanded={splitMenuId === split.id}
                                    aria-label={t("split.actions", { name: split.name })}
                                    className="dataset-row__menu-button"
                                    onClick={() =>
                                      setSplitMenuId((currentId) =>
                                        currentId === split.id ? null : split.id,
                                      )
                                    }
                                    type="button"
                                  >
                                    <MoreVertical aria-hidden="true" size={18} />
                                  </button>
                                  {splitMenuId === split.id ? (
                                    <span className="dataset-row__menu-popover">
                                      <button onClick={() => openSplitEditDialog(split)} type="button">
                                        <Pencil aria-hidden="true" size={15} />
                                        <span>{t("projects.rename")}</span>
                                      </button>
                                      <LocalPathActions path={split.split_path} t={t} variant="menu" />
                                      <button onClick={() => openSplitDeleteDialog(split)} type="button">
                                        <Trash2 aria-hidden="true" size={15} />
                                        <span>{t("projects.delete")}</span>
                                      </button>
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            ))}
                          </div>
                          {!datasetSplitsQuery?.isLoading && datasetSplits.length === 0 ? (
                            <div className="empty-state empty-state--compact">
                              <GitBranch aria-hidden="true" size={22} />
                              <p>{t("split.empty")}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
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

          {splitDialogOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="split-create-title"
                aria-modal="true"
                className="modal-panel"
                role="dialog"
              >
                <form className="modal-form split-form" onSubmit={handleSplitSubmit}>
                  <div className="panel__header">
                    <div>
                      <h2 id="split-create-title">{t("dataset.createSplit")}</h2>
                    </div>
                    <button
                      aria-label={t("split.closeCreate")}
                      className="icon-button"
                      disabled={createSplit.isPending}
                      onClick={closeSplitDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                  <label className="field">
                    <span>{t("form.name")}</span>
                    <input
                      autoFocus
                      disabled={!splitDialogDatasetId}
                      onChange={(event) => setSplitName(event.target.value)}
                      placeholder={t("split.namePlaceholder")}
                      required
                      type="text"
                      value={splitName}
                    />
                  </label>
                  <div className="field-row">
                    <label className="field">
                      <span>Train</span>
                      <input
                        disabled={!splitDialogDatasetId}
                        max={1}
                        min={0}
                        onChange={(event) => setTrainRatioInput(event.target.value)}
                        placeholder={t("split.trainPlaceholder")}
                        step={0.05}
                        type="number"
                        value={trainRatioInput}
                      />
                    </label>
                    <label className="field">
                      <span>Val</span>
                      <input
                        disabled={!splitDialogDatasetId}
                        max={1}
                        min={0}
                        onChange={(event) => setValRatioInput(event.target.value)}
                        placeholder={t("split.valPlaceholder")}
                        step={0.05}
                        type="number"
                        value={valRatioInput}
                      />
                    </label>
                    <label className="field">
                      <span>Test</span>
                      <input
                        disabled={!splitDialogDatasetId}
                        max={1}
                        min={0}
                        onChange={(event) => setTestRatioInput(event.target.value)}
                        placeholder={t("split.testPlaceholder")}
                        step={0.05}
                        type="number"
                        value={testRatioInput}
                      />
                    </label>
                    <label className="field">
                      <span>Seed</span>
                      <input
                        disabled={!splitDialogDatasetId}
                        min={0}
                        onChange={(event) => setSeedInput(event.target.value)}
                        placeholder={t("split.seedPlaceholder")}
                        step={1}
                        type="number"
                        value={seedInput}
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
                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={createSplit.isPending}
                      onClick={closeSplitDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        !splitDialogDatasetId ||
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
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {editingSplit ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="split-edit-title"
                aria-modal="true"
                className="modal-panel"
                role="dialog"
              >
                <form className="modal-form" onSubmit={handleSplitEditSubmit}>
                  <div className="panel__header">
                    <div>
                      <h2 id="split-edit-title">{editingSplit.name}</h2>
                    </div>
                    <button
                      aria-label={t("split.closeEdit")}
                      className="icon-button"
                      disabled={updateSplit.isPending}
                      onClick={closeSplitEditDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <label className="field">
                    <span>{t("form.name")}</span>
                    <input
                      autoFocus
                      onChange={(event) => setSplitEditName(event.target.value)}
                      required
                      type="text"
                      value={splitEditName}
                    />
                  </label>

                  {updateSplit.isError ? (
                    <div className="notice notice--danger" role="alert">
                      {t("split.updateError")}
                    </div>
                  ) : null}

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={updateSplit.isPending}
                      onClick={closeSplitEditDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={!splitEditName.trim() || updateSplit.isPending}
                      type="submit"
                    >
                      {updateSplit.isPending ? (
                        <Loader2 aria-hidden="true" className="spin" size={17} />
                      ) : (
                        <Pencil aria-hidden="true" size={17} />
                      )}
                      <span>{t("split.update")}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {deletingSplit ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="split-delete-title"
                aria-modal="true"
                className="modal-panel"
                role="dialog"
              >
                <div className="modal-form">
                  <div className="panel__header">
                    <div>
                      <h2 id="split-delete-title">
                        {t("split.deleteConfirm", { name: deletingSplit.name })}
                      </h2>
                    </div>
                    <button
                      aria-label={t("split.closeDelete")}
                      className="icon-button"
                      disabled={deleteSplit.isPending}
                      onClick={closeSplitDeleteDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <div className="notice notice--warning">
                    {t("split.deleteWarning")}
                  </div>

                  {deleteSplit.isError ? (
                    <div className="notice notice--danger" role="alert">
                      {t("split.deleteError")}
                    </div>
                  ) : null}

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={deleteSplit.isPending}
                      onClick={closeSplitDeleteDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="danger-button"
                      disabled={deleteSplit.isPending}
                      onClick={handleSplitDeleteConfirm}
                      type="button"
                    >
                      {deleteSplit.isPending ? (
                        <Loader2 aria-hidden="true" className="spin" size={17} />
                      ) : (
                        <Trash2 aria-hidden="true" size={17} />
                      )}
                      <span>{t("projects.delete")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {editingDataset ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="dataset-edit-title"
                aria-modal="true"
                className="modal-panel"
                role="dialog"
              >
                <form className="modal-form" onSubmit={handleDatasetEditSubmit}>
                  <div className="panel__header">
                    <div>
                      <h2 id="dataset-edit-title">{editingDataset.name}</h2>
                    </div>
                    <button
                      aria-label={t("dataset.closeEdit")}
                      className="icon-button"
                      disabled={updateDataset.isPending}
                      onClick={closeDatasetEditDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <label className="field">
                    <span>{t("form.name")}</span>
                    <input
                      autoFocus
                      onChange={(event) => setDatasetEditName(event.target.value)}
                      required
                      type="text"
                      value={datasetEditName}
                    />
                  </label>

                  {updateDataset.isError ? (
                    <div className="notice notice--danger" role="alert">
                      {t("dataset.updateError")}
                    </div>
                  ) : null}

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={updateDataset.isPending}
                      onClick={closeDatasetEditDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={!datasetEditName.trim() || updateDataset.isPending}
                      type="submit"
                    >
                      {updateDataset.isPending ? (
                        <Loader2 aria-hidden="true" className="spin" size={17} />
                      ) : (
                        <Pencil aria-hidden="true" size={17} />
                      )}
                      <span>{t("dataset.update")}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {deletingDataset ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="dataset-delete-title"
                aria-modal="true"
                className="modal-panel"
                role="dialog"
              >
                <div className="modal-form">
                  <div className="panel__header">
                    <div>
                      <h2 id="dataset-delete-title">
                        {t("dataset.deleteConfirm", { name: deletingDataset.name })}
                      </h2>
                    </div>
                    <button
                      aria-label={t("dataset.closeDelete")}
                      className="icon-button"
                      disabled={deleteDataset.isPending}
                      onClick={closeDatasetDeleteDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <div className="notice notice--warning">
                    {t("dataset.deleteWarning")}
                  </div>

                  {deleteDataset.isError ? (
                    <div className="notice notice--danger" role="alert">
                      {t("dataset.deleteError")}
                    </div>
                  ) : null}

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={deleteDataset.isPending}
                      onClick={closeDatasetDeleteDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
                    <button
                      className="danger-button"
                      disabled={deleteDataset.isPending}
                      onClick={handleDatasetDeleteConfirm}
                      type="button"
                    >
                      {deleteDataset.isPending ? (
                        <Loader2 aria-hidden="true" className="spin" size={17} />
                      ) : (
                        <Trash2 aria-hidden="true" size={17} />
                      )}
                      <span>{t("projects.delete")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "training" ? (
        <section
          aria-labelledby="training-tab"
          className="training-workspace"
          id="training-panel"
          role="tabpanel"
        >
          <div className="training-layout">
          <div className="training-sidebar">
            <div className="panel training-target-panel">
              <div className="panel__header">
                <div>
                  <h2>{t("training.targetSplit")}</h2>
                </div>
                <div className="panel__actions">
                  {trainingSplitQueries.some((query) => query.isFetching) ? (
                    <Loader2 aria-hidden="true" className="spin" size={18} />
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={!selectedTrainingSplitOption}
                    onClick={openTrainingDrawer}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={17} />
                    <span>{t("training.new")}</span>
                  </button>
                </div>
              </div>

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
              {trainingSplitOptions.length > 0 ? (
                <div className="training-split-list">
                  {trainingSplitOptions.map((option) => (
                    <button
                      className="training-split-option"
                      data-selected={trainingSplitId === option.split.id ? "true" : undefined}
                      key={option.split.id}
                      onClick={() => selectTrainingSplit(option.datasetId, option.split.id)}
                      type="button"
                    >
                      <span>
                        <strong>
                          {option.datasetName} / {option.split.name}
                        </strong>
                        <small>
                          Train {splitPercent(option.split.train_ratio)} · Val{" "}
                          {splitPercent(option.split.val_ratio)} · Test{" "}
                          {splitPercent(option.split.test_ratio)}
                        </small>
                      </span>
                      <span className="split-row__counts">
                        {formatCount(option.split.train_count, language)} /{" "}
                        {formatCount(option.split.val_count, language)} /{" "}
                        {formatCount(option.split.test_count, language)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {trainingDrawerOpen ? (
              <div className="modal-backdrop" role="presentation">
                <aside
                  aria-labelledby="training-create-title"
                  aria-modal="true"
                  className="training-modal"
                  role="dialog"
                >
                  <form className="form-panel training-form training-form--modal" onSubmit={handleTrainingSubmit}>
              <div className="panel__header training-modal__header">
                <div>
                  <h2 id="training-create-title">{t("training.new")}</h2>
                </div>
                <button
                  aria-label={t("projects.cancel")}
                  className="icon-button"
                  disabled={createTrainingRun.isPending || runTrainingPreflight.isPending}
                  onClick={closeTrainingDrawer}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
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

              {selectedTrainingSplitOption ? (
                <div className="training-target-summary">
                  <span>{t("training.targetSplit")}</span>
                  <strong>
                    {selectedTrainingSplitOption.datasetName} /{" "}
                    {selectedTrainingSplitOption.split.name}
                  </strong>
                  <small>
                    Train {splitPercent(selectedTrainingSplitOption.split.train_ratio)} · Val{" "}
                    {splitPercent(selectedTrainingSplitOption.split.val_ratio)} · Test{" "}
                    {splitPercent(selectedTrainingSplitOption.split.test_ratio)}
                  </small>
                </div>
              ) : null}

              <label className="field">
                <FieldLabel
                  help={t("training.help.hyperparameterPreset")}
                  label={t("training.hyperparameterPreset")}
                />
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
                <FieldLabel help={t("training.help.modelPreset")} label={t("training.modelPreset")} />
                <select
                  aria-label={t("training.modelPreset")}
                  onChange={(event) => {
                    applyTrainingModel(event.target.value);
                  }}
                  value={trainingModelName}
                >
                  {trainingModelGroups.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div className="field-row field-row--two">
                <label className="field">
                  <FieldLabel help={t("training.help.epochs")} label="epochs" />
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
                  <FieldLabel help={t("training.help.batch")} label="batch" />
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
                  <FieldLabel help={t("training.help.imgsz")} label="imgsz" />
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
                  <FieldLabel help={t("training.help.learningRate")} label="learning rate" />
                  <input
                    min={0.000001}
                    onChange={(event) =>
                      updateTrainingNumberConfig("learning_rate", event.target.valueAsNumber)
                    }
                    step="any"
                    type="number"
                    value={trainingConfig.learning_rate}
                  />
                </label>
                <label className="field">
                  <FieldLabel help={t("training.help.device")} label="device" />
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

              <details
                className="advanced-settings"
                onToggle={(event) => setAdvancedTrainingOpen(event.currentTarget.open)}
                open={advancedTrainingOpen}
              >
                <summary>{t("training.advancedHyperparameters")}</summary>
                <div className="field-row field-row--two">
                  <label className="field">
                    <FieldLabel help={t("training.help.optimizer")} label="optimizer" />
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
                    <FieldLabel help={t("training.help.patience")} label="patience" />
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
                    <FieldLabel help={t("training.help.lrf")} label="lrf" />
                    <input
                      min={0.000001}
                      onChange={(event) => updateTrainingNumberConfig("lrf", event.target.valueAsNumber)}
                      step="any"
                      type="number"
                      value={trainingConfig.lrf}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.momentum")} label="momentum" />
                    <input
                      min={0.000001}
                      onChange={(event) => updateTrainingNumberConfig("momentum", event.target.valueAsNumber)}
                      step="any"
                      type="number"
                      value={trainingConfig.momentum}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.weightDecay")} label="weight decay" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("weight_decay", event.target.valueAsNumber)}
                      step={0.0001}
                      type="number"
                      value={trainingConfig.weight_decay}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.warmupEpochs")} label="warmup epochs" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("warmup_epochs", event.target.valueAsNumber)}
                      step={0.5}
                      type="number"
                      value={trainingConfig.warmup_epochs}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.closeMosaic")} label="close mosaic" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("close_mosaic", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.close_mosaic}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.workers")} label="workers" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("workers", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.workers}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.seed")} label="seed" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("seed", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.seed}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.freeze")} label="freeze" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("freeze", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.freeze}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.dropout")} label="dropout" />
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
                    <FieldLabel help={t("training.help.mosaic")} label="mosaic" />
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
                    <FieldLabel help={t("training.help.mixup")} label="mixup" />
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
                    <FieldLabel help={t("training.help.degrees")} label="degrees" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("degrees", event.target.valueAsNumber)}
                      step={1}
                      type="number"
                      value={trainingConfig.degrees}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.translate")} label="translate" />
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
                    <FieldLabel help={t("training.help.scale")} label="scale" />
                    <input
                      min={0}
                      onChange={(event) => updateTrainingNumberConfig("scale", event.target.valueAsNumber)}
                      step={0.05}
                      type="number"
                      value={trainingConfig.scale}
                    />
                  </label>
                  <label className="field">
                    <FieldLabel help={t("training.help.fliplr")} label="fliplr" />
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
                    <FieldLabel help={t("training.help.cosLr")} label="cos lr" />
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.cache}
                      onChange={(event) => updateTrainingBooleanConfig("cache", event.target.checked)}
                      type="checkbox"
                    />
                    <FieldLabel help={t("training.help.cache")} label="cache" />
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.deterministic}
                      onChange={(event) => updateTrainingBooleanConfig("deterministic", event.target.checked)}
                      type="checkbox"
                    />
                    <FieldLabel help={t("training.help.deterministic")} label="deterministic" />
                  </label>
                  <label className="toggle-field">
                    <input
                      checked={trainingConfig.amp}
                      onChange={(event) => updateTrainingBooleanConfig("amp", event.target.checked)}
                      type="checkbox"
                    />
                    <FieldLabel help={t("training.help.amp")} label="amp" />
                  </label>
                </div>
              </details>

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
              {trainingCommandPreview ? (
                <div className="command-preview">
                  <div>
                    <strong>{t("training.commandPreview")}</strong>
                    <small>{t("training.commandPreviewHelp")}</small>
                  </div>
                  <pre><code>{trainingCommandPreview.shell}</code></pre>
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
                <span>{t(canStartAfterCommandPreview ? "training.start" : "training.previewCommand")}</span>
              </button>
                  </form>
                </aside>
              </div>
            ) : null}
          </div>

          <div className="panel training-terminal-panel">
            <div className="panel__header">
              <div>
                <div className="training-terminal-title">
                  <h2>{t("training.liveTerminal")}</h2>
                  {selectedTrainingRun ? <span>{selectedTrainingRun.name}</span> : null}
                </div>
              </div>
              {selectedTrainingRun ? (
                <div className="panel__actions">
                  <StatusBadge status={selectedTrainingRun.status} />
                  <button
                    className="secondary-button"
                    onClick={() => setTrainingResultRunId(selectedTrainingRun.id)}
                    type="button"
                  >
                    {t("training.viewResults")}
                  </button>
                </div>
              ) : null}
            </div>
            {selectedTrainingRun ? (
              <LogViewer projectId={projectId} runId={selectedTrainingRun.id} status={selectedTrainingRun.status} />
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("training.noRunSelected")}</p>
              </div>
            )}
          </div>
          </div>
        </section>
      ) : null}
      {trainingResultRunId ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="training-results-title"
            aria-modal="true"
            className="modal-panel modal-panel--wide"
            role="dialog"
          >
            <div className="panel__header">
              <div>
                <h2 id="training-results-title">{t("training.results")}</h2>
              </div>
              <button
                aria-label={t("projects.cancel")}
                className="icon-button"
                onClick={() => setTrainingResultRunId(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <TrainingRunPage
              initialRun={trainingRuns.find((run) => run.id === trainingResultRunId) ?? null}
              projectId={projectId}
              runId={trainingResultRunId}
            />
          </div>
        </div>
      ) : null}
      {activeTab === "inference" ? (
        <section
          aria-labelledby="inference-tab"
          className="inference-grid"
          id="inference-panel"
          role="tabpanel"
        >
          <div className="panel panel--wide">
            <div className="panel__header">
              <div>
                <h2>{t("inference.runs")}</h2>
              </div>
              {inferenceRunsQuery.isFetching ? (
                <Loader2 aria-hidden="true" className="spin" size={18} />
              ) : null}
              <button className="primary-button" onClick={openInferenceDialog} type="button">
                <Plus aria-hidden="true" size={17} />
                <span>{t("inference.new")}</span>
              </button>
            </div>
            {inferenceRuns.length > 0 ? (
              <div className="inference-run-list">
                {inferenceRuns.map((run, index) => {
                  const predictions = inferencePredictionsByRunId.get(run.id) ?? [];
                  const thumbnailPrediction = predictions.find((prediction) =>
                    Boolean(prediction.output_image_path),
                  );
                  const isExpanded = expandedInferenceRunId === run.id;
                  const predictionQuery = inferencePredictionQueries[index];
                  return (
                    <article className="inference-run-row" key={run.id}>
                      <div className="inference-run-summary">
                        <div className="inference-run-thumbnail">
                          {thumbnailPrediction ? (
                            <img
                              alt={t("inference.resultAlt", {
                                name: fileName(thumbnailPrediction.image_path),
                              })}
                              src={predictionImageUrl(projectId, run.id, thumbnailPrediction)}
                            />
                          ) : (
                            <div className="inference-run-thumbnail__empty">
                              {t("inference.noThumbnail")}
                            </div>
                          )}
                        </div>
                        <div className="inference-run-main">
                          <div className="inference-run-title">
                            <strong>{run.name}</strong>
                            <StatusBadge status={run.status} />
                          </div>
                          <div className="inference-run-meta">
                            <span>{inferenceInputTypeLabel(run)}</span>
                            <span>{inferenceInputSummary(run)}</span>
                            {run.input_type === "folder" ? (
                              <span>
                                {t("inference.imageCount", {
                                  count: formatCount(inferenceFolderImageCount(run), language),
                                })}
                              </span>
                            ) : null}
                          </div>
                          <code title={run.id}>{shortInternalId(run.id)}</code>
                        </div>
                      </div>
                      <div className="inference-run-actions">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            setExpandedInferenceRunId((currentId) =>
                              currentId === run.id ? null : run.id,
                            )
                          }
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronUp aria-hidden="true" size={16} />
                          ) : (
                            <ChevronDown aria-hidden="true" size={16} />
                          )}
                          <span>{t(isExpanded ? "inference.collapse" : "inference.details")}</span>
                        </button>
                        <span className="inference-run-menu">
                          <button
                            aria-expanded={inferenceRunMenuId === run.id}
                            aria-label={t("inference.actions", { name: run.name })}
                            className="dataset-row__menu-button"
                            onClick={() =>
                              setInferenceRunMenuId((currentId) =>
                                currentId === run.id ? null : run.id,
                              )
                            }
                            type="button"
                          >
                            <MoreVertical aria-hidden="true" size={18} />
                          </button>
                          {inferenceRunMenuId === run.id ? (
                            <span className="dataset-row__menu-popover">
                              <LocalPathActions path={run.output_path} t={t} variant="menu" />
                              <button
                                aria-label={t("inference.deleteRun", { name: run.name })}
                                disabled={deleteInferenceRun.isPending}
                                onClick={() => {
                                  setInferenceRunMenuId(null);
                                  deleteInferenceRun.mutate(run);
                                }}
                                type="button"
                              >
                                <Trash2 aria-hidden="true" size={15} />
                                <span>{t("projects.delete")}</span>
                              </button>
                            </span>
                          ) : null}
                        </span>
                      </div>
                      {isExpanded ? (
                        <div className="inference-run-details">
                          {predictionQuery?.isFetching ? (
                            <Loader2 aria-hidden="true" className="spin" size={18} />
                          ) : null}

                          {run.status !== "completed" ? (
                            <div className="empty-state empty-state--compact">
                              <p>{t("inference.resultsPending")}</p>
                              <small>{t("inference.resultsPendingHelp")}</small>
                            </div>
                          ) : predictions.length > 0 ? (
                            <div className="prediction-grid prediction-grid--embedded">
                              {predictions.map((prediction) => {
                                const hasRenderedImage = Boolean(prediction.output_image_path);
                                const imageLabel = fileName(prediction.image_path);
                                const imageSrc = predictionImageUrl(projectId, run.id, prediction);
                                return (
                                  <article className="prediction-card" key={prediction.id}>
                                    {hasRenderedImage ? (
                                      <button
                                        aria-label={`${imageLabel} ${t("training.openReportImage")}`}
                                        className="prediction-card__image-button"
                                        onClick={() =>
                                          setSelectedPredictionImage({
                                            label: imageLabel,
                                            src: imageSrc,
                                          })
                                        }
                                        type="button"
                                      >
                                        <img
                                          alt={t("inference.resultAlt", {
                                            name: imageLabel,
                                          })}
                                          src={imageSrc}
                                        />
                                      </button>
                                    ) : (
                                      <div className="prediction-card__missing">
                                        <p>{t("inference.noResultImage")}</p>
                                        <small>{t("inference.noResultImageHelp")}</small>
                                      </div>
                                    )}
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
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state empty-state--compact">
                <p>{t("inference.noRuns")}</p>
              </div>
            )}

            {deleteInferenceRun.isError ? (
              <div className="notice notice--danger" role="alert">
                {deleteInferenceRun.error instanceof Error
                  ? deleteInferenceRun.error.message
                  : t("inference.deleteError")}
              </div>
            ) : null}
          </div>

          {selectedPredictionImage ? (
            <div
              className="modal-backdrop training-image-modal-backdrop"
              onClick={() => setSelectedPredictionImage(null)}
              role="presentation"
            >
              <div
                aria-labelledby="inference-prediction-image-title"
                aria-modal="true"
                className="training-image-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="training-image-modal__header">
                  <h2 id="inference-prediction-image-title">{selectedPredictionImage.label}</h2>
                  <button
                    aria-label={t("common.close")}
                    className="icon-button"
                    onClick={() => setSelectedPredictionImage(null)}
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
                <img alt={selectedPredictionImage.label} src={selectedPredictionImage.src} />
              </div>
            </div>
          ) : null}

          {inferenceDialogOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div
                aria-labelledby="inference-create-title"
                aria-modal="true"
                className="modal-panel modal-panel--wide"
                role="dialog"
              >
                <form className="modal-form" onSubmit={handleInferenceSubmit}>
                  <div className="panel__header">
                    <div>
                      <h2 id="inference-create-title">{t("inference.new")}</h2>
                    </div>
                    <button
                      aria-label={t("inference.closeCreate")}
                      className="icon-button"
                      onClick={closeInferenceDialog}
                      type="button"
                    >
                      <X aria-hidden="true" size={17} />
                    </button>
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
                      inferenceInputType === "folder"
                        ? t("inference.folderSelect")
                        : t("inference.imageSelect")
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
                      <FieldLabel help={t("inference.help.conf")} label="conf" />
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
                      <FieldLabel help={t("inference.help.imgsz")} label="imgsz" />
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

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      disabled={createInferenceRun.isPending}
                      onClick={closeInferenceDialog}
                      type="button"
                    >
                      {t("projects.cancel")}
                    </button>
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
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
