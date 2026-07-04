import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, Plus } from "lucide-react";
import { FormEvent, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import type { Project, ProjectCreate } from "../api/types";

type ProjectsPageProps = {
  onSelectProject: (projectId: string) => void;
  prompt?: string | null;
  selectedProjectId: string | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ProjectsPage({ onSelectProject, prompt, selectedProjectId }: ProjectsPageProps) {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onSelectProject(project.id);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || createProject.isPending) return;

    createProject.mutate({
      description: description.trim(),
      name: trimmedName,
    });
  }

  return (
    <div className="page-stack">
      <section className="summary-band" aria-label="프로젝트 요약">
        <div>
          <p className="section-label">프로젝트</p>
          <h2>{projectsQuery.data?.length ?? 0}개 프로젝트</h2>
        </div>
        <div className="summary-metrics">
          <div>
            <span>선택됨</span>
            <strong>{selectedProjectId ? "1" : "0"}</strong>
          </div>
          <div>
            <span>작업 유형</span>
            <strong>탐지</strong>
          </div>
          <div>
            <span>API</span>
            <strong>{projectsQuery.isError ? "오류" : "준비"}</strong>
          </div>
        </div>
      </section>

      {prompt ? (
        <div className="notice notice--warning" role="status">
          {prompt}
        </div>
      ) : null}

      <section className="content-grid content-grid--projects">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p className="section-label">목록</p>
              <h2>프로젝트 테이블</h2>
            </div>
          </div>

          {projectsQuery.isLoading ? (
            <div className="empty-state">
              <Loader2 aria-hidden="true" className="spin" size={22} />
              <p>불러오는 중</p>
            </div>
          ) : null}

          {projectsQuery.isError ? (
            <div className="notice notice--danger" role="alert">
              프로젝트를 불러오지 못했습니다.
            </div>
          ) : null}

          {!projectsQuery.isLoading && !projectsQuery.isError ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>설명</th>
                    <th>유형</th>
                    <th>업데이트</th>
                  </tr>
                </thead>
                <tbody>
                  {(projectsQuery.data ?? []).map((project) => (
                    <tr
                      aria-label={`${project.name} 프로젝트 열기`}
                      aria-selected={selectedProjectId === project.id}
                      data-selected={selectedProjectId === project.id ? "true" : undefined}
                      key={project.id}
                      onClick={() => onSelectProject(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectProject(project.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        <span
                          className="table-link"
                          data-project-row={project.id}
                        >
                          {project.name}
                        </span>
                      </td>
                      <td>{project.description || "-"}</td>
                      <td>{project.task_type === "detection" ? "탐지" : project.task_type}</td>
                      <td>{formatDate(project.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(projectsQuery.data ?? []).length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <FolderPlus aria-hidden="true" size={22} />
                  <p>프로젝트 없음</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="panel__header">
            <div>
              <p className="section-label">생성</p>
              <h2>새 프로젝트</h2>
            </div>
          </div>

          <label className="field">
            <span>이름</span>
            <input
              onChange={(event) => setName(event.target.value)}
              placeholder="검수 라인 A"
              required
              type="text"
              value={name}
            />
          </label>

          <label className="field">
            <span>설명</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="라인 결함 탐지"
              rows={4}
              value={description}
            />
          </label>

          {createProject.isError ? (
            <div className="notice notice--danger" role="alert">
              프로젝트 생성에 실패했습니다.
            </div>
          ) : null}

          <button className="primary-button" disabled={!name.trim() || createProject.isPending} type="submit">
            {createProject.isPending ? (
              <Loader2 aria-hidden="true" className="spin" size={17} />
            ) : (
              <Plus aria-hidden="true" size={17} />
            )}
            <span>생성</span>
          </button>
        </form>
      </section>
    </div>
  );
}
