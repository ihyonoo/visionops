import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, MoreVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost, apiUrl } from "../api/client";
import type { Project, ProjectCreate, ProjectUpdate } from "../api/types";
import { useLanguage, type Language } from "../i18n/LanguageProvider";

type ProjectsPageProps = {
  onProjectDeleted: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  selectedProjectId: string | null;
};

function formatDate(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ProjectThumbnail({ project }: { project: Project }) {
  const [hasImage, setHasImage] = useState(true);

  return (
    <span className="project-card__thumbnail" aria-hidden="true">
      {hasImage ? (
        <img
          alt=""
          data-project-thumbnail={project.id}
          onError={() => setHasImage(false)}
          src={apiUrl(`/api/projects/${project.id}/thumbnail`)}
        />
      ) : (
        <FolderPlus size={26} />
      )}
    </span>
  );
}

export function ProjectsPage({ onProjectDeleted, onSelectProject, selectedProjectId }: ProjectsPageProps) {
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const projectsQuery = useQuery({
    queryFn: () => apiGet<Project[]>("/api/projects"),
    queryKey: ["projects"],
  });

  const createProject = useMutation({
    mutationFn: (body: ProjectCreate) => apiPost<Project>("/api/projects", body),
    onSuccess: (project) => {
      setName("");
      setDescription("");
      setCreateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onSelectProject(project.id);
    },
  });

  const updateProject = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProjectUpdate }) =>
      apiPatch<Project>(`/api/projects/${id}`, body),
    onSuccess: (project) => {
      setEditingProject(null);
      setMenuProjectId(null);
      setName("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", project.id] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: (projectId: string) => apiDelete(`/api/projects/${projectId}`),
    onSuccess: (_result, projectId) => {
      setDeletingProject(null);
      setMenuProjectId(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.removeQueries({ queryKey: ["projects", projectId] });
      onProjectDeleted(projectId);
    },
  });

  function openCreateDialog() {
    createProject.reset();
    setCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    if (createProject.isPending) return;
    setCreateDialogOpen(false);
    setName("");
    setDescription("");
    createProject.reset();
  }

  function openEditDialog(project: Project) {
    updateProject.reset();
    setMenuProjectId(null);
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description);
  }

  function closeEditDialog() {
    if (updateProject.isPending) return;
    setEditingProject(null);
    setName("");
    setDescription("");
    updateProject.reset();
  }

  function openDeleteDialog(project: Project) {
    deleteProject.reset();
    setMenuProjectId(null);
    setDeletingProject(project);
  }

  function closeDeleteDialog() {
    if (deleteProject.isPending) return;
    setDeletingProject(null);
    deleteProject.reset();
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || createProject.isPending) return;

    createProject.mutate({
      description: description.trim(),
      name: trimmedName,
    });
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!editingProject || !trimmedName || updateProject.isPending) return;
    updateProject.mutate({
      id: editingProject.id,
      body: {
        description: description.trim(),
        name: trimmedName,
      },
    });
  }

  function handleDeleteConfirm() {
    if (!deletingProject || deleteProject.isPending) return;
    deleteProject.mutate(deletingProject.id);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLElement>, projectId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectProject(projectId);
    }
  }

  return (
    <div className="page-stack">
      <section className="content-grid content-grid--projects">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <h2>{t("projects.table")}</h2>
            </div>
            <button className="primary-button" onClick={openCreateDialog} type="button">
              <Plus aria-hidden="true" size={17} />
              <span>{t("projects.new")}</span>
            </button>
          </div>

          {projectsQuery.isLoading ? (
            <div className="empty-state">
              <Loader2 aria-hidden="true" className="spin" size={22} />
              <p>{t("projects.loading")}</p>
            </div>
          ) : null}

          {projectsQuery.isError ? (
            <div className="notice notice--danger" role="alert">
              {t("projects.loadError")}
            </div>
          ) : null}

          {!projectsQuery.isLoading && !projectsQuery.isError ? (
            <>
              <div className="project-card-grid">
                {(projectsQuery.data ?? []).map((project) => (
                  <article
                    aria-label={t("projects.open", { name: project.name })}
                    aria-selected={selectedProjectId === project.id}
                    className="project-card"
                    data-project-row={project.id}
                    data-selected={selectedProjectId === project.id ? "true" : undefined}
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    onKeyDown={(event) => handleCardKeyDown(event, project.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <ProjectThumbnail project={project} />
                    <span className="project-card__menu">
                      <button
                        aria-expanded={menuProjectId === project.id}
                        aria-label={t("projects.actions", { name: project.name })}
                        className="project-card__menu-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuProjectId((currentId) => currentId === project.id ? null : project.id);
                        }}
                        type="button"
                      >
                        <MoreVertical aria-hidden="true" size={18} />
                      </button>
                      {menuProjectId === project.id ? (
                        <span
                          className="project-card__menu-popover"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button onClick={() => openEditDialog(project)} type="button">
                            <Pencil aria-hidden="true" size={15} />
                            <span>{t("projects.rename")}</span>
                          </button>
                          <button onClick={() => openDeleteDialog(project)} type="button">
                            <Trash2 aria-hidden="true" size={15} />
                            <span>{t("projects.delete")}</span>
                          </button>
                        </span>
                      ) : null}
                    </span>
                    <span className="project-card__body">
                      <strong>{project.name}</strong>
                      <small>{project.description || "-"}</small>
                    </span>
                    <span className="project-card__meta">
                      <span>{project.task_type === "detection" ? t("projects.detection") : project.task_type}</span>
                      <span>{t("projects.columnUpdated")} {formatDate(project.updated_at, language)}</span>
                    </span>
                  </article>
                ))}
              </div>
              {(projectsQuery.data ?? []).length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <FolderPlus aria-hidden="true" size={22} />
                  <p>{t("projects.empty")}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {createDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="project-create-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <form className="modal-form" onSubmit={handleCreateSubmit}>
              <div className="panel__header">
                <div>
                  <h2 id="project-create-title">{t("projects.new")}</h2>
                </div>
                <button
                  aria-label={t("projects.closeCreate")}
                  className="icon-button"
                  disabled={createProject.isPending}
                  onClick={closeCreateDialog}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>

              <label className="field">
                <span>{t("projects.name")}</span>
                <input
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("projects.namePlaceholder")}
                  required
                  type="text"
                  value={name}
                />
              </label>

              <label className="field">
                <span>{t("projects.description")}</span>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("projects.descriptionPlaceholder")}
                  rows={4}
                  value={description}
                />
              </label>

              {createProject.isError ? (
                <div className="notice notice--danger" role="alert">
                  {t("projects.createError")}
                </div>
              ) : null}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  disabled={createProject.isPending}
                  onClick={closeCreateDialog}
                  type="button"
                >
                  {t("projects.cancel")}
                </button>
                <button className="primary-button" disabled={!name.trim() || createProject.isPending} type="submit">
                  {createProject.isPending ? (
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

      {editingProject ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="project-edit-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <form className="modal-form" onSubmit={handleEditSubmit}>
              <div className="panel__header">
                <div>
                  <h2 id="project-edit-title">{editingProject.name}</h2>
                </div>
                <button
                  aria-label={t("projects.closeEdit")}
                  className="icon-button"
                  disabled={updateProject.isPending}
                  onClick={closeEditDialog}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>

              <label className="field">
                <span>{t("projects.name")}</span>
                <input
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("projects.namePlaceholder")}
                  required
                  type="text"
                  value={name}
                />
              </label>

              <label className="field">
                <span>{t("projects.description")}</span>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("projects.descriptionPlaceholder")}
                  rows={4}
                  value={description}
                />
              </label>

              {updateProject.isError ? (
                <div className="notice notice--danger" role="alert">
                  {t("projects.updateError")}
                </div>
              ) : null}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  disabled={updateProject.isPending}
                  onClick={closeEditDialog}
                  type="button"
                >
                  {t("projects.cancel")}
                </button>
                <button className="primary-button" disabled={!name.trim() || updateProject.isPending} type="submit">
                  {updateProject.isPending ? (
                    <Loader2 aria-hidden="true" className="spin" size={17} />
                  ) : (
                    <Pencil aria-hidden="true" size={17} />
                  )}
                  <span>{t("projects.update")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deletingProject ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="project-delete-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <div className="modal-form">
              <div className="panel__header">
                <div>
                  <h2 id="project-delete-title">{deletingProject.name}</h2>
                </div>
                <button
                  aria-label={t("projects.closeDelete")}
                  className="icon-button"
                  disabled={deleteProject.isPending}
                  onClick={closeDeleteDialog}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="notice notice--warning" role="alert">
                {t("projects.deleteConfirm", { name: deletingProject.name })}
              </div>
              <p className="modal-copy">{t("projects.deleteWarning")}</p>

              {deleteProject.isError ? (
                <div className="notice notice--danger" role="alert">
                  {t("projects.deleteError")}
                </div>
              ) : null}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  disabled={deleteProject.isPending}
                  onClick={closeDeleteDialog}
                  type="button"
                >
                  {t("projects.cancel")}
                </button>
                <button
                  className="danger-button"
                  disabled={deleteProject.isPending}
                  onClick={handleDeleteConfirm}
                  type="button"
                >
                  {deleteProject.isPending ? (
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
    </div>
  );
}
