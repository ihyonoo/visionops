import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet } from "./api/client";
import { Layout } from "./components/Layout";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import type { Project } from "./api/types";
import type { DetailTab } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
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

const detailTabLabels: Record<DetailTab, string> = {
  artifacts: "아티팩트",
  datasets: "데이터셋",
  inference: "추론",
  overview: "개요",
  training: "학습",
};

function AppContent() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"projects" | "project-detail">("projects");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [projectPrompt, setProjectPrompt] = useState<string | null>(null);

  const selectedProjectQuery = useQuery({
    enabled: Boolean(selectedProjectId),
    queryFn: () => apiGet<Project>(`/api/projects/${selectedProjectId as string}`),
    queryKey: ["projects", selectedProjectId],
  });

  function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setProjectPrompt(null);
    setActiveTab("overview");
    setCurrentView("project-detail");
  }

  function handleOpenProjectTab(tab: DetailTab) {
    if (!selectedProjectId) {
      setProjectPrompt(
        `${detailTabLabels[tab]} 탭을 열려면 먼저 프로젝트를 선택하거나 새 프로젝트를 생성하세요.`,
      );
      setCurrentView("projects");
      return;
    }
    setActiveTab(tab);
    setCurrentView("project-detail");
  }

  const title =
    currentView === "projects"
      ? "프로젝트"
      : selectedProjectQuery.data?.name ?? "프로젝트 상세";

  return (
    <Layout
      activeTab={activeTab}
      currentView={currentView}
      onOpenProjectTab={handleOpenProjectTab}
      onOpenProjects={() => setCurrentView("projects")}
      projectName={selectedProjectQuery.data?.name}
      selectedProjectId={selectedProjectId}
      title={title}
    >
      {currentView === "projects" || !selectedProjectId ? (
        <ProjectsPage
          onSelectProject={handleSelectProject}
          prompt={projectPrompt}
          selectedProjectId={selectedProjectId}
        />
      ) : (
        <ProjectDetailPage
          activeTab={activeTab}
          key={selectedProjectId}
          onTabChange={setActiveTab}
          projectId={selectedProjectId}
        />
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
