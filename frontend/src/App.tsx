import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";

import { FolderKanban, Loader2, Plus, X } from "lucide-react";

import { apiGet, apiPost } from "./api/client";
import { Layout, type AppNotification, type ProjectSort } from "./components/Layout";
import { TrainingQueueWidget, type WorkCompletionNotification } from "./components/TrainingQueueWidget";
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import type { Project, ProjectCreate, ProjectTaskType } from "./api/types";
import type { DetailTab } from "./pages/ProjectDetailPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TrainingManagementPage } from "./pages/TrainingManagementPage";
import { TrainingRunPage } from "./pages/TrainingRunPage";
import { ThemeProvider } from "./theme/ThemeProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

type AppHistoryState =
  | {
      projectId: null;
      section: "projects" | DetailTab | "training-management" | "settings-notifications";
      trainingRunId?: null;
    }
  | { projectId: string; section: DetailTab | "training-management"; trainingRunId?: string | null };

type AppSection = AppHistoryState["section"];
type ProjectScopedSection = Exclude<AppSection, "projects" | "settings-notifications">;

const projectSortStorageKey = "visionops-project-sort";
const hiddenProjectsStorageKey = "visionops-hidden-projects";

function readStorageValue(key: string): string | null {
  try {
    return typeof window.localStorage.getItem === "function"
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    if (typeof window.localStorage.setItem === "function") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be unavailable in restricted browser/test environments.
  }
}

const detailTabPaths: Record<DetailTab, string> = {
  datasets: "datasets",
  inference: "inference",
  training: "training",
};

const projectScopedPaths: Record<ProjectScopedSection, string> = {
  ...detailTabPaths,
  "training-management": "training-management",
};

const sectionsByPath = Object.fromEntries(
  Object.entries(projectScopedPaths).map(([section, path]) => [path, section]),
) as Record<string, ProjectScopedSection>;

function appPath(
  projectId: string | null,
  section: AppSection = "projects",
  trainingRunId: string | null = null,
  projects: Project[] = [],
): string {
  if (section === "projects") return "/";
  if (section === "settings-notifications") return "/settings/notifications";
  const projectSegment = projectId ? projectUrlSegment(projectId, projects) : null;
  if (projectId && section === "training-management" && trainingRunId) {
    return `/projects/${encodeURIComponent(projectSegment ?? projectId)}/${projectScopedPaths[section]}/${encodeURIComponent(
      trainingRunId,
    )}`;
  }
  return projectSegment
    ? `/projects/${encodeURIComponent(projectSegment)}/${projectScopedPaths[section]}`
    : `/${projectScopedPaths[section]}`;
}

function projectSlugFromName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "project";
}

function projectRouteSlug(project: Project): string {
  return project.slug || projectSlugFromName(project.name);
}

function projectMatchesRef(project: Project, projectRef: string): boolean {
  return project.id === projectRef || projectRouteSlug(project) === projectRef;
}

function projectIdFromRef(projectRef: string | null, projects: Project[]): string | null {
  if (!projectRef) return null;
  return projects.find((project) => projectMatchesRef(project, projectRef))?.id ?? null;
}

function projectUrlSegment(projectId: string, projects: Project[]): string {
  const project = projects.find((candidate) => candidate.id === projectId);
  return project ? projectRouteSlug(project) : projectId;
}

function stateFromLocation(): AppHistoryState {
  if (window.location.pathname === "/settings/notifications") {
    return { projectId: null, section: "settings-notifications" };
  }
  const match = window.location.pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (match) {
    const section = sectionsByPath[match[2] ?? "datasets"] ?? "datasets";
    return {
      projectId: decodeURIComponent(match[1]),
      section,
      trainingRunId:
        section === "training-management" && match[3] ? decodeURIComponent(match[3]) : null,
    };
  }
  const sectionMatch = window.location.pathname.match(
    /^\/(datasets|training|training-management|inference)$/,
  );
  if (sectionMatch) {
    return {
      projectId: null,
      section: sectionsByPath[sectionMatch[1]],
    };
  }
  return { projectId: null, section: "projects" };
}

function sectionTitleKey(section: AppSection): string {
  if (section === "projects") return "nav.projects";
  if (section === "settings-notifications") return "notificationSettings.nav";
  if (section === "training-management") return "trainingManagement.nav";
  return `detail.${section}`;
}

function isProjectScopedSection(section: AppSection): section is ProjectScopedSection {
  return section !== "projects" && section !== "settings-notifications";
}

function ProjectRequiredEmpty({
  onOpenProjects,
  section,
}: {
  onOpenProjects: () => void;
  section: ProjectScopedSection;
}) {
  const { t } = useLanguage();
  return (
    <section className="empty-state empty-state--page" aria-labelledby="project-required-title">
      <span className="empty-state__icon" aria-hidden="true">
        <FolderKanban size={34} />
      </span>
      <div>
        <h2 id="project-required-title">{t("project.requiredTitle")}</h2>
        <p>{t("project.requiredDescription", { section: t(sectionTitleKey(section)) })}</p>
      </div>
      <button className="primary-button" onClick={onOpenProjects} type="button">
        <FolderKanban aria-hidden="true" size={17} />
        <span>{t("project.selectProject")}</span>
      </button>
    </section>
  );
}

function AppContent() {
  const queryClient = useQueryClient();
  const initialHistoryState = stateFromLocation();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialHistoryState.projectId,
  );
  const [activeSection, setActiveSection] = useState<AppSection>(initialHistoryState.section);
  const [projectSort, setProjectSort] = useState<ProjectSort>(() => {
    const storedSort = readStorageValue(projectSortStorageKey);
    return storedSort === "name_asc" || storedSort === "updated_desc" ? storedSort : "updated_desc";
  });
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(readStorageValue(hiddenProjectsStorageKey) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [sidebarCreateDialogOpen, setSidebarCreateDialogOpen] = useState(false);
  const [sidebarProjectName, setSidebarProjectName] = useState("");
  const [sidebarProjectDescription, setSidebarProjectDescription] = useState("");
  const [sidebarProjectTaskType, setSidebarProjectTaskType] = useState<ProjectTaskType>("detection");
  const [notifications, setNotifications] = useState<WorkCompletionNotification[]>([]);
  const [focusedTrainingRunId, setFocusedTrainingRunId] = useState<string | null>(
    initialHistoryState.trainingRunId ?? null,
  );
  const [focusedInferenceRunId, setFocusedInferenceRunId] = useState<string | null>(null);
  const notificationSettingsReturnStateRef = useRef<AppHistoryState | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    window.history.replaceState(
      initialHistoryState,
      "",
      appPath(
        initialHistoryState.projectId,
        initialHistoryState.section,
        initialHistoryState.trainingRunId ?? null,
      ),
    );

    function handlePopState(event: PopStateEvent) {
      const nextState =
        event.state && typeof event.state === "object"
          ? (event.state as AppHistoryState)
          : stateFromLocation();
      setSelectedProjectId(nextState.projectId);
      setActiveSection(nextState.section);
      setFocusedTrainingRunId(nextState.trainingRunId ?? null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const projectsQuery = useQuery({
    queryFn: () => apiGet<Project[]>("/api/projects"),
    queryKey: ["projects"],
  });
  const projects = projectsQuery.data ?? [];
  const selectedProjectApiId = projectIdFromRef(selectedProjectId, projects);

  const selectedProjectQuery = useQuery({
    enabled: Boolean(selectedProjectApiId),
    queryFn: () => apiGet<Project>(`/api/projects/${selectedProjectApiId as string}`),
    queryKey: ["projects", selectedProjectApiId],
  });

  const createSidebarProject = useMutation({
    mutationFn: (body: ProjectCreate) => apiPost<Project>("/api/projects", body),
    onSuccess: (project) => {
      const nextSection: ProjectScopedSection = isProjectScopedSection(activeSection)
        ? activeSection
        : "datasets";
      const nextState: AppHistoryState = {
        projectId: project.id,
        section: nextSection,
      };
      setSidebarCreateDialogOpen(false);
      setSidebarProjectName("");
      setSidebarProjectDescription("");
      setSidebarProjectTaskType("detection");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      window.history.pushState(nextState, "", appPath(project.id, nextSection, null, [
        project,
        ...projects,
      ]));
      setSelectedProjectId(project.id);
      setActiveSection(nextSection);
      setFocusedTrainingRunId(null);
    },
  });

  useEffect(() => {
    writeStorageValue(projectSortStorageKey, projectSort);
  }, [projectSort]);

  useEffect(() => {
    writeStorageValue(hiddenProjectsStorageKey, JSON.stringify(hiddenProjectIds));
  }, [hiddenProjectIds]);

  useEffect(() => {
    if (!selectedProjectId || !selectedProjectApiId) return;
    if (activeSection === "projects") return;
    if (activeSection === "settings-notifications") return;
    if (selectedProjectId !== selectedProjectApiId) {
      setSelectedProjectId(selectedProjectApiId);
    }
    const canonicalPath = appPath(
      selectedProjectApiId,
      activeSection,
      focusedTrainingRunId,
      projects,
    );
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(
        {
          projectId: selectedProjectApiId,
          section: activeSection,
          trainingRunId: focusedTrainingRunId,
        } satisfies AppHistoryState,
        "",
        canonicalPath,
      );
    }
  }, [activeSection, focusedTrainingRunId, projects, selectedProjectApiId, selectedProjectId]);

  function handleSelectProject(projectId: string) {
    const nextState: AppHistoryState = {
      projectId,
      section: "datasets",
    };
    window.history.pushState(nextState, "", appPath(projectId, "datasets", null, projects));
    setSelectedProjectId(projectId);
    setActiveSection("datasets");
    setFocusedTrainingRunId(null);
    setFocusedInferenceRunId(null);
  }

  function handleSelectProjectInSidebar(projectId: string) {
    const nextSection: ProjectScopedSection = isProjectScopedSection(activeSection)
      ? activeSection
      : "datasets";
    const nextState: AppHistoryState = {
      projectId,
      section: nextSection,
      trainingRunId: null,
    };
    window.history.pushState(nextState, "", appPath(projectId, nextSection, null, projects));
    setSelectedProjectId(projectId);
    setActiveSection(nextSection);
    setFocusedTrainingRunId(null);
    setFocusedInferenceRunId(null);
  }

  function handleSectionChange(section: AppSection) {
    setFocusedTrainingRunId(null);
    setFocusedInferenceRunId(null);
    const currentProjectId = selectedProjectApiId ?? selectedProjectId;
    const nextState: AppHistoryState =
      section === "projects"
        ? { projectId: null, section: "projects" }
        : section === "settings-notifications"
          ? { projectId: null, section: "settings-notifications" }
        : currentProjectId
          ? { projectId: currentProjectId, section }
          : { projectId: null, section };
    window.history.pushState(nextState, "", appPath(nextState.projectId, section, null, projects));
    setSelectedProjectId(nextState.projectId);
    setActiveSection(section);
  }

  function handleToggleProjectHidden(projectId: string) {
    const willHide = !hiddenProjectIds.includes(projectId);
    setHiddenProjectIds((currentIds) =>
      currentIds.includes(projectId)
        ? currentIds.filter((id) => id !== projectId)
        : [...currentIds, projectId],
    );
    if (willHide && (selectedProjectApiId ?? selectedProjectId) === projectId && activeSection !== "projects") {
      const nextState = { projectId: null, section: activeSection } satisfies AppHistoryState;
      window.history.pushState(nextState, "", appPath(null, activeSection));
      setSelectedProjectId(null);
      setFocusedTrainingRunId(null);
      setFocusedInferenceRunId(null);
    }
  }

  function handleOpenProjects() {
    handleSectionChange("projects");
  }

  function currentHistoryState(): AppHistoryState {
    if (activeSection === "projects" || activeSection === "settings-notifications") {
      return { projectId: null, section: activeSection };
    }
    const currentProjectId = selectedProjectApiId ?? selectedProjectId;
    if (currentProjectId) {
      return {
        projectId: currentProjectId,
        section: activeSection,
        trainingRunId: focusedTrainingRunId,
      };
    }
    return {
      projectId: null,
      section: activeSection,
      trainingRunId: null,
    };
  }

  function openNotificationSettings() {
    const nextState = { projectId: null, section: "settings-notifications" } satisfies AppHistoryState;
    notificationSettingsReturnStateRef.current = currentHistoryState();
    window.history.pushState(nextState, "", appPath(null, "settings-notifications"));
    setSelectedProjectId(null);
    setActiveSection("settings-notifications");
    setFocusedTrainingRunId(null);
  }

  function closeNotificationSettings() {
    const nextState =
      notificationSettingsReturnStateRef.current ??
      ({ projectId: null, section: "projects" } satisfies AppHistoryState);
    notificationSettingsReturnStateRef.current = null;
    window.history.pushState(
      nextState,
      "",
      appPath(nextState.projectId, nextState.section, nextState.trainingRunId ?? null, projects),
    );
    setSelectedProjectId(nextState.projectId);
    setActiveSection(nextState.section);
    setFocusedTrainingRunId(nextState.trainingRunId ?? null);
    setFocusedInferenceRunId(null);
  }

  function handleOpenTrainingRun(projectId: string, runId: string) {
    const nextState = {
      projectId,
      section: "training-management",
      trainingRunId: runId,
    } satisfies AppHistoryState;
    window.history.pushState(nextState, "", appPath(projectId, "training-management", runId, projects));
    setSelectedProjectId(projectId);
    setActiveSection("training-management");
    setFocusedTrainingRunId(runId);
    setFocusedInferenceRunId(null);
  }

  function handleCloseTrainingRunDetail() {
    if (!selectedProjectApiId) return;
    const nextState = {
      projectId: selectedProjectApiId,
      section: "training-management",
      trainingRunId: null,
    } satisfies AppHistoryState;
    window.history.pushState(
      nextState,
      "",
      appPath(selectedProjectApiId, "training-management", null, projects),
    );
    setActiveSection("training-management");
    setFocusedTrainingRunId(null);
    setFocusedInferenceRunId(null);
  }

  function handleOpenInferenceRun(projectId: string, runId: string) {
    const nextState = {
      projectId,
      section: "inference",
      trainingRunId: null,
    } satisfies AppHistoryState;
    window.history.pushState(nextState, "", appPath(projectId, "inference", null, projects));
    setSelectedProjectId(projectId);
    setActiveSection("inference");
    setFocusedTrainingRunId(null);
    setFocusedInferenceRunId(runId);
  }

  function handleWorkNotification(notification: WorkCompletionNotification) {
    setNotifications((currentNotifications) => {
      if (currentNotifications.some((currentNotification) => currentNotification.id === notification.id)) {
        return currentNotifications;
      }
      return [notification, ...currentNotifications].slice(0, 20);
    });
  }

  function handleOpenNotification(notification: AppNotification) {
    if ("projectId" in notification && "runId" in notification && notification.projectId && notification.runId) {
      if ("kind" in notification && notification.kind === "inference") {
        handleOpenInferenceRun(String(notification.projectId), String(notification.runId));
        return;
      }
      handleOpenTrainingRun(String(notification.projectId), String(notification.runId));
    }
  }

  function handleDismissNotification(notificationId: string) {
    setNotifications((currentNotifications) =>
      currentNotifications.filter((notification) => notification.id !== notificationId),
    );
  }

  function openSidebarCreateDialog() {
    createSidebarProject.reset();
    setSidebarCreateDialogOpen(true);
  }

  function closeSidebarCreateDialog() {
    if (createSidebarProject.isPending) return;
    setSidebarCreateDialogOpen(false);
    setSidebarProjectName("");
    setSidebarProjectDescription("");
    setSidebarProjectTaskType("detection");
    createSidebarProject.reset();
  }

  function handleSidebarCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = sidebarProjectName.trim();
    if (!trimmedName || createSidebarProject.isPending) return;
    createSidebarProject.mutate({
      description: sidebarProjectDescription.trim(),
      name: trimmedName,
      task_type: sidebarProjectTaskType,
    });
  }

  function handleProjectDeleted(projectId: string) {
    if ((selectedProjectApiId ?? selectedProjectId) === projectId) {
      const nextSection = activeSection === "projects" ? "projects" : activeSection;
      window.history.replaceState(
        { projectId: null, section: nextSection } satisfies AppHistoryState,
        "",
        appPath(null, nextSection),
      );
      setSelectedProjectId(null);
      setFocusedTrainingRunId(null);
    }
  }

  const title =
    activeSection === "projects"
      ? t("nav.projects")
      : activeSection === "settings-notifications"
        ? t("notificationSettings.nav")
      : activeSection === "training-management"
        ? t("trainingManagement.nav")
      : selectedProjectQuery.data?.name ?? t(sectionTitleKey(activeSection));
  const projectScopedLoading = Boolean(
    selectedProjectId && !selectedProjectApiId && projectsQuery.isLoading,
  );

  return (
    <Layout
      activeSection={activeSection}
      hiddenProjectIds={hiddenProjectIds}
      notifications={notifications}
      onCreateProject={openSidebarCreateDialog}
      onOpenNotificationSettings={openNotificationSettings}
      onNavigate={handleSectionChange}
      onNotificationDismiss={handleDismissNotification}
      onNotificationOpen={handleOpenNotification}
      onProjectSortChange={setProjectSort}
      onSelectProject={handleSelectProjectInSidebar}
      onToggleProjectHidden={handleToggleProjectHidden}
      projects={projects}
      projectsLoading={projectsQuery.isLoading}
      projectSort={projectSort}
      selectedProjectId={selectedProjectApiId}
      title={title}
    >
      {activeSection === "projects" ? (
      <ProjectsPage
        onProjectDeleted={handleProjectDeleted}
        onSelectProject={handleSelectProject}
        selectedProjectId={selectedProjectApiId}
      />
      ) : activeSection === "settings-notifications" ? (
        <NotificationSettingsPage onBack={closeNotificationSettings} />
      ) : projectScopedLoading ? (
        <section className="empty-state empty-state--page" aria-live="polite">
          <Loader2 aria-hidden="true" className="spin" size={24} />
          <p>{t("projects.loading")}</p>
        </section>
      ) : !selectedProjectApiId ? (
        <ProjectRequiredEmpty onOpenProjects={handleOpenProjects} section={activeSection} />
      ) : activeSection === "training-management" && focusedTrainingRunId ? (
        <TrainingRunPage
          onBackToList={handleCloseTrainingRunDetail}
          projectId={selectedProjectApiId}
          runId={focusedTrainingRunId}
        />
      ) : activeSection === "training-management" ? (
        <TrainingManagementPage onOpenRun={handleOpenTrainingRun} projectId={selectedProjectApiId} />
      ) : (
        <ProjectDetailPage
          key={selectedProjectApiId}
          activeTab={activeSection}
          focusedInferenceRunId={focusedInferenceRunId}
          onTabChange={(tab) => handleSectionChange(tab)}
          projectId={selectedProjectApiId}
        />
      )}
      <TrainingQueueWidget
        onNotification={handleWorkNotification}
        onOpenInferenceRun={handleOpenInferenceRun}
        onOpenRun={handleOpenTrainingRun}
        projects={projects}
      />
      {sidebarCreateDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="sidebar-project-create-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <form className="modal-form" onSubmit={handleSidebarCreateSubmit}>
              <div className="panel__header">
                <div>
                  <h2 id="sidebar-project-create-title">{t("projects.new")}</h2>
                </div>
                <button
                  aria-label={t("projects.closeCreate")}
                  className="icon-button"
                  disabled={createSidebarProject.isPending}
                  onClick={closeSidebarCreateDialog}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>

              <label className="field">
                <span>{t("projects.name")}</span>
                <input
                  autoFocus
                  onChange={(event) => setSidebarProjectName(event.target.value)}
                  placeholder={t("projects.namePlaceholder")}
                  required
                  type="text"
                  value={sidebarProjectName}
                />
              </label>

              <label className="field">
                <span>{t("projects.description")}</span>
                <textarea
                  onChange={(event) => setSidebarProjectDescription(event.target.value)}
                  placeholder={t("projects.descriptionPlaceholder")}
                  rows={4}
                  value={sidebarProjectDescription}
                />
              </label>

              <label className="field">
                <span>{t("projects.taskType")}</span>
                <select
                  aria-label={t("projects.taskType")}
                  onChange={(event) =>
                    setSidebarProjectTaskType(event.target.value as ProjectTaskType)
                  }
                  value={sidebarProjectTaskType}
                >
                  <option value="detection">{t("projects.detection")}</option>
                  <option value="classification">{t("projects.classification")}</option>
                </select>
              </label>

              {createSidebarProject.isError ? (
                <div className="notice notice--danger" role="alert">
                  {t("projects.createError")}
                </div>
              ) : null}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  disabled={createSidebarProject.isPending}
                  onClick={closeSidebarCreateDialog}
                  type="button"
                >
                  {t("projects.cancel")}
                </button>
                <button
                  className="primary-button"
                  disabled={!sidebarProjectName.trim() || createSidebarProject.isPending}
                  type="submit"
                >
                  {createSidebarProject.isPending ? (
                    <Loader2 aria-hidden="true" className="spin" size={17} />
                  ) : (
                    <Plus aria-hidden="true" size={17} />
                  )}
                  <span>{t("projects.create")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
