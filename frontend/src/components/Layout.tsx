import {
  Activity,
  Bell,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Database,
  Eye,
  EyeOff,
  FolderKanban,
  Loader2,
  PlayCircle,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { CSSProperties, PointerEvent, ReactNode, useEffect, useRef, useState } from "react";

import type { Project } from "../api/types";
import visionOpsLogoUrl from "../assets/visionops-logo.svg";
import { LanguageControl, useLanguage } from "../i18n/LanguageProvider";
import { ThemeControl } from "../theme/ThemeProvider";

export type GlobalSection =
  | "projects"
  | "datasets"
  | "training"
  | "training-management"
  | "inference";

export type ProjectSort = "updated_desc" | "name_asc";

export type AppNotification = {
  body: string;
  createdAt: string;
  id: string;
  projectId?: string;
  runId?: string;
  title: string;
  tone: "success" | "danger" | "info";
};

type LayoutProps = {
  activeSection: GlobalSection;
  children: ReactNode;
  hiddenProjectIds?: string[];
  notifications?: AppNotification[];
  onCreateProject?: () => void;
  onNotificationDismiss?: (notificationId: string) => void;
  onNotificationOpen?: (notification: AppNotification) => void;
  onProjectSortChange?: (sort: ProjectSort) => void;
  onSelectProject?: (projectId: string) => void;
  onToggleProjectHidden?: (projectId: string) => void;
  onNavigate: (section: GlobalSection) => void;
  projects?: Project[];
  projectsLoading?: boolean;
  projectSort?: ProjectSort;
  selectedProjectId?: string | null;
  title: string;
};

const navItems: Array<{
  icon: typeof FolderKanban;
  key: GlobalSection;
  labelKey: string;
}> = [
  { icon: Database, key: "datasets", labelKey: "nav.datasetsManagement" },
  { icon: PlayCircle, key: "training", labelKey: "nav.modelTraining" },
  { icon: ClipboardList, key: "training-management", labelKey: "nav.modelTrainingManagement" },
  { icon: Activity, key: "inference", labelKey: "nav.inference" },
];

const SIDEBAR_WIDTH_KEY = "visionops:project-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "visionops:project-sidebar-collapsed";
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const COLLAPSE_SIDEBAR_WIDTH = 140;
const RAIL_SIDEBAR_WIDTH = 44;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function storedSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const storedValue = window.localStorage?.getItem?.(SIDEBAR_WIDTH_KEY);
  if (storedValue === null || storedValue === undefined) return DEFAULT_SIDEBAR_WIDTH;
  const value = Number(storedValue);
  return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
}

function storedSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage?.getItem?.(SIDEBAR_COLLAPSED_KEY) === "true";
}

function sortProjects(projects: Project[], sort: ProjectSort): Project[] {
  return [...projects].sort((left, right) => {
    if (sort === "name_asc") {
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function ProjectSidebar({
  hiddenProjectIds,
  onCreateProject,
  onProjectSortChange,
  onSelectProject,
  onToggleProjectHidden,
  projects,
  projectsLoading,
  projectSort,
  selectedProjectId,
}: Required<
  Pick<
    LayoutProps,
    | "hiddenProjectIds"
    | "onCreateProject"
    | "onProjectSortChange"
    | "onSelectProject"
    | "onToggleProjectHidden"
    | "projects"
    | "projectsLoading"
    | "projectSort"
  >
> & {
  selectedProjectId: string | null;
}) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenProjectsExpanded, setHiddenProjectsExpanded] = useState(true);
  const hiddenSet = new Set(hiddenProjectIds);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredProjects = normalizedSearchQuery
    ? projects.filter((project) =>
        `${project.name} ${project.description}`.toLocaleLowerCase().includes(normalizedSearchQuery),
      )
    : projects;
  const sortedProjects = sortProjects(filteredProjects, projectSort);
  const visibleProjects = sortedProjects.filter((project) => !hiddenSet.has(project.id));
  const hiddenProjects = sortedProjects.filter((project) => hiddenSet.has(project.id));
  const sidebarProjects = [...visibleProjects, ...hiddenProjects];

  return (
    <aside className="project-sidebar" aria-label={t("projectSidebar.label")}>
      <div className="project-sidebar__header">
        <div>
          <strong>{t("projectSidebar.titleWithCount", { count: projects.length })}</strong>
        </div>
        <div className="project-sidebar__header-actions">
          {projectsLoading ? <Loader2 aria-hidden="true" className="spin" size={16} /> : null}
          <button
            aria-label={t("projects.new")}
            className="icon-button project-sidebar__create"
            onClick={onCreateProject}
            title={t("projects.new")}
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div className="project-sidebar__tools" aria-label={t("projectSidebar.sort")}>
        <button
          data-active={projectSort === "updated_desc" ? "true" : undefined}
          onClick={() => onProjectSortChange("updated_desc")}
          type="button"
        >
          {t("projectSidebar.sortUpdated")}
        </button>
        <button
          data-active={projectSort === "name_asc" ? "true" : undefined}
          onClick={() => onProjectSortChange("name_asc")}
          type="button"
        >
          {t("projectSidebar.sortName")}
        </button>
      </div>

      <label className="project-sidebar__search">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label={t("projectSidebar.search")}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("projectSidebar.searchPlaceholder")}
          type="search"
          value={searchQuery}
        />
      </label>

      <div className="project-sidebar__list">
        {visibleProjects.map((project) => {
          const isHidden = hiddenSet.has(project.id);
          return (
            <div
              className="project-sidebar__row"
              data-hidden={isHidden ? "true" : undefined}
              data-selected={selectedProjectId === project.id ? "true" : undefined}
              key={project.id}
            >
              <button
                aria-disabled={isHidden ? "true" : undefined}
                className="project-sidebar__project"
                disabled={isHidden}
                onClick={() => onSelectProject(project.id)}
                type="button"
              >
                <span>
                  <strong>{project.name}</strong>
                </span>
              </button>
              <button
                aria-label={
                  isHidden
                    ? t("projectSidebar.showProject", { name: project.name })
                    : t("projectSidebar.hideProject", { name: project.name })
                }
                className="icon-button project-sidebar__hide"
                onClick={() => onToggleProjectHidden(project.id)}
                title={
                  isHidden
                    ? t("projectSidebar.showProject", { name: project.name })
                    : t("projectSidebar.hideProject", { name: project.name })
                }
                type="button"
              >
                {isHidden ? (
                  <EyeOff aria-hidden="true" size={16} />
                ) : (
                  <Eye aria-hidden="true" size={16} />
                )}
              </button>
            </div>
          );
        })}
        {hiddenProjects.length > 0 ? (
          <>
            <button
              aria-expanded={hiddenProjectsExpanded}
              className="project-sidebar__hidden-toggle"
              onClick={() => setHiddenProjectsExpanded((current) => !current)}
              type="button"
            >
              <span>{t("projectSidebar.hiddenGroup")}</span>
              <span className="project-sidebar__hidden-separator" aria-hidden="true">
                ·
              </span>
              <small>{hiddenProjects.length}</small>
              {hiddenProjectsExpanded ? (
                <ChevronUp aria-hidden="true" size={14} />
              ) : (
                <ChevronDown aria-hidden="true" size={14} />
              )}
            </button>
            {hiddenProjectsExpanded ? (
              <div className="project-sidebar__hidden-list">
                {hiddenProjects.map((project) => {
                  const isHidden = hiddenSet.has(project.id);
                  return (
                    <div
                      className="project-sidebar__row"
                      data-hidden="true"
                      data-selected={selectedProjectId === project.id ? "true" : undefined}
                      key={project.id}
                    >
                      <button
                        aria-disabled="true"
                        className="project-sidebar__project"
                        disabled
                        onClick={() => onSelectProject(project.id)}
                        type="button"
                      >
                        <span>
                          <strong>{project.name}</strong>
                        </span>
                      </button>
                      <button
                        aria-label={t("projectSidebar.showProject", { name: project.name })}
                        className="icon-button project-sidebar__hide"
                        onClick={() => onToggleProjectHidden(project.id)}
                        title={t("projectSidebar.showProject", { name: project.name })}
                        type="button"
                      >
                        {isHidden ? (
                          <EyeOff aria-hidden="true" size={15} />
                        ) : (
                          <Eye aria-hidden="true" size={15} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
        {!projectsLoading && sidebarProjects.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>{t("projects.empty")}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function Layout({
  activeSection,
  children,
  hiddenProjectIds = [],
  notifications = [],
  onCreateProject = () => undefined,
  onNotificationDismiss = () => undefined,
  onNotificationOpen = () => undefined,
  onProjectSortChange = () => undefined,
  onSelectProject = () => undefined,
  onToggleProjectHidden = () => undefined,
  onNavigate,
  projects = [],
  projectsLoading = false,
  projectSort = "updated_desc",
  selectedProjectId = null,
}: LayoutProps) {
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(storedSidebarWidth);
  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(storedSidebarCollapsed);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const { t } = useLanguage();
  const showProjectSidebar = activeSection !== "projects";

  useEffect(() => {
    window.localStorage?.setItem?.(SIDEBAR_WIDTH_KEY, String(projectSidebarWidth));
  }, [projectSidebarWidth]);

  useEffect(() => {
    window.localStorage?.setItem?.(SIDEBAR_COLLAPSED_KEY, String(projectSidebarCollapsed));
  }, [projectSidebarCollapsed]);

  useEffect(() => {
    if (!showProjectSidebar) return undefined;

    function handlePointerMove(event: globalThis.PointerEvent) {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) return;
      const nextWidth = resizeStart.width + event.clientX - resizeStart.pointerX;
      if (nextWidth <= COLLAPSE_SIDEBAR_WIDTH) {
        setProjectSidebarCollapsed(true);
        return;
      }
      setProjectSidebarCollapsed(false);
      setProjectSidebarWidth(clampSidebarWidth(nextWidth));
    }

    function handlePointerUp() {
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [showProjectSidebar]);

  function startProjectSidebarResize(event: PointerEvent<HTMLButtonElement>, startWidth?: number) {
    resizeStartRef.current = {
      pointerX: event.clientX,
      width: startWidth ?? projectSidebarWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  return (
    <div className="app-shell">
      <div className="workspace">
        <header className="app-header">
          <div className="header-left">
            <button
              aria-label="VisionOps"
              className="brand brand--header"
              onClick={() => onNavigate("projects")}
              title="VisionOps"
              type="button"
            >
              <span className="brand__mark" aria-hidden="true">
                <img alt="" src={visionOpsLogoUrl} />
              </span>
              <span>
                <span className="brand__name">VisionOps</span>
              </span>
              <span className="visually-hidden">{t("nav.projects")}</span>
            </button>
            <nav className="top-nav" aria-label={t("nav.primary")}>
              {navItems.map((item) => {
                const Icon = item.icon;
                const label = t(item.labelKey);
                return (
                  <button
                    aria-current={activeSection === item.key ? "page" : undefined}
                    aria-label={label}
                    className="top-nav__button"
                    data-active={activeSection === item.key ? "true" : undefined}
                    key={item.key}
                    onClick={() => onNavigate(item.key)}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={16} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="header-actions">
            <div className="notifications-wrapper">
              <button
                aria-controls="notifications-panel"
                aria-expanded={notificationsOpen}
                className="icon-button"
                aria-label={t("header.notifications")}
                data-active={notificationsOpen ? "true" : undefined}
                onClick={() => {
                  setSettingsOpen(false);
                  setHeaderNotice(null);
                  setNotificationsOpen((isOpen) => !isOpen);
                }}
                title={t("header.notifications")}
                type="button"
              >
                <Bell aria-hidden="true" size={18} />
                {notifications.length > 0 ? (
                  <span className="notification-count" aria-label={t("header.notificationCount", { count: notifications.length })}>
                    {notifications.length}
                  </span>
                ) : null}
              </button>
              {notificationsOpen ? (
                <div
                  aria-label={t("header.notifications")}
                  className="notifications-panel"
                  id="notifications-panel"
                  role="dialog"
                >
                  <div className="notifications-panel__header">
                    <strong>{t("header.notifications")}</strong>
                    <span>{t("header.notificationCount", { count: notifications.length })}</span>
                  </div>
                  {notifications.length > 0 ? (
                    <div className="notifications-panel__list">
                      {notifications.map((notification) => (
                        <div
                          className="notifications-panel__item"
                          data-tone={notification.tone}
                          key={notification.id}
                        >
                          <button
                            className="notifications-panel__open"
                            onClick={() => onNotificationOpen(notification)}
                            type="button"
                          >
                            <strong>{notification.title}</strong>
                            <span>{notification.body}</span>
                          </button>
                          <button
                            aria-label={t("header.dismissNotification", { title: notification.title })}
                            className="icon-button notifications-panel__dismiss"
                            onClick={() => onNotificationDismiss(notification.id)}
                            type="button"
                          >
                            <X aria-hidden="true" size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact notifications-panel__empty">
                      <p>{t("header.noNotifications")}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="settings-wrapper">
              <button
                aria-controls="settings-panel"
                aria-expanded={settingsOpen}
                className="icon-button"
                data-active={settingsOpen ? "true" : undefined}
                aria-label={t("header.settings")}
                onClick={() => {
                  setHeaderNotice(null);
                  setNotificationsOpen(false);
                  setSettingsOpen((isOpen) => !isOpen);
                }}
                title={t("header.settings")}
                type="button"
              >
                <Settings aria-hidden="true" size={18} />
              </button>
              {settingsOpen ? (
                <div
                  className="settings-panel"
                  id="settings-panel"
                  role="dialog"
                  aria-label={t("header.settings")}
                >
                  <div className="settings-panel__section">
                    <div className="settings-panel__header">
                      <span>{t("settings.theme")}</span>
                    </div>
                    <ThemeControl />
                  </div>
                  <div className="settings-panel__section">
                    <div className="settings-panel__header">
                      <span>{t("settings.language")}</span>
                    </div>
                    <LanguageControl />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {headerNotice ? (
            <div className="header-notice" role="status">
              {headerNotice}
            </div>
          ) : null}
        </header>

        <div
          className="workspace-body"
          data-has-sidebar={showProjectSidebar ? "true" : undefined}
          data-sidebar-collapsed={
            showProjectSidebar && projectSidebarCollapsed ? "true" : undefined
          }
          style={
            showProjectSidebar
              ? ({ "--project-sidebar-width": `${projectSidebarWidth}px` } as CSSProperties)
              : undefined
          }
        >
          {showProjectSidebar && projectSidebarCollapsed ? (
            <aside className="project-sidebar-rail" aria-label={t("projectSidebar.label")}>
              <button
                aria-label={t("projectSidebar.expand")}
                className="project-sidebar-rail__open"
                onClick={() => setProjectSidebarCollapsed(false)}
                title={t("projectSidebar.expand")}
                type="button"
              >
                <span aria-hidden="true">→</span>
              </button>
              <button
                aria-label={t("projectSidebar.resize")}
                className="project-sidebar-rail__resize-handle"
                onPointerDown={(event) => startProjectSidebarResize(event, RAIL_SIDEBAR_WIDTH)}
                title={t("projectSidebar.resize")}
                type="button"
              />
            </aside>
          ) : null}
          {showProjectSidebar && !projectSidebarCollapsed ? (
            <div className="project-sidebar-shell">
              <ProjectSidebar
                hiddenProjectIds={hiddenProjectIds}
                onCreateProject={onCreateProject}
                onProjectSortChange={onProjectSortChange}
                onSelectProject={onSelectProject}
                onToggleProjectHidden={onToggleProjectHidden}
                projects={projects}
                projectsLoading={projectsLoading}
                projectSort={projectSort}
                selectedProjectId={selectedProjectId}
              />
              <button
                aria-label={t("projectSidebar.resize")}
                className="project-sidebar__resize-handle"
                onPointerDown={startProjectSidebarResize}
                title={t("projectSidebar.resize")}
                type="button"
              />
            </div>
          ) : null}
          <main className="dashboard" aria-label={t("app.workspace")}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
