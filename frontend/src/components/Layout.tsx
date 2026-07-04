import {
  Bell,
  Boxes,
  Database,
  FolderKanban,
  Gauge,
  PlayCircle,
  Search,
  Settings,
} from "lucide-react";
import { ReactNode, useState } from "react";

import type { DetailTab } from "../pages/ProjectDetailPage";

type LayoutProps = {
  activeTab: DetailTab;
  children: ReactNode;
  currentView: "projects" | "project-detail";
  onOpenProjects: () => void;
  onOpenProjectTab: (tab: DetailTab) => void;
  projectName?: string | null;
  selectedProjectId: string | null;
  title: string;
};

const projectTabs: Array<{
  label: string;
  tab: DetailTab;
  icon: typeof Database;
}> = [
  { label: "데이터셋", tab: "datasets", icon: Database },
  { label: "학습", tab: "training", icon: Gauge },
  { label: "추론", tab: "inference", icon: PlayCircle },
  { label: "아티팩트", tab: "artifacts", icon: Boxes },
];

export function Layout({
  activeTab,
  children,
  currentView,
  onOpenProjectTab,
  onOpenProjects,
  projectName,
  selectedProjectId,
  title,
}: LayoutProps) {
  const canOpenProjectTabs = Boolean(selectedProjectId);
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="주요 탐색">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            VO
          </div>
          <div>
            <p className="brand__name">VisionOps</p>
            <p className="brand__meta">Detection Console</p>
          </div>
        </div>

        <nav className="nav-list">
          <button
            className="nav-item"
            data-active={currentView === "projects" ? "true" : undefined}
            onClick={onOpenProjects}
            type="button"
          >
            <FolderKanban aria-hidden="true" size={18} />
            <span>프로젝트</span>
          </button>

          {projectTabs.map(({ icon: Icon, label, tab }) => (
            <button
              aria-disabled={!canOpenProjectTabs}
              className="nav-item"
              data-active={
                currentView === "project-detail" && activeTab === tab ? "true" : undefined
              }
              key={tab}
              onClick={() => onOpenProjectTab(tab)}
              title={
                canOpenProjectTabs
                  ? label
                  : `${label} 탭을 열려면 프로젝트를 먼저 선택하세요.`
              }
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <Gauge aria-hidden="true" size={18} />
          <div>
            <p>현재 프로젝트</p>
            <strong>{projectName || "미선택"}</strong>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="app-header">
          <div>
            <p className="eyebrow">운영 콘솔</p>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="검색"
              onClick={() => setHeaderNotice("검색은 프로젝트 데이터가 쌓이면 연결됩니다.")}
              title="검색"
              type="button"
            >
              <Search aria-hidden="true" size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="알림"
              onClick={() => setHeaderNotice("알림이 없습니다.")}
              title="알림"
              type="button"
            >
              <Bell aria-hidden="true" size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="설정"
              onClick={() => setHeaderNotice("설정 화면은 다음 단계에서 연결됩니다.")}
              title="설정"
              type="button"
            >
              <Settings aria-hidden="true" size={18} />
            </button>
          </div>
          {headerNotice ? (
            <div className="header-notice" role="status">
              {headerNotice}
            </div>
          ) : null}
        </header>

        <main className="dashboard" aria-label="VisionOps 작업 영역">
          {children}
        </main>
      </div>
    </div>
  );
}
