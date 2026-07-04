import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type Language = "ko" | "en";
export type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

const STORAGE_KEY = "visionops-language";

const translations: Record<Language, Record<string, string>> = {
  en: {
    "app.workspace": "VisionOps workspace",
    "api.error": "API request failed ({status}): {message}",
    "detail.datasets": "Datasets",
    "detail.inference": "Inference",
    "detail.training": "Training",
    "dataset.classList": "Class list",
    "dataset.classes": "Classes",
    "dataset.closeUpload": "Close dataset upload",
    "dataset.createSplit": "Create split",
    "dataset.dataset": "Dataset",
    "dataset.datasetCount": "{count} datasets",
    "dataset.empty": "No datasets",
    "dataset.errorsCount": "{count} errors",
    "dataset.imageFolder": "Image folder",
    "dataset.imageFolderDescription": "Select an image folder from Finder or File Explorer, or drop it here",
    "dataset.imageFolderSelect": "Select image folder",
    "dataset.images": "Images",
    "dataset.labelFolder": "Label folder",
    "dataset.labelFolderDescription": "Select a YOLO txt label folder, or drop it here",
    "dataset.labelFolderSelect": "Select label folder",
    "dataset.labels": "Labels",
    "dataset.list": "Registered list",
    "dataset.loadError": "Failed to load datasets.",
    "dataset.loading": "Loading datasets.",
    "dataset.namePlaceholder": "Defect samples July",
    "dataset.noDatasetSelected": "No dataset selected",
    "dataset.register": "Register",
    "dataset.registered": "Registered datasets",
    "dataset.selected": "Selected dataset",
    "dataset.upload": "Data upload",
    "dataset.uploadError": "Failed to register dataset.",
    "dataset.validation": "Validation",
    "dataset.validationStatus": "Validation status",
    "dataset.valid": "Valid",
    "dataset.waiting": "Pending",
    "dataset.warningsCount": "{count} warnings",
    "dataset.yamlDescription": "data.yaml file containing class names",
    "form.name": "Name",
    "inference.availableModelEmpty": "No available models",
    "inference.availableModelHelp": "A best/last artifact from completed training is required.",
    "inference.createError": "Failed to create inference run.",
    "inference.folder": "Folder",
    "inference.folderDescription": "Select an image folder or drop it here",
    "inference.folderSelect": "Select inference image folder",
    "inference.image": "Single image",
    "inference.imageDescription": "Select a single image or drop it here",
    "inference.imageSelect": "Select inference image",
    "inference.input": "Input",
    "inference.inputType": "Input type",
    "inference.inputTypeLabel": "Inference input type",
    "inference.model": "Training model",
    "inference.namePlaceholder": "Inspection image inference",
    "inference.noResultImage": "No result image",
    "inference.noResultImageHelp": "The result image is still processing or the input image cannot be found.",
    "inference.noRuns": "No inference runs",
    "inference.objectCount": "{count} objects · max confidence {confidence}",
    "inference.predictions": "Predictions",
    "inference.resultAlt": "{name} inference result",
    "inference.results": "Inference results",
    "inference.resultsPending": "Waiting for results",
    "inference.resultsPendingHelp": "Images with predicted boxes will appear after inference completes.",
    "inference.run": "Inference run",
    "inference.runs": "Inference runs",
    "inference.start": "Start inference",
    "runtime.available": "Available",
    "runtime.checking": "Checking training environment.",
    "runtime.installAction": "Install {label}",
    "runtime.installError": "Failed to start runtime installation.",
    "runtime.installed": "Installed",
    "runtime.missing": "Not installed",
    "runtime.notTrainable": "Training unavailable",
    "runtime.trainable": "Training available",
    "runtime.trainingEnvironment": "Training environment",
    "split.createError": "Failed to create split.",
    "split.empty": "No splits",
    "split.list": "List",
    "split.nameDefault": "default split",
    "split.validationRatioBounds": "Train and Val ratios must be between 0 and 1.",
    "split.validationRatioSum": "Train and Val ratios must add up to 1.0.",
    "split.validationSeed": "Seed must be a number greater than or equal to 0.",
    "upload.none": "None selected",
    "upload.selectedCount": "{count} selected",
    "header.noNotifications": "No notifications.",
    "header.notifications": "Notifications",
    "header.search": "Search",
    "header.searchSoon": "Search will be connected when project data is available.",
    "header.settings": "Settings",
    "language.en": "English",
    "language.ko": "Korean",
    "language.select": "Language selection",
    "nav.projects": "Projects",
    "project.detailFallback": "Project detail",
    "projects.columnName": "Name",
    "projects.columnStatus": "Status",
    "projects.columnUpdated": "Updated",
    "projects.cancel": "Cancel",
    "projects.actions": "{name} project actions",
    "projects.closeCreate": "Close project creation",
    "projects.closeDelete": "Close project deletion",
    "projects.closeEdit": "Close project editing",
    "projects.create": "Create",
    "projects.createError": "Failed to create project.",
    "projects.delete": "Delete",
    "projects.deleteConfirm": "Delete {name}?",
    "projects.deleteError": "Failed to delete project.",
    "projects.deleteWarning": "All datasets, splits, training runs, inference runs, artifacts, and managed local files for this project will be deleted.",
    "projects.description": "Description",
    "projects.descriptionPlaceholder": "Line defect detection",
    "projects.detection": "Detection",
    "projects.empty": "No projects",
    "projects.filterAll": "All",
    "projects.loading": "Loading",
    "projects.loadError": "Failed to load projects.",
    "projects.name": "Name",
    "projects.namePlaceholder": "Inspection line A",
    "projects.new": "New project",
    "projects.open": "Open {name} project",
    "projects.rename": "Rename",
    "projects.table": "Projects",
    "projects.update": "Save changes",
    "projects.updateError": "Failed to update project.",
    "status.completed": "Completed",
    "status.failed": "Failed",
    "status.invalid": "Invalid",
    "status.pending": "Pending",
    "status.queued": "Queued",
    "status.ready": "Ready",
    "status.running": "Running",
    "status.skipped": "Skipped",
    "status.unknown": "Unknown",
    "status.valid": "Valid",
    "log.title": "Logs",
    "log.tailError": "Failed to load log tail. VisionOps will retry when the run status changes.",
    "log.loading": "Loading logs.",
    "log.empty": "No logs",
    "log.saved": "Saved logs",
    "log.connected": "Live connected",
    "log.unavailable": "Live unavailable",
    "log.ready": "Live ready",
    "metrics.empty": "No metric data to display.",
    "training.created": "Created",
    "training.detail": "Training run detail",
    "training.emptyConfig": "No saved config.",
    "training.emptyLoss": "No loss metrics yet.",
    "training.emptyQuality": "No quality metrics yet.",
    "training.elapsed": "Runtime",
    "training.finished": "Finished",
    "training.modelFiles": "Model files",
    "training.modelFilesEmpty": "No model files",
    "training.noRunSelected": "No training run selected.",
    "training.qualityMetrics": "Quality metrics",
    "training.run": "Training run",
    "training.started": "Started",
    "training.summaryMetrics": "Summary metrics",
    "training.timeline": "Timeline",
    "training.modelKind": "Kind",
    "training.modelPath": "Path",
    "training.create": "Create",
    "training.createError": "Failed to create training run.",
    "training.datasetRequired": "Register training data in the Datasets tab first.",
    "training.advancedHyperparameters": "Advanced hyperparameters",
    "training.filter": "Training status filter",
    "training.hyperparameterPreset": "Hyperparameter preset",
    "training.list": "Run list",
    "training.listEmpty": "No training runs",
    "training.listLoadError": "Failed to load training runs.",
    "training.listLoading": "Loading training runs.",
    "training.modelPreset": "Model preset",
    "training.namePlaceholder": "Line A baseline model",
    "training.nameRequired": "Enter a training run name.",
    "training.new": "New training run",
    "training.preflightIssues": "Pre-training check required",
    "training.preflightWarnings": "Pre-training warnings",
    "training.presetAccuracy": "High accuracy",
    "training.presetBalanced": "Balanced",
    "training.presetCpu": "CPU safe",
    "training.presetFast": "Fast test",
    "training.splitRequired": "Select a split for training.",
    "training.splitRequiredHelp": "Create a split for training first.",
    "training.start": "Start training",
    "training.validationAdvanced": "Check advanced hyperparameter values.",
    "training.validationBatch": "batch must be an integer greater than or equal to 1.",
    "training.validationDevice": "Enter a device.",
    "training.validationEpochs": "epochs must be an integer greater than or equal to 1.",
    "training.validationImageSize": "image size must be an integer greater than or equal to 1.",
    "training.validationLearningRate": "learning rate must be positive.",
    "training.validationOptimizer": "Enter an optimizer.",
    "training.validationPatience": "patience must be an integer greater than or equal to 1.",
    "settings.language": "Language",
    "settings.theme": "Theme",
    "theme.dark": "Dark",
    "theme.light": "Light",
    "theme.select": "Theme selection",
    "theme.system": "System",
    "theme.title": "{label} theme",
  },
  ko: {
    "app.workspace": "VisionOps 작업 영역",
    "api.error": "API 요청 실패 ({status}): {message}",
    "detail.datasets": "데이터셋",
    "detail.inference": "추론",
    "detail.training": "학습",
    "dataset.classList": "클래스 목록",
    "dataset.classes": "클래스",
    "dataset.closeUpload": "데이터셋 업로드 닫기",
    "dataset.createSplit": "Split 생성",
    "dataset.dataset": "데이터셋",
    "dataset.datasetCount": "{count}개",
    "dataset.empty": "데이터셋 없음",
    "dataset.errorsCount": "오류 {count}건",
    "dataset.imageFolder": "이미지 폴더",
    "dataset.imageFolderDescription": "Finder나 파일탐색기에서 이미지 폴더를 선택하거나 드롭",
    "dataset.imageFolderSelect": "이미지 폴더 선택",
    "dataset.images": "이미지",
    "dataset.labelFolder": "라벨 폴더",
    "dataset.labelFolderDescription": "YOLO txt 라벨 폴더를 선택하거나 드롭",
    "dataset.labelFolderSelect": "라벨 폴더 선택",
    "dataset.labels": "라벨",
    "dataset.list": "등록 목록",
    "dataset.loadError": "데이터셋을 불러오지 못했습니다.",
    "dataset.loading": "데이터셋을 불러오는 중입니다.",
    "dataset.namePlaceholder": "불량 샘플 7월",
    "dataset.noDatasetSelected": "데이터셋 미선택",
    "dataset.register": "등록",
    "dataset.registered": "데이터셋 등록",
    "dataset.selected": "선택 데이터셋",
    "dataset.upload": "데이터 업로드",
    "dataset.uploadError": "데이터셋 등록에 실패했습니다.",
    "dataset.validation": "검증",
    "dataset.validationStatus": "검증 상태",
    "dataset.valid": "유효",
    "dataset.waiting": "대기",
    "dataset.warningsCount": "경고 {count}건",
    "dataset.yamlDescription": "클래스 names가 들어 있는 data.yaml 파일",
    "form.name": "이름",
    "inference.availableModelEmpty": "사용 가능한 모델 없음",
    "inference.availableModelHelp": "완료된 학습의 best/last 산출물이 필요합니다.",
    "inference.createError": "추론 실행 생성에 실패했습니다.",
    "inference.folder": "폴더",
    "inference.folderDescription": "이미지 폴더를 선택하거나 여기에 드롭",
    "inference.folderSelect": "추론 이미지 폴더 선택",
    "inference.image": "단일 이미지",
    "inference.imageDescription": "단일 이미지를 선택하거나 여기에 드롭",
    "inference.imageSelect": "추론 이미지 선택",
    "inference.input": "입력",
    "inference.inputType": "입력 유형",
    "inference.inputTypeLabel": "추론 입력 유형",
    "inference.model": "학습 모델",
    "inference.namePlaceholder": "검수 이미지 추론",
    "inference.noResultImage": "결과 이미지 없음",
    "inference.noResultImageHelp": "결과 이미지가 아직 처리 중이거나 입력 이미지를 찾을 수 없습니다.",
    "inference.noRuns": "추론 실행 없음",
    "inference.objectCount": "{count}개 객체 · 최고 신뢰도 {confidence}",
    "inference.predictions": "Predictions",
    "inference.resultAlt": "{name} 추론 결과",
    "inference.results": "추론 결과",
    "inference.resultsPending": "결과 대기 중",
    "inference.resultsPendingHelp": "추론이 완료되면 bbox가 그려진 이미지가 표시됩니다.",
    "inference.run": "추론 실행",
    "inference.runs": "추론 실행 목록",
    "inference.start": "추론 시작",
    "runtime.available": "사용 가능",
    "runtime.checking": "학습 환경을 확인하는 중입니다.",
    "runtime.installAction": "{label} 설치",
    "runtime.installError": "런타임 설치를 시작하지 못했습니다.",
    "runtime.installed": "설치됨",
    "runtime.missing": "미설치",
    "runtime.notTrainable": "현재 학습 불가능",
    "runtime.trainable": "현재 학습 가능",
    "runtime.trainingEnvironment": "학습 환경",
    "split.createError": "Split 생성에 실패했습니다.",
    "split.empty": "Split 없음",
    "split.list": "목록",
    "split.nameDefault": "기본 split",
    "split.validationRatioBounds": "Train과 Val 비율은 0과 1 사이여야 합니다.",
    "split.validationRatioSum": "Train과 Val 비율의 합은 1.0이어야 합니다.",
    "split.validationSeed": "Seed는 0 이상의 숫자여야 합니다.",
    "upload.none": "선택 없음",
    "upload.selectedCount": "{count}개 선택됨",
    "header.noNotifications": "알림이 없습니다.",
    "header.notifications": "알림",
    "header.search": "검색",
    "header.searchSoon": "검색은 프로젝트 데이터가 쌓이면 연결됩니다.",
    "header.settings": "설정",
    "language.en": "English",
    "language.ko": "한국어",
    "language.select": "언어 선택",
    "nav.projects": "프로젝트",
    "project.detailFallback": "프로젝트 상세",
    "projects.columnName": "이름",
    "projects.columnStatus": "상태",
    "projects.columnUpdated": "업데이트",
    "projects.cancel": "취소",
    "projects.actions": "{name} 프로젝트 작업",
    "projects.closeCreate": "프로젝트 생성 닫기",
    "projects.closeDelete": "프로젝트 삭제 닫기",
    "projects.closeEdit": "프로젝트 편집 닫기",
    "projects.create": "생성",
    "projects.createError": "프로젝트 생성에 실패했습니다.",
    "projects.delete": "삭제",
    "projects.deleteConfirm": "{name} 프로젝트를 삭제할까요?",
    "projects.deleteError": "프로젝트 삭제에 실패했습니다.",
    "projects.deleteWarning": "이 프로젝트의 데이터셋, 스플릿, 학습 실행, 추론 실행, 산출물, 관리 중인 로컬 파일이 모두 삭제됩니다.",
    "projects.description": "설명",
    "projects.descriptionPlaceholder": "라인 결함 탐지",
    "projects.detection": "탐지",
    "projects.empty": "프로젝트 없음",
    "projects.filterAll": "전체",
    "projects.loading": "불러오는 중",
    "projects.loadError": "프로젝트를 불러오지 못했습니다.",
    "projects.name": "이름",
    "projects.namePlaceholder": "검수 라인 A",
    "projects.new": "새 프로젝트",
    "projects.open": "{name} 프로젝트 열기",
    "projects.rename": "이름 변경",
    "projects.table": "프로젝트",
    "projects.update": "변경 저장",
    "projects.updateError": "프로젝트 수정에 실패했습니다.",
    "status.completed": "완료",
    "status.failed": "실패",
    "status.invalid": "유효하지 않음",
    "status.pending": "대기",
    "status.queued": "대기열",
    "status.ready": "준비됨",
    "status.running": "실행 중",
    "status.skipped": "건너뜀",
    "status.unknown": "알 수 없음",
    "status.valid": "유효",
    "log.title": "로그",
    "log.tailError": "로그 tail을 불러오지 못했습니다. 실행 상태가 바뀌면 다시 시도됩니다.",
    "log.loading": "로그를 불러오는 중입니다.",
    "log.empty": "로그 없음",
    "log.saved": "저장된 로그",
    "log.connected": "실시간 연결",
    "log.unavailable": "실시간 연결 불가",
    "log.ready": "실시간 준비",
    "metrics.empty": "표시할 지표 데이터가 없습니다.",
    "training.created": "생성",
    "training.detail": "학습 실행 상세",
    "training.emptyConfig": "저장된 설정이 없습니다.",
    "training.emptyLoss": "loss 지표가 아직 없습니다.",
    "training.emptyQuality": "품질 지표가 아직 없습니다.",
    "training.elapsed": "실행 시간",
    "training.finished": "종료",
    "training.modelFiles": "모델 파일",
    "training.modelFilesEmpty": "모델 파일 없음",
    "training.noRunSelected": "선택된 학습 실행이 없습니다.",
    "training.qualityMetrics": "품질 지표",
    "training.run": "학습 실행",
    "training.started": "시작",
    "training.summaryMetrics": "요약 지표",
    "training.timeline": "타임라인",
    "training.modelKind": "종류",
    "training.modelPath": "경로",
    "training.create": "생성",
    "training.createError": "학습 실행 생성에 실패했습니다.",
    "training.datasetRequired": "데이터셋 탭에서 먼저 학습 데이터를 등록하세요.",
    "training.advancedHyperparameters": "고급 하이퍼파라미터",
    "training.filter": "학습 상태 필터",
    "training.hyperparameterPreset": "하이퍼파라미터 preset",
    "training.list": "실행 목록",
    "training.listEmpty": "학습 실행 없음",
    "training.listLoadError": "학습 실행 목록을 불러오지 못했습니다.",
    "training.listLoading": "학습 실행을 불러오는 중입니다.",
    "training.modelPreset": "모델 preset",
    "training.namePlaceholder": "라인 A 기준 모델",
    "training.nameRequired": "학습 실행 이름을 입력하세요.",
    "training.new": "새 학습 실행",
    "training.preflightIssues": "학습 전 확인 필요",
    "training.preflightWarnings": "학습 전 경고",
    "training.presetAccuracy": "정확도 우선",
    "training.presetBalanced": "균형 기본값",
    "training.presetCpu": "CPU 안전",
    "training.presetFast": "빠른 테스트",
    "training.splitRequired": "학습에 사용할 Split을 선택하세요.",
    "training.splitRequiredHelp": "학습에 사용할 Split을 먼저 생성하세요.",
    "training.start": "학습 시작",
    "training.validationAdvanced": "고급 하이퍼파라미터 값을 확인하세요.",
    "training.validationBatch": "batch는 1 이상의 정수여야 합니다.",
    "training.validationDevice": "device를 입력하세요.",
    "training.validationEpochs": "epochs는 1 이상의 정수여야 합니다.",
    "training.validationImageSize": "image size는 1 이상의 정수여야 합니다.",
    "training.validationLearningRate": "learning rate는 양수여야 합니다.",
    "training.validationOptimizer": "optimizer를 입력하세요.",
    "training.validationPatience": "patience는 1 이상의 정수여야 합니다.",
    "settings.language": "언어",
    "settings.theme": "테마",
    "theme.dark": "어둡게",
    "theme.light": "밝게",
    "theme.select": "테마 선택",
    "theme.system": "시스템",
    "theme.title": "{label} 테마",
  },
};

function isLanguage(value: string | null): value is Language {
  return value === "ko" || value === "en";
}

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "ko";

  try {
    const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(storedLanguage) ? storedLanguage : "ko";
  } catch {
    return "ko";
  }
}

type TranslationParams = Record<string, string | number>;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslationParams) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

type LanguageProviderProps = {
  children: ReactNode;
};

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguage] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Language selection remains usable even when storage is unavailable.
    }
  }, [language]);

  const contextValue = useMemo<LanguageContextValue>(() => {
    function translate(key: string, params?: TranslationParams) {
      let text = translations[language][key] ?? translations.ko[key] ?? key;
      if (!params) return text;

      for (const [paramKey, value] of Object.entries(params)) {
        text = text.split(`{${paramKey}}`).join(String(value));
      }
      return text;
    }

    return { language, setLanguage, t: translate };
  }, [language]);

  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}

export function LanguageControl() {
  const { language, setLanguage, t } = useLanguage();
  const languageChoices: Array<{ value: Language; label: string }> = [
    { value: "ko", label: t("language.ko") },
    { value: "en", label: t("language.en") },
  ];

  return (
    <div className="theme-control language-control" aria-label={t("language.select")}>
      {languageChoices.map(({ value, label }) => (
        <button
          aria-pressed={language === value}
          className="theme-control__button"
          key={value}
          onClick={() => setLanguage(value)}
          type="button"
        >
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
