import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet } from "./api/client";
import { Layout } from "./components/Layout";
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
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

function AppContent() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"projects" | "project-detail">("projects");
  const [activeTab, setActiveTab] = useState<DetailTab>("datasets");
  const { t } = useLanguage();

  const selectedProjectQuery = useQuery({
    enabled: Boolean(selectedProjectId),
    queryFn: () => apiGet<Project>(`/api/projects/${selectedProjectId as string}`),
    queryKey: ["projects", selectedProjectId],
  });

  function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setActiveTab("datasets");
    setCurrentView("project-detail");
  }

  function handleProjectDeleted(projectId: string) {
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
      setActiveTab("datasets");
      setCurrentView("projects");
    }
  }

  const title =
    currentView === "projects"
      ? t("nav.projects")
      : selectedProjectQuery.data?.name ?? t("project.detailFallback");

  return (
    <Layout
      currentView={currentView}
      onOpenProjects={() => setCurrentView("projects")}
      title={title}
    >
      {currentView === "projects" || !selectedProjectId ? (
        <ProjectsPage
          onProjectDeleted={handleProjectDeleted}
          onSelectProject={handleSelectProject}
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
      <LanguageProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
