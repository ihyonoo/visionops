import React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsPage } from "../src/pages/ProjectsPage";
import { ProjectDetailPage } from "../src/pages/ProjectDetailPage";
import { StatusBadge } from "../src/components/StatusBadge";
import { LogViewer } from "../src/components/LogViewer";
import { TrainingRunPage } from "../src/pages/TrainingRunPage";
import { TrainingManagementPage } from "../src/pages/TrainingManagementPage";
import { Layout } from "../src/components/Layout";
import { TrainingQueueWidget } from "../src/components/TrainingQueueWidget";
import { LanguageProvider, useLanguage } from "../src/i18n/LanguageProvider";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import App from "../src/App";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

function render(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<LanguageProvider>{ui}</LanguageProvider>);
  });

  return { container, root };
}

afterEach(() => {
  if (typeof window.localStorage.removeItem === "function") {
    window.localStorage.removeItem("visionops-language");
  } else if (typeof window.localStorage.setItem === "function") {
    window.localStorage.setItem("visionops-language", "ko");
  }
  document.documentElement.lang = "ko";
  window.history.replaceState(null, "", "/");
});

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function EnglishHarness({ children }: { children: React.ReactNode }) {
  const { setLanguage } = useLanguage();
  React.useEffect(() => {
    setLanguage("en");
  }, [setLanguage]);
  return <>{children}</>;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  Simulate.change(input, {
    target: {
      value,
      valueAsNumber: Number(value),
    },
  } as never);
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(textarea, value);
  Simulate.change(textarea, {
    target: {
      value,
    },
  } as never);
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  valueSetter?.call(select, value);
  Simulate.change(select, {
    target: {
      value,
    },
  } as never);
}

function setFileInput(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  Simulate.change(input, {
    target: {
      files,
    },
  } as never);
}

function fileWithRelativePath(name: string, relativePath: string, contents: string, type: string) {
  const file = new File([contents], name, { type });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1000) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  throw lastError;
}

describe("StatusBadge", () => {
  it("renders Korean labels for known statuses", () => {
    const { container, root } = render(<StatusBadge status="running" />);

    expect(container.textContent).toContain("실행 중");
    expect(container.querySelector(".status-badge")?.getAttribute("data-tone")).toBe("info");

    act(() => root.unmount());
    container.remove();
  });
});

describe("ProjectsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders project cards with thumbnails and selects a project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-01T00:00:00Z",
              description: "라인 결함 탐지",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            },
          ]),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }),
    );
    const onSelectProject = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectsPage
        onProjectDeleted={vi.fn()}
        onSelectProject={onSelectProject}
        selectedProjectId={null}
      />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("검수 라인 A");
    });
    expect(container.textContent).not.toContain("2개 프로젝트");
    expect(container.textContent).not.toContain("작업 유형");
    expect(container.textContent).not.toContain("API");

    const projectCard = container.querySelector<HTMLButtonElement>("[data-project-row='project-1']");

    expect(projectCard).not.toBeNull();
    expect(projectCard?.getAttribute("role")).toBe("button");
    expect(projectCard?.getAttribute("aria-selected")).toBe("false");
    expect(
      container.querySelector<HTMLImageElement>("img[data-project-thumbnail='project-1']")?.src,
    ).toContain("/api/projects/project-1/thumbnail");

    act(() => {
      projectCard?.click();
    });

    expect(onSelectProject).toHaveBeenCalledWith("project-1");

    act(() => {
      projectCard?.click();
    });

    expect(onSelectProject).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
  });

  it("renders the main projects page in English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }),
    );

    const { container, root } = renderWithQuery(
      <EnglishHarness>
        <ProjectsPage
          onProjectDeleted={vi.fn()}
          onSelectProject={vi.fn()}
          selectedProjectId={null}
        />
      </EnglishHarness>,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Projects");
      expect(container.textContent).toContain("New project");
      expect(container.textContent).toContain("No projects");
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("New project"))
        ?.click();
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Create");
    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Cancel");

    expect(container.textContent).not.toContain("새 프로젝트");

    act(() => root.unmount());
    container.remove();
  });

  it("creates a project from the list modal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          description: "라인 결함 탐지",
          name: "검수 라인 A",
        });
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "라인 결함 탐지",
            id: "project-new",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-01T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        );
      }
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSelectProject = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectsPage
        onProjectDeleted={vi.fn()}
        onSelectProject={onSelectProject}
        selectedProjectId={null}
      />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("프로젝트");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("새 프로젝트"))
        ?.click();
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const fields = Array.from(dialog?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? []);
    const nameInput = fields.find(
      (field) => field.getAttribute("placeholder") === "프로젝트 이름을 입력하세요",
    ) as HTMLInputElement;
    const descriptionInput = fields.find(
      (field) => field.getAttribute("placeholder") === "프로젝트 설명을 입력하세요",
    ) as HTMLTextAreaElement;
    const form = dialog?.querySelector("form");

    act(() => {
      setInputValue(nameInput, "검수 라인 A");
      setTextareaValue(descriptionInput, "라인 결함 탐지");
    });
    await act(async () => {
      if (form) Simulate.submit(form);
    });

    await waitForAssertion(() => {
      expect(onSelectProject).toHaveBeenCalledWith("project-new");
      expect(container.querySelector("[role='dialog']")).toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });

  it("renames and deletes projects from the card action menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project-1") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          description: "수정된 설명",
          name: "수정된 프로젝트",
        });
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "수정된 설명",
            id: "project-1",
            name: "수정된 프로젝트",
            task_type: "detection",
            updated_at: "2026-07-03T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify([
          {
            created_at: "2026-07-01T00:00:00Z",
            description: "라인 결함 탐지",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          },
        ]),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const onProjectDeleted = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectsPage
        onProjectDeleted={onProjectDeleted}
        onSelectProject={vi.fn()}
        selectedProjectId="project-1"
      />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("검수 라인 A");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='검수 라인 A 프로젝트 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("이름 변경"))
        ?.click();
    });

    const editDialog = container.querySelector<HTMLElement>("[role='dialog']");
    const editName = editDialog?.querySelector<HTMLInputElement>("input");
    const editDescription = editDialog?.querySelector<HTMLTextAreaElement>("textarea");
    const editForm = editDialog?.querySelector("form");
    act(() => {
      setInputValue(editName!, "수정된 프로젝트");
      setTextareaValue(editDescription!, "수정된 설명");
    });
    await act(async () => {
      if (editForm) Simulate.submit(editForm);
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1") && init?.method === "PATCH",
        ),
      ).toBe(true);
      expect(container.querySelector("[role='dialog']")).toBeNull();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='검수 라인 A 프로젝트 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain(
      "관리 중인 로컬 파일이 모두 삭제됩니다.",
    );
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".danger-button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(onProjectDeleted).toHaveBeenCalledWith("project-1");
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1") && init?.method === "DELETE",
        ),
      ).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });
});

describe("Layout", () => {
  it("shows global navigation before a project is selected", () => {
    const onNavigate = vi.fn();
    const { container, root } = render(
      <Layout
        activeSection="projects"
        onNavigate={onNavigate}
        title="프로젝트"
      >
        <div />
      </Layout>,
    );

    expect(container.querySelector(".sidebar")).toBeNull();
    expect(container.textContent).toContain("VisionOps");
    expect(container.textContent).not.toContain("운영 콘솔");
    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='VisionOps']")?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("projects");
    expect(container.textContent).toContain("프로젝트");
    expect(container.textContent).toContain("데이터셋");
    expect(container.textContent).toContain("학습");
    expect(container.textContent).toContain("추론");

    act(() => root.unmount());
    container.remove();
  });

  it("sorts projects in the sidebar and keeps hidden projects at the bottom", () => {
    const onSelectProject = vi.fn();
    const onToggleProjectHidden = vi.fn();
    const onProjectSortChange = vi.fn();
    const onCreateProject = vi.fn();
    const projects = [
      {
        created_at: "2026-07-01T00:00:00Z",
        description: "B",
        id: "project-b",
        name: "Beta",
        task_type: "detection",
        updated_at: "2026-07-01T00:00:00Z",
      },
      {
        created_at: "2026-07-01T00:00:00Z",
        description: "A",
        id: "project-a",
        name: "Alpha",
        task_type: "detection",
        updated_at: "2026-07-03T00:00:00Z",
      },
      {
        created_at: "2026-07-01T00:00:00Z",
        description: "G",
        id: "project-g",
        name: "Gamma",
        task_type: "detection",
        updated_at: "2026-07-02T00:00:00Z",
      },
    ];

    const { container, root } = render(
      <Layout
        activeSection="datasets"
        hiddenProjectIds={["project-a"]}
        onCreateProject={onCreateProject}
        onNavigate={vi.fn()}
        onProjectSortChange={onProjectSortChange}
        onSelectProject={onSelectProject}
        onToggleProjectHidden={onToggleProjectHidden}
        projects={projects}
        projectSort="name_asc"
        selectedProjectId="project-b"
        title="데이터셋"
      >
        <div />
      </Layout>,
    );

    const projectNames = Array.from(
      container.querySelectorAll<HTMLElement>(".project-sidebar__row strong"),
    ).map((element) => element.textContent);
    expect(projectNames).toEqual(["Beta", "Gamma", "Alpha"]);

    const hiddenProjectButton = container.querySelector<HTMLButtonElement>(
      ".project-sidebar__row[data-hidden='true'] .project-sidebar__project",
    );
    expect(hiddenProjectButton?.disabled).toBe(true);

    act(() => {
      hiddenProjectButton?.click();
    });
    expect(onSelectProject).not.toHaveBeenCalledWith("project-a");

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='Beta 숨기기']")?.click();
    });
    expect(onToggleProjectHidden).toHaveBeenCalledWith("project-b");

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".project-sidebar__tools button"))
        .find((button) => button.textContent === "최신순")
        ?.click();
    });
    expect(onProjectSortChange).toHaveBeenCalledWith("updated_desc");

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='새 프로젝트']")?.click();
    });
    expect(onCreateProject).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("resizes, persists, collapses, and restores the project sidebar by dragging", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const projects = [
      {
        created_at: "2026-07-01T00:00:00Z",
        description: "",
        id: "project-a",
        name: "Alpha",
        task_type: "detection",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ];

    const { container, root } = render(
      <Layout activeSection="datasets" onNavigate={vi.fn()} projects={projects} title="데이터셋">
        <div />
      </Layout>,
    );

    const workspaceBody = container.querySelector<HTMLElement>(".workspace-body");
    const resizeHandle = container.querySelector<HTMLElement>(".project-sidebar__resize-handle");
    expect(workspaceBody?.style.getPropertyValue("--project-sidebar-width")).toBe("260px");
    expect(resizeHandle).not.toBeNull();

    act(() => {
      resizeHandle?.dispatchEvent(new MouseEvent("pointerdown", { clientX: 260, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 360, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(workspaceBody?.style.getPropertyValue("--project-sidebar-width")).toBe("360px");
    expect(localStorage.getItem("visionops:project-sidebar-width")).toBe("360");
    expect(container.querySelector("[aria-label='프로젝트 사이드바 접기']")).toBeNull();
    expect(container.querySelector("[aria-label='프로젝트 사이드바 펼치기']")).toBeNull();

    act(() => {
      resizeHandle?.dispatchEvent(new MouseEvent("pointerdown", { clientX: 360, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(workspaceBody?.dataset.sidebarCollapsed).toBe("true");
    expect(container.querySelector(".project-sidebar")).toBeNull();
    expect(container.querySelector(".project-sidebar-rail")).not.toBeNull();
    expect(localStorage.getItem("visionops:project-sidebar-collapsed")).toBe("true");

    const railResizeHandle = container.querySelector<HTMLElement>(
      ".project-sidebar-rail__resize-handle",
    );
    expect(railResizeHandle).not.toBeNull();

    act(() => {
      railResizeHandle?.dispatchEvent(new MouseEvent("pointerdown", { clientX: 44, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(workspaceBody?.dataset.sidebarCollapsed).toBeUndefined();
    expect(container.querySelector(".project-sidebar")).not.toBeNull();
    expect(workspaceBody?.style.getPropertyValue("--project-sidebar-width")).toBe("300px");
    expect(localStorage.getItem("visionops:project-sidebar-collapsed")).toBe("false");
    expect(localStorage.getItem("visionops:project-sidebar-width")).toBe("300");

    act(() => root.unmount());
    container.remove();
  });

  it("opens notification settings from the header action", () => {
    const onOpenNotificationSettings = vi.fn();
    const { container, root } = render(
      <Layout
        activeSection="projects"
        onOpenNotificationSettings={onOpenNotificationSettings}
        onNavigate={vi.fn()}
        title="프로젝트"
      >
        <div />
      </Layout>,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='알림 설정']")?.click();
    });

    expect(onOpenNotificationSettings).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  });

  it("opens theme controls from the settings button", () => {
    const { container, root } = render(
      <ThemeProvider>
        <Layout
          activeSection="projects"
          onNavigate={vi.fn()}
          title="프로젝트"
        >
          <div />
        </Layout>
      </ThemeProvider>,
    );

    expect(container.querySelector(".theme-control")).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='설정']")?.click();
    });

    const themeControl = container.querySelector(".theme-control");
    expect(themeControl?.textContent).toContain("밝게");
    expect(themeControl?.textContent).toContain("어둡게");
    expect(themeControl?.textContent).toContain("시스템");

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".theme-control__button"))
        .find((button) => button.textContent?.includes("어둡게"))
        ?.click();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => root.unmount());
    container.remove();
  });

  it("switches the application language from settings", () => {
    const { container, root } = render(
      <ThemeProvider>
        <Layout
          activeSection="projects"
          onNavigate={vi.fn()}
          title="프로젝트"
        >
          <div />
        </Layout>
      </ThemeProvider>,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='설정']")?.click();
    });

    expect(container.textContent).toContain("언어");
    expect(container.textContent).toContain("한국어");
    expect(container.textContent).toContain("English");

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".language-control button"))
        .find((button) => button.textContent?.includes("English"))
        ?.click();
    });

    expect(document.documentElement.lang).toBe("en");
    expect(container.querySelector("[aria-label='Dataset management']")).not.toBeNull();
    expect(container.textContent).toContain("Theme");
    expect(container.textContent).toContain("Language");

    act(() => root.unmount());
    container.remove();
  });
});

describe("TrainingQueueWidget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("summarizes global training runs and opens a selected run", async () => {
    const onOpenRun = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/runtime/check")) {
          return new Response(
            JSON.stringify({
              devices: [{ available: true, details: {}, id: "cpu", kind: "cpu", label: "CPU" }],
              install_options: [],
              install_required: false,
              packages: {
                torch: { installed: true, version: "2.8.0" },
                torchvision: { installed: true, version: "0.23.0" },
                ultralytics: { installed: true, version: "8.3.0" },
              },
              python: {},
              ready: true,
              yolo_cli: { installed: true, path: "/usr/local/bin/yolo" },
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(
            JSON.stringify([
              {
                artifact_path: null,
                config: {},
                created_at: "2026-07-05T00:00:00Z",
                dataset_id: "dataset-1",
                finished_at: null,
                id: "run-1",
                log_path: null,
                metrics_summary: {},
                model_name: "yolo11n",
                name: "라인 A 학습",
                project_id: "project-1",
                split_id: "split-1",
                started_at: "2026-07-05T00:00:00Z",
                status: "running",
                trainer: "ultralytics",
                updated_at: "2026-07-05T00:01:00Z",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-2/training-runs")) {
          return new Response(
            JSON.stringify([
              {
                artifact_path: null,
                config: {},
                created_at: "2026-07-05T00:00:00Z",
                dataset_id: "dataset-2",
                finished_at: null,
                id: "run-2",
                log_path: null,
                metrics_summary: {},
                model_name: "yolo11n",
                name: "라인 B 학습",
                project_id: "project-2",
                split_id: "split-2",
                started_at: null,
                status: "queued",
                trainer: "ultralytics",
                updated_at: "2026-07-05T00:00:30Z",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <TrainingQueueWidget
        onOpenRun={onOpenRun}
        projects={[
          {
            created_at: "2026-07-05T00:00:00Z",
            description: "",
            id: "project-1",
            name: "프로젝트 A",
            task_type: "detection",
            updated_at: "2026-07-05T00:00:00Z",
          },
          {
            created_at: "2026-07-05T00:00:00Z",
            description: "",
            id: "project-2",
            name: "프로젝트 B",
            task_type: "detection",
            updated_at: "2026-07-05T00:00:00Z",
          },
        ]}
      />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("학습: 실행 1 · 대기 1 · 실패 0 · 최근 라인 A 학습");
      expect(container.textContent).toContain("환경: PyTorch 2.8.0 · Ultralytics 8.3.0 · YOLO OK · CPU");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(".training-queue-widget__summary")?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("라인 A 학습");
      expect(container.textContent).toContain("라인 B 학습");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".training-queue-widget__row"))
        .find((button) => button.textContent?.includes("라인 B 학습"))
        ?.click();
    });

    expect(onOpenRun).toHaveBeenCalledWith("project-2", "run-2");

    act(() => root.unmount());
    container.remove();
  });
});

describe("App navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a centered no-project state on project-scoped pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    window.history.replaceState(null, "", "/datasets");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<App />);
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/datasets");
      expect(container.textContent).toContain("프로젝트가 선택되지 않았습니다");
      expect(container.textContent).toContain("프로젝트 선택");
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>(".top-nav__button")).find(
          (button) => button.textContent?.includes("데이터셋"),
        )?.getAttribute("aria-current"),
      ).toBe("page");
    });

    act(() => root.unmount());
    container.remove();
  });

  it("routes notification settings as a global settings page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/projects")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/notification-settings")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings/notifications");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<App />);
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/settings/notifications");
      expect(container.textContent).toContain("알림 설정");
      expect(container.textContent).not.toContain("프로젝트가 선택되지 않았습니다");
      expect(container.querySelector(".project-sidebar")).toBeNull();
      expect(container.querySelector("[aria-label='알림 설정']")?.getAttribute("aria-current")).toBe(
        "page",
      );
    });

    act(() => root.unmount());
    container.remove();
  });

  it("creates a project from the project sidebar on scoped pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-05T00:00:00Z",
            description: "새 라인",
            id: "project-new",
            name: "새 검사 프로젝트",
            task_type: "detection",
            updated_at: "2026-07-05T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        );
      }
      if (url.endsWith("/api/projects")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-new")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-05T00:00:00Z",
            description: "새 라인",
            id: "project-new",
            name: "새 검사 프로젝트",
            task_type: "detection",
            updated_at: "2026-07-05T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-new/datasets")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.includes("/api/projects/project-new/training-runs")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.includes("/api/projects/project-new/inference-runs")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/runtime/check")) {
        return new Response(
          JSON.stringify({
            devices: [],
            install_options: [],
            install_required: false,
            packages: {},
            python: {},
            ready: true,
            yolo_cli: {},
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/datasets");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<App />);
    });

    await waitForAssertion(() => {
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.textContent).toContain("프로젝트가 선택되지 않았습니다");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(".project-sidebar__create")?.click();
    });

    await waitForAssertion(() => {
      expect(container.querySelector("[role='dialog']")).not.toBeNull();
    });

    const nameInput = container.querySelector<HTMLInputElement>(
      "input[placeholder='프로젝트 이름을 입력하세요']",
    );
    const descriptionInput = container.querySelector<HTMLTextAreaElement>(
      "textarea[placeholder='프로젝트 설명을 입력하세요']",
    );
    expect(nameInput).not.toBeNull();

    act(() => {
      setInputValue(nameInput as HTMLInputElement, "새 검사 프로젝트");
      setTextareaValue(descriptionInput as HTMLTextAreaElement, "새 라인");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("생성"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-new/datasets");
      expect(fetchMock.mock.calls.some(([url, init]) =>
        String(url).endsWith("/api/projects") && init?.method === "POST",
      )).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });

  it("returns to the project list on browser back from a project detail page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "라인 결함 탐지",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects")) {
          return new Response(
            JSON.stringify([
              {
                created_at: "2026-07-01T00:00:00Z",
                description: "라인 결함 탐지",
                id: "project-1",
                name: "검수 라인 A",
                task_type: "detection",
                updated_at: "2026-07-02T00:00:00Z",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "라인 A",
              root_path: "/tmp/project-1",
              updated_at: "2026-07-01T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/api/projects/project-1/inference-runs")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/runtime/check")) {
          return new Response(
            JSON.stringify({
              devices: [],
              install_options: [],
              install_required: false,
              packages: {},
              python: {},
              ready: true,
              yolo_cli: {},
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<App />);
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("검수 라인 A");
    });

    act(() => {
      container.querySelector<HTMLElement>("[data-project-row='project-1']")?.click();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-1/datasets");
      expect(container.textContent).toContain("데이터셋");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".top-nav__button"))
        .find((button) => button.textContent?.includes("학습"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-1/training");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".top-nav__button"))
        .find((button) => button.textContent?.includes("추론"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-1/inference");
    });

    act(() => {
      window.history.back();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-1/training");
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>(".top-nav__button")).find((button) =>
          button.textContent?.includes("학습"),
        )?.getAttribute("aria-current"),
      ).toBe("page");
    });

    act(() => {
      window.history.back();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/projects/project-1/datasets");
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>(".top-nav__button")).find((button) =>
          button.textContent?.includes("데이터셋"),
        )?.getAttribute("aria-current"),
      ).toBe("page");
    });

    act(() => {
      window.history.back();
    });

    await waitForAssertion(() => {
      expect(window.location.pathname).toBe("/");
      expect(container.querySelector("[data-project-row='project-1']")).not.toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });
});

describe("ProjectDetailPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows dataset inventory summary inside each dataset row", async () => {
    const dataset = {
      class_names: ["scratch", "dent", "void", "stain"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 12,
      label_count: 11,
      name: "불량 샘플",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: {
        errors: [],
        warnings: ["Missing label for image: images/missing.jpg"],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([dataset]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
          return new Response(JSON.stringify(dataset), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const onTabChange = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={onTabChange} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("불량 샘플");
    });

    const datasetRow = container.querySelector<HTMLElement>(".dataset-row");
    expect(datasetRow?.textContent).toContain("이미지 12");
    expect(datasetRow?.textContent).toContain("라벨 11");
    expect(datasetRow?.textContent).toContain("클래스 4");
    expect(datasetRow?.textContent).toContain("scratch");
    expect(datasetRow?.textContent).toContain("dent");
    expect(datasetRow?.textContent).toContain("void");
    expect(datasetRow?.textContent).toContain("stain");
    expect(datasetRow?.textContent).not.toContain("+1");
    expect(datasetRow?.textContent).not.toContain("경고 1건");
    expect(datasetRow?.textContent).not.toContain("유효성 검사 성공");
    expect(container.textContent).not.toContain("요약 지표");

    act(() => root.unmount());
    container.remove();
  });

  it("toggles split controls from each dataset row", async () => {
    const dataset = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 10,
      label_count: 10,
      name: "dataset",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: { errors: [], warnings: [] },
    };
    const split = {
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      dataset_yaml_path: "/tmp/data.yaml",
      id: "split-1",
      name: "기본 split",
      seed: 42,
      split_path: "/tmp/split",
      train_count: 8,
      train_ratio: 0.8,
      test_count: 0,
      test_ratio: 0,
      val_count: 2,
      val_ratio: 0.2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([dataset]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
          return new Response(JSON.stringify(dataset), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
          return new Response(JSON.stringify([split]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const onTabChange = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={onTabChange} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Split 목록 열기 · 1개");
    });

    const datasetRow = container.querySelector<HTMLElement>(".dataset-row");
    expect(datasetRow?.textContent).not.toContain("기본 split");
    expect(datasetRow?.textContent).toContain("Split 목록 열기 · 1개");
    const datasetActions = datasetRow?.querySelector<HTMLElement>(".dataset-row__actions");
    expect(datasetActions).not.toBeNull();
    expect(datasetActions!.textContent).toContain("Split 목록 열기 · 1개");
    expect(datasetActions!.querySelector("[aria-label='dataset 데이터셋 작업']")).not.toBeNull();
    const actionButtons = Array.from(datasetActions!.querySelectorAll("button"));
    expect(actionButtons[0]?.getAttribute("aria-label")).toBe("dataset 데이터셋 작업");
    expect(actionButtons[actionButtons.length - 1]?.textContent).toContain("Split 목록 열기 · 1개");
    expect(container.querySelector(".dataset-row-detail")).toBeNull();
    expect(container.querySelectorAll(".split-form")).toHaveLength(0);

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='dataset split 설정']")?.click();
    });

    const splitDetail = container.querySelector<HTMLElement>(".dataset-row-detail");
    expect(splitDetail?.closest(".dataset-list")).not.toBeNull();
    expect(datasetRow?.textContent).toContain("Split 목록 접기 · 1개");
    expect(splitDetail?.textContent).toContain("Split 생성");
    expect(splitDetail?.textContent).toContain("기본 split");
    expect(splitDetail?.textContent).toContain("8 / 2 / 0");
    expect(splitDetail?.textContent).toContain("이 Split으로 학습");
    expect(splitDetail?.querySelector("[aria-label='기본 split split 작업']")).not.toBeNull();
    expect(container.querySelectorAll(".split-form")).toHaveLength(0);

    act(() => {
      Array.from(splitDetail?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("이 Split으로 학습"))
        ?.click();
    });

    expect(onTabChange).toHaveBeenCalledWith("training");

    act(() => {
      Array.from(splitDetail?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.includes("Split 생성"))
        ?.click();
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Split 생성");
    expect(container.querySelectorAll(".split-form")).toHaveLength(1);

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='Split 생성 닫기']")?.click();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='dataset split 설정']")?.click();
    });

    expect(container.querySelector(".dataset-row-detail")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("renames and deletes splits from the split row action menu", async () => {
    const dataset = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 10,
      label_count: 10,
      name: "dataset",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: { errors: [], warnings: [] },
    };
    const split = {
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      dataset_yaml_path: "/tmp/data.yaml",
      id: "split-1",
      name: "기본 split",
      seed: 42,
      split_path: "/tmp/split",
      train_count: 8,
      train_ratio: 0.8,
      test_count: 0,
      test_ratio: 0,
      val_count: 2,
      val_ratio: 0.2,
    };
    const renamedSplit = { ...split, name: "수정 split" };
    let currentSplits = [split];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([dataset]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
        return new Response(JSON.stringify(dataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        url.endsWith("/api/projects/project-1/datasets/dataset-1/splits/split-1") &&
        init?.method === "PATCH"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({ name: "수정 split" });
        currentSplits = [renamedSplit];
        return new Response(JSON.stringify(renamedSplit), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        url.endsWith("/api/projects/project-1/datasets/dataset-1/splits/split-1") &&
        init?.method === "DELETE"
      ) {
        currentSplits = [];
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
        return new Response(JSON.stringify(currentSplits), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Split 목록 열기 · 1개");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='dataset split 설정']")?.click();
    });
    await waitForAssertion(() => {
      expect(container.textContent).toContain("기본 split");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='기본 split split 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("이름 변경"))
        ?.click();
    });
    const editDialog = container.querySelector<HTMLElement>("[role='dialog']");
    const editName = editDialog?.querySelector<HTMLInputElement>("input");
    const editForm = editDialog?.querySelector("form");
    act(() => {
      setInputValue(editName!, "수정 split");
    });
    await act(async () => {
      if (editForm) Simulate.submit(editForm);
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("수정 split");
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets/dataset-1/splits/split-1") &&
            init?.method === "PATCH",
        ),
      ).toBe(true);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='수정 split split 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });
    expect(container.querySelector("[role='dialog']")?.textContent).toContain("수정 split");
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".danger-button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets/dataset-1/splits/split-1") &&
            init?.method === "DELETE",
        ),
      ).toBe(true);
      expect(container.textContent).not.toContain("수정 split");
    });

    act(() => root.unmount());
    container.remove();
  });

  it("renames and deletes datasets from the row action menu", async () => {
    const dataset = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 10,
      label_count: 10,
      name: "기존 데이터셋",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: { errors: [], warnings: [] },
    };
    const renamedDataset = {
      ...dataset,
      name: "수정된 데이터셋",
    };
    let currentDatasets = [dataset];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ name: "수정된 데이터셋" });
        currentDatasets = [renamedDataset];
        return new Response(JSON.stringify(renamedDataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1") && init?.method === "DELETE") {
        currentDatasets = [];
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify(currentDatasets), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
        return new Response(JSON.stringify(currentDatasets[0] ?? renamedDataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("기존 데이터셋");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='기존 데이터셋 데이터셋 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("이름 변경"))
        ?.click();
    });

    const editDialog = container.querySelector<HTMLElement>("[role='dialog']");
    const editName = editDialog?.querySelector<HTMLInputElement>("input");
    const editForm = editDialog?.querySelector("form");
    act(() => {
      setInputValue(editName!, "수정된 데이터셋");
    });
    await act(async () => {
      if (editForm) Simulate.submit(editForm);
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("수정된 데이터셋");
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets/dataset-1") &&
            init?.method === "PATCH",
        ),
      ).toBe(true);
      expect(container.querySelector("[role='dialog']")).toBeNull();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='수정된 데이터셋 데이터셋 작업']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain(
      "이 데이터셋의 split, 학습 실행, 추론 결과",
    );
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".danger-button"))
        .find((button) => button.textContent?.includes("삭제"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets/dataset-1") &&
            init?.method === "DELETE",
        ),
      ).toBe(true);
      expect(container.querySelector(".dataset-row")).toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });

  it("prevents split creation when ratios do not sum to one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const dataset = {
          class_names: ["scratch"],
          created_at: "2026-07-02T00:00:00Z",
          format: "yolo",
          id: "dataset-1",
          image_count: 10,
          label_count: 10,
          name: "dataset",
          project_id: "project-1",
          source_path: "/data/project-1",
          validation_status: "valid",
          validation_summary: {
            errors: [],
            warnings: [],
          },
        };

        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }

        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([dataset]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
          return new Response(JSON.stringify(dataset), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <ProjectDetailPage
        activeTab="datasets"
        onTabChange={vi.fn()}
        projectId="project-1"
      />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("dataset");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='dataset split 설정']")?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("Split 생성"))
        ?.click();
    });

    const ratioInputs = Array.from(container.querySelectorAll<HTMLInputElement>(".split-form input"));
    const nameInput = ratioInputs[0];
    const trainInput = ratioInputs[1];
    const valInput = ratioInputs[2];
    const testInput = ratioInputs[3];
    const seedInput = ratioInputs[4];
    const splitButton = container.querySelector<HTMLButtonElement>(".split-form .primary-button");

    expect(container.querySelector(".split-form")?.textContent).toContain("Test");
    expect(testInput?.value).toBe("");
    expect(splitButton?.disabled).toBe(true);

    act(() => {
      setInputValue(nameInput as HTMLInputElement, "검증 split");
      setInputValue(trainInput as HTMLInputElement, "0.8");
      setInputValue(valInput as HTMLInputElement, "0.2");
      setInputValue(testInput as HTMLInputElement, "0.1");
      setInputValue(seedInput as HTMLInputElement, "42");
    });

    expect(container.textContent).toContain("합은 1.0");
    expect(splitButton?.disabled).toBe(true);

    act(() => root.unmount());
    container.remove();
  });

  it("keeps a newly created dataset selected before the list refetch finishes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const existingDataset = {
        class_names: ["scratch"],
        created_at: "2026-07-02T00:00:00Z",
        format: "yolo",
        id: "dataset-old",
        image_count: 4,
        label_count: 4,
        name: "기존 데이터셋",
        project_id: "project-1",
        source_path: "/data/old",
        validation_status: "valid",
        validation_summary: { errors: [], warnings: [] },
      };
      const newDataset = {
        ...existingDataset,
        id: "dataset-new",
        name: "새 데이터셋",
        source_path: "/data/new",
      };

      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets/upload") && init?.method === "POST") {
        const body = init.body as FormData;
        expect(body.get("name")).toBe("새 데이터셋");
        expect(body.getAll("images")).toHaveLength(1);
        expect(body.getAll("labels")).toHaveLength(1);
        expect(body.get("data_yaml")).toBeInstanceOf(File);
        return new Response(JSON.stringify(newDataset), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([existingDataset]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-old")) {
        return new Response(JSON.stringify(existingDataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-new")) {
        return new Response(JSON.stringify(newDataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.includes("/splits")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("기존 데이터셋");
    });
    expect(
      container.querySelector<HTMLImageElement>(
        "img[data-dataset-thumbnail='dataset-old']",
      )?.src,
    ).toContain("/api/projects/project-1/datasets/dataset-old/thumbnail");

    expect(container.querySelector("[role='dialog']")).toBeNull();
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("데이터셋 등록"))
        ?.click();
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.textContent).toContain("데이터 업로드");

    const fields = Array.from(dialog?.querySelectorAll<HTMLInputElement>("input") ?? []);
    const datasetNameInput = fields.find((input) => input.placeholder === "데이터셋 이름을 입력하세요");
    const imagesInput = dialog?.querySelector<HTMLInputElement>("[aria-label='이미지 폴더 선택']");
    const labelsInput = dialog?.querySelector<HTMLInputElement>("[aria-label='라벨 폴더 선택']");
    const dataYamlInput = dialog?.querySelector<HTMLInputElement>("[aria-label='data.yaml']");
    const datasetForm = datasetNameInput?.closest("form");

    act(() => {
      setInputValue(datasetNameInput!, "새 데이터셋");
      setFileInput(imagesInput!, [
        fileWithRelativePath("part.jpg", "images/nested/part.jpg", "image", "image/jpeg"),
      ]);
      setFileInput(labelsInput!, [
        fileWithRelativePath(
          "part.txt",
          "labels/nested/part.txt",
          "0 0.5 0.5 0.25 0.25\n",
          "text/plain",
        ),
      ]);
      setFileInput(dataYamlInput!, [new File(["names:\n  - scratch\n"], "data.yaml", { type: "text/yaml" })]);
    });

    act(() => {
      if (datasetForm) Simulate.submit(datasetForm);
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets") && init?.method === "POST",
        ),
      ).toBe(false);
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets/upload") &&
            init?.method === "POST",
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/datasets") && init?.method !== "POST",
        ).length,
      ).toBeGreaterThanOrEqual(2);

      const selectedRows = Array.from(container.querySelectorAll<HTMLElement>(".dataset-row")).filter(
        (row) => row.dataset.selected === "true",
      );
      expect(selectedRows[0]?.textContent).toContain("새 데이터셋");
      expect(container.querySelector("[role='dialog']")).toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });

  it("requires choosing a split before opening the training modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const dataset = {
          class_names: ["scratch"],
          created_at: "2026-07-02T00:00:00Z",
          format: "yolo",
          id: "dataset-1",
          image_count: 10,
          label_count: 10,
          name: "라인 A 데이터셋",
          project_id: "project-1",
          source_path: "/data/project-1",
          validation_status: "valid",
          validation_summary: { errors: [], warnings: [] },
        };

        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([dataset]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
          return new Response(JSON.stringify(dataset), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="training" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("새 학습 실행");
      expect(container.querySelector("[role='dialog']")).toBeNull();
      expect(container.textContent).toContain("Split 선택");
      expect(container.textContent).toContain("학습에 사용할 Split을 먼저 생성하세요.");
    });

    const openDrawerButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("새 학습 실행"),
    );
    expect(openDrawerButton?.disabled).toBe(true);
    act(() => {
      openDrawerButton?.click();
    });

    expect(container.querySelector("[role='dialog']")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("shows the live training terminal for the selected split", async () => {
    const dataset = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 20,
      label_count: 20,
      name: "라인 A 데이터셋",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: { errors: [], warnings: [] },
    };
    const splitA = {
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      dataset_yaml_path: "/tmp/data-a.yaml",
      id: "split-a",
      name: "Split A",
      seed: 42,
      split_path: "/tmp/split-a",
      train_count: 8,
      train_ratio: 0.8,
      test_count: 0,
      test_ratio: 0,
      val_count: 2,
      val_ratio: 0.2,
    };
    const splitB = {
      ...splitA,
      dataset_yaml_path: "/tmp/data-b.yaml",
      id: "split-b",
      name: "Split B",
      split_path: "/tmp/split-b",
    };
    const runForSplitA = {
      artifact_path: null,
      config: {},
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: null,
      id: "run-a",
      log_path: "/tmp/run-a/logs/stdout.log",
      metrics_summary: {},
      model_name: "yolo11n",
      name: "Split A 학습",
      project_id: "project-1",
      split_id: "split-a",
      started_at: "2026-07-02T00:00:00Z",
      status: "running",
      trainer: "ultralytics",
      updated_at: "2026-07-02T00:01:00Z",
    };
    const runForSplitB = {
      ...runForSplitA,
      created_at: "2026-07-02T00:03:00Z",
      id: "run-b",
      log_path: "/tmp/run-b/logs/stdout.log",
      name: "Split B 학습",
      split_id: "split-b",
      updated_at: "2026-07-02T00:04:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/runtime/check")) {
        return new Response(
          JSON.stringify({
            devices: [{ available: true, details: {}, id: "cpu", kind: "cpu", label: "CPU" }],
            install_options: [],
            install_required: false,
            packages: {},
            python: { executable: "/usr/bin/python", version: "3.11.0" },
            ready: true,
            yolo_cli: { installed: true, path: "/tmp/yolo" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([dataset]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
        return new Response(JSON.stringify(dataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
        return new Response(JSON.stringify([splitA, splitB]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs")) {
        return new Response(JSON.stringify([runForSplitB, runForSplitA]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs/run-a/logs?tail=200")) {
        return new Response(JSON.stringify({ lines: ["split-a live log"], offset: 16 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs/run-b/logs?tail=200")) {
        return new Response(JSON.stringify({ lines: ["split-b live log"], offset: 16 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="training" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Split A 학습");
      expect(container.textContent).toContain("split-a live log");
      expect(container.textContent).not.toContain("Split B 학습");
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/api/projects/project-1/training-runs/run-a/logs?tail=200"),
        ),
      ).toBe(true);
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".training-split-option"))
        .find((button) => button.textContent?.includes("Split B"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Split B 학습");
      expect(container.textContent).toContain("split-b live log");
      expect(container.textContent).not.toContain("split-a live log");
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/api/projects/project-1/training-runs/run-b/logs?tail=200"),
        ),
      ).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });

  it("shows project training results and downloadable artifacts in training management", async () => {
    const trainingRuns = [
      {
        artifact_path: "/tmp/train/run-a",
        config: {
          amp: true,
          batch: 16,
          device: "cpu",
          epochs: 50,
          imgsz: 640,
          learning_rate: 0.01,
          optimizer: "AdamW",
          seed: 42,
        },
        created_at: "2026-07-02T00:00:00Z",
        dataset_id: "dataset-1",
        finished_at: "2026-07-02T00:10:00Z",
        id: "run-a",
        log_path: null,
        metrics_summary: {
          best_mAP50: 0.94,
          best_precision: 0.91,
          best_recall: 0.88,
          last_epoch: 48,
        },
        model_name: "yolo11n",
        name: "B 실험",
        project_id: "project-1",
        split_id: "split-1",
        started_at: "2026-07-02T00:00:00Z",
        status: "completed",
        trainer: "ultralytics",
        updated_at: "2026-07-02T00:10:00Z",
      },
      {
        artifact_path: "/tmp/train/run-b",
        config: {},
        created_at: "2026-07-01T00:00:00Z",
        dataset_id: "dataset-1",
        finished_at: "2026-07-01T00:10:00Z",
        id: "run-b",
        log_path: null,
        metrics_summary: {
          best_mAP50: 0.98,
          best_precision: 0.89,
          best_recall: 0.93,
        },
        model_name: "yolo11s",
        name: "A 실험",
        project_id: "project-1",
        split_id: "split-1",
        started_at: "2026-07-01T00:00:00Z",
        status: "completed",
        trainer: "ultralytics",
        updated_at: "2026-07-01T00:10:00Z",
      },
      {
        artifact_path: "/tmp/train/run-c",
        config: {},
        created_at: "2026-07-03T00:00:00Z",
        dataset_id: "dataset-1",
        finished_at: "2026-07-03T00:10:00Z",
        id: "run-c",
        log_path: null,
        metrics_summary: {
          best_mAP50: 0.72,
          best_precision: 0.96,
          best_recall: 0.75,
        },
        model_name: "yolo11n",
        name: "C 실험",
        project_id: "project-1",
        split_id: "split-1",
        started_at: "2026-07-03T00:00:00Z",
        status: "failed",
        trainer: "ultralytics",
        updated_at: "2026-07-03T00:10:00Z",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects")) {
          return new Response(
            JSON.stringify([
              {
                created_at: "2026-07-01T00:00:00Z",
                description: "",
                id: "project-1",
                name: "라인 A",
                root_path: "/tmp/project-1",
                updated_at: "2026-07-01T00:00:00Z",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "라인 A",
              root_path: "/tmp/project-1",
              updated_at: "2026-07-01T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify(trainingRuns), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-a")) {
          const trainingRun = trainingRuns.find((run) => run.id === "run-a");
          return new Response(JSON.stringify(trainingRun), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/metrics")) {
          return new Response(
            JSON.stringify({
              rows: [{ epoch: 48, "metrics/mAP50(B)": 0.94 }],
              summary: { best_mAP50: 0.94 },
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.includes("/downloads")) {
          return new Response(
            JSON.stringify([
              {
                filename: "results.csv",
                kind: "metrics",
                label: "results.csv",
                url: "/api/projects/project-1/training-runs/run-a/results.csv",
              },
              {
                filename: "best.pt",
                kind: "model_best",
                label: "best.pt",
                url: "/api/projects/project-1/training-runs/run-a/artifacts/artifact-best/download",
              },
              {
                filename: "last.pt",
                kind: "model_last",
                label: "last.pt",
                url: "/api/projects/project-1/training-runs/run-a/artifacts/artifact-last/download",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.includes("/logs?tail=200")) {
          return new Response(JSON.stringify({ lines: [], offset: 0 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const onOpenRun = vi.fn();
    const { container, root } = renderWithQuery(
      <TrainingManagementPage onOpenRun={onOpenRun} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("학습 결과 목록");
      expect(container.textContent).toContain("라인 A");
      expect(container.textContent).toContain("B 실험");
      expect(container.textContent).toContain("A 실험");
      expect(container.textContent).toContain("C 실험");
      expect(container.textContent).toContain("정렬");
      expect(container.textContent).toContain("mAP50 높은순");
      expect(container.querySelector(".training-result-card")).not.toBeNull();
      expect(
        container.querySelector<HTMLImageElement>("img[data-training-thumbnail='run-a']")?.src,
      ).toContain("/api/projects/project-1/training-runs/run-a/thumbnail");
      expect(container.textContent).toContain("mAP50");
      expect(container.textContent).toContain("0.9400");
      expect(container.textContent).toContain("Precision");
      expect(container.textContent).toContain("0.9100");
      expect(container.textContent).not.toContain("AdamW");
      expect(container.textContent).not.toContain("results.csv");
      expect(container.textContent).not.toContain("best.pt");
      expect(container.textContent).not.toContain("last.pt");
    });
    const cardTitles = () =>
      Array.from(container.querySelectorAll(".training-result-card__title strong")).map(
        (element) => element.textContent,
      );
    expect(cardTitles()).toEqual(["C 실험", "B 실험", "A 실험"]);

    const sortSelect = container.querySelector<HTMLSelectElement>("select[aria-label='정렬']");
    expect(sortSelect).not.toBeNull();
    act(() => {
      (sortSelect as HTMLSelectElement).value = "map50";
      Simulate.change(sortSelect as HTMLSelectElement);
    });
    expect(cardTitles()).toEqual(["A 실험", "B 실험", "C 실험"]);

    act(() => {
      (sortSelect as HTMLSelectElement).value = "name";
      Simulate.change(sortSelect as HTMLSelectElement);
    });
    expect(cardTitles()).toEqual(["A 실험", "B 실험", "C 실험"]);

    const card = container.querySelector<HTMLButtonElement>(".training-result-card");
    expect(card).not.toBeNull();
    act(() => {
      Simulate.click(card as HTMLButtonElement);
    });
    expect(onOpenRun).toHaveBeenCalledWith("project-1", "run-b");

    act(() => root.unmount());
    container.remove();
  });

  it("runs training preflight before creating a training run", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const dataset = {
        class_names: ["scratch"],
        created_at: "2026-07-02T00:00:00Z",
        format: "yolo",
        id: "dataset-1",
        image_count: 10,
        label_count: 10,
        name: "라인 A 데이터셋",
        project_id: "project-1",
        source_path: "/data/project-1",
        validation_status: "valid",
        validation_summary: { errors: [], warnings: [] },
      };
      const split = {
        created_at: "2026-07-02T00:00:00Z",
        dataset_id: "dataset-1",
        dataset_yaml_path: "/tmp/data.yaml",
        id: "split-1",
        name: "기본 split",
        seed: 42,
        split_path: "/tmp/split",
        train_count: 8,
        train_ratio: 0.8,
        test_count: 0,
        test_ratio: 0,
        val_count: 2,
        val_ratio: 0.2,
      };
      const runtime = {
        devices: [
          { available: true, details: {}, id: "cpu", kind: "cpu", label: "CPU" },
          { available: true, details: { total_memory_gb: 12 }, id: "0", kind: "cuda", label: "CUDA GPU 0" },
        ],
        install_options: [],
        install_required: false,
        packages: {
          torch: { installed: true, version: "2.5.0" },
          torchvision: { installed: true, version: "0.20.0" },
          ultralytics: { installed: true, version: "8.3.0" },
        },
        python: { executable: "/usr/bin/python", version: "3.11.0" },
        ready: true,
        yolo_cli: { installed: true, path: "/tmp/yolo" },
      };

      if (url.endsWith("/api/runtime/check")) {
        return new Response(JSON.stringify(runtime), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([dataset]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
        return new Response(JSON.stringify(dataset), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
        return new Response(JSON.stringify([split]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs/preflight")) {
        const body = JSON.parse(String(init?.body)) as { config: Record<string, unknown> };
        expect(body.config.optimizer).toBe("AdamW");
        expect(body.config.weight_decay).toBe(0.0007);
        expect(body.config.cos_lr).toBe(true);
        expect(body.config.amp).toBe(true);
        expect(body.config.mosaic).toBe(1);
        expect(body.config.mixup).toBe(0.1);
        return new Response(
          JSON.stringify({
            blocking_issues: [],
            can_start: true,
            command_preview: {
              argv: [
                "/tmp/yolo",
                "detect",
                "train",
                "model=yolo11n.pt",
                "data=/tmp/data.yaml",
                "epochs=50",
                "batch=16",
                "name=<new-run-id>",
              ],
              kind: "yolo_cli",
              shell:
                "/tmp/yolo detect train model=yolo11n.pt data=/tmp/data.yaml epochs=50 batch=16 'name=<new-run-id>'",
            },
            devices: runtime.devices,
            recommendations: [],
            runtime,
            selected_device: runtime.devices[0],
            suggested_config: {
              batch: 16,
              device: "cpu",
              epochs: 50,
              imgsz: 640,
              learning_rate: 0.01,
              optimizer: "AdamW",
              patience: 20,
              weight_decay: 0.0007,
            },
            warnings: [],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/training-runs") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            artifact_path: null,
            config: {},
            created_at: "2026-07-02T00:00:00Z",
            dataset_id: "dataset-1",
            finished_at: null,
            id: "run-created",
            log_path: null,
            metrics_summary: {},
            model_name: "yolo11n",
            name: "preflight run",
            project_id: "project-1",
            split_id: "split-1",
            started_at: null,
            status: "queued",
            trainer: "ultralytics",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 201 },
        );
      }
      if (url.endsWith("/api/projects/project-1/training-runs")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="training" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("라인 A 데이터셋 / 기본 split");
    });

    let openDrawerButton: HTMLButtonElement | undefined;
    await waitForAssertion(() => {
      openDrawerButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("새 학습 실행"),
      );
      expect(openDrawerButton?.disabled).toBe(false);
    });
    act(() => {
      openDrawerButton?.click();
    });

    await waitForAssertion(() => {
      expect(container.querySelector("[role='dialog']")).not.toBeNull();
      expect(container.textContent).toContain("Split 선택");
      expect(container.textContent).toContain("라인 A 데이터셋 / 기본 split");
      expect(container.querySelector<HTMLSelectElement>("[aria-label='Split 선택']")).toBeNull();
    });

    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.placeholder === "학습 실행 이름을 입력하세요",
    );
    const hyperparameterPresetSelect = container.querySelector<HTMLSelectElement>(
      "[aria-label='Hyperparameter preset']",
    );
    const trainingForm = nameInput?.closest("form");
    const formText = trainingForm?.textContent ?? "";
    expect(formText).toContain("device");
    expect(formText).not.toContain("학습 환경");

    act(() => {
      setSelectValue(hyperparameterPresetSelect!, "accuracy");
      setInputValue(nameInput!, "preflight run");
    });
    await act(async () => {
      if (trainingForm) Simulate.submit(trainingForm);
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("CUDA GPU 0");
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          return (
            String(url).endsWith("/api/projects/project-1/training-runs/preflight") &&
            init?.method === "POST"
          );
        }),
      ).toBe(true);
      expect(container.textContent).toContain("실행 명령");
      expect(container.textContent).toContain("yolo detect train");
      expect(container.textContent).toContain("model=yolo11n.pt");
      expect(container.textContent).toContain("name=<new-run-id>");
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          return String(url).endsWith("/api/projects/project-1/training-runs") && init?.method === "POST";
        }),
      ).toBe(false);
    });

    await act(async () => {
      if (trainingForm) Simulate.submit(trainingForm);
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          return String(url).endsWith("/api/projects/project-1/training-runs") && init?.method === "POST";
        }),
      ).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });

  it("creates an inference run from a completed training artifact", async () => {
    const completedRun = {
      artifact_path: "/tmp/train/run-1",
      config: { device: "cpu", epochs: 3 },
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: "2026-07-02T00:10:00Z",
      id: "run-1",
      log_path: "/tmp/train/run-1/logs/stdout.log",
      metrics_summary: { best_mAP50: 0.91 },
      model_name: "yolov8n",
      name: "완료 학습",
      project_id: "project-1",
      split_id: "split-1",
      started_at: "2026-07-02T00:00:00Z",
      status: "completed",
      trainer: "ultralytics",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const artifact = {
      created_at: "2026-07-02T00:10:00Z",
      id: "artifact-best",
      kind: "best",
      metrics_snapshot: { best_mAP50: 0.91 },
      path: "/tmp/train/run-1/weights/best.pt",
      training_run_id: "run-1",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const createdInferenceRun = {
      config: { conf: 0.25, imgsz: 640 },
      created_at: "2026-07-02T00:11:00Z",
      finished_at: null,
      id: "inference-1",
      input_path: "/tmp/images",
      input_type: "folder",
      model_artifact_id: artifact.id,
      name: "검수 이미지 추론",
      output_path: null,
      prediction_count: 0,
      project_id: "project-1",
      started_at: null,
      status: "queued",
      updated_at: "2026-07-02T00:11:00Z",
    };
    const inferenceRuns = [] as typeof createdInferenceRun[];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs")) {
        return new Response(JSON.stringify([completedRun]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs/run-1/artifacts")) {
        return new Response(JSON.stringify([artifact]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/inference-runs/upload") && init?.method === "POST") {
        const body = init.body as FormData;
        expect(body.get("name")).toBe("검수 이미지 추론");
        expect(body.get("model_artifact_id")).toBe(artifact.id);
        expect(body.get("input_type")).toBe("folder");
        expect(body.get("conf")).toBe("0.25");
        expect(body.get("imgsz")).toBe("640");
        expect(body.getAll("inputs")).toHaveLength(2);
        inferenceRuns.unshift(createdInferenceRun);
        return new Response(JSON.stringify(createdInferenceRun), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        });
      }
      if (url.endsWith("/api/projects/project-1/inference-runs")) {
        return new Response(JSON.stringify(inferenceRuns), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="inference" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("추론 실행 목록");
    });

    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
        (input) => input.placeholder === "추론 실행 이름을 입력하세요",
      ),
    ).toBeUndefined();

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("새 추론 실행"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("완료 학습 / best");
      expect(container.textContent).toContain("best.pt");
      expect(container.textContent).not.toContain("이 값보다 낮은 신뢰도의 객체는 숨깁니다.");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='conf 도움말']")?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("이 값보다 낮은 신뢰도의 객체는 숨깁니다.");
      expect(container.textContent).not.toContain("conf는");
    });

    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.placeholder === "추론 실행 이름을 입력하세요",
    );
    const inputFiles = container.querySelector<HTMLInputElement>("[aria-label='추론 이미지 폴더 선택']");
    const typeSelect = container.querySelector<HTMLSelectElement>("[aria-label='추론 입력 유형']");
    const form = nameInput?.closest("form");

    act(() => {
      setInputValue(nameInput!, "검수 이미지 추론");
      setSelectValue(typeSelect!, "folder");
      setFileInput(inputFiles!, [
        fileWithRelativePath("part-a.jpg", "images/nested/part-a.jpg", "image-a", "image/jpeg"),
        fileWithRelativePath("part-b.png", "images/part-b.png", "image-b", "image/png"),
      ]);
    });
    await act(async () => {
      if (form) Simulate.submit(form);
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("inference-1");
      expect(container.querySelector("[role='dialog']")).toBeNull();
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/inference-runs/upload") &&
            init?.method === "POST",
        ),
      ).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });

  it("shows inference runs as thumbnails with toggle details and delete actions", async () => {
    const completedTrainingRun = {
      artifact_path: "/tmp/train/run-1",
      config: {},
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: "2026-07-02T00:10:00Z",
      id: "run-1",
      log_path: "/tmp/train/run-1/logs/stdout.log",
      metrics_summary: {},
      model_name: "yolov8n",
      name: "완료 학습",
      project_id: "project-1",
      split_id: "split-1",
      started_at: "2026-07-02T00:00:00Z",
      status: "completed",
      trainer: "ultralytics",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const artifact = {
      created_at: "2026-07-02T00:10:00Z",
      id: "artifact-best",
      kind: "best",
      metrics_snapshot: {},
      path: "/tmp/train/run-1/weights/best.pt",
      training_run_id: "run-1",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const folderRun = {
      config: { conf: 0.25, imgsz: 640 },
      created_at: "2026-07-02T00:11:00Z",
      finished_at: "2026-07-02T00:12:00Z",
      id: "folder-run",
      input_path: "/tmp/images/batch",
      input_type: "folder",
      model_artifact_id: artifact.id,
      name: "폴더 추론",
      output_path: "/tmp/outputs/folder-run",
      prediction_count: 1,
      project_id: "project-1",
      started_at: "2026-07-02T00:11:00Z",
      status: "completed",
      updated_at: "2026-07-02T00:12:00Z",
    };
    const imageRun = {
      ...folderRun,
      id: "image-run",
      input_path: "/tmp/images/single.jpg",
      input_type: "image",
      name: "단일 추론",
      prediction_count: 0,
    };
    const prediction = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:12:00Z",
      id: "prediction-1",
      image_path: "/tmp/images/batch/part.jpg",
      inference_run_id: folderRun.id,
      max_confidence: 0.91,
      output_image_path: "/tmp/outputs/folder-run/visionops_rendered/part.jpg",
      prediction_json: {
        detections: [
          {
            bbox: { height: 0.3, width: 0.2, x_center: 0.5, y_center: 0.5 },
            class_id: 0,
            class_name: "scratch",
            confidence: 0.91,
          },
        ],
      },
      updated_at: "2026-07-02T00:12:00Z",
    };
    let inferenceRuns = [folderRun, imageRun];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/projects/project-1")) {
        return new Response(
          JSON.stringify({
            created_at: "2026-07-01T00:00:00Z",
            description: "",
            id: "project-1",
            name: "검수 라인 A",
            task_type: "detection",
            updated_at: "2026-07-02T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (url.endsWith("/api/projects/project-1/datasets")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs")) {
        return new Response(JSON.stringify([completedTrainingRun]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/training-runs/run-1/artifacts")) {
        return new Response(JSON.stringify([artifact]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/inference-runs/folder-run/predictions")) {
        return new Response(JSON.stringify([prediction]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/projects/project-1/inference-runs/image-run/predictions")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (
        url.endsWith("/api/projects/project-1/inference-runs/image-run") &&
        init?.method === "DELETE"
      ) {
        inferenceRuns = inferenceRuns.filter((run) => run.id !== "image-run");
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/projects/project-1/inference-runs")) {
        return new Response(JSON.stringify(inferenceRuns), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="inference" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("폴더 추론");
      expect(container.textContent).toContain("폴더");
      expect(container.textContent).toContain("batch");
      expect(container.textContent).toContain("단일 추론");
      expect(container.textContent).toContain("단일 이미지");
      expect(container.textContent).toContain("single.jpg");
      expect(container.querySelector(".inference-run-thumbnail img")).not.toBeNull();
    });

    expect(container.textContent).not.toContain("scratch");
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("자세히"))
        ?.click();
    });
    await waitForAssertion(() => {
      expect(container.textContent).toContain("scratch");
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='단일 추론 삭제']")?.click();
    });
    await waitForAssertion(() => {
      expect(container.textContent).not.toContain("단일 추론");
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/projects/project-1/inference-runs/image-run") &&
            init?.method === "DELETE",
        ),
      ).toBe(true);
    });

    act(() => root.unmount());
    container.remove();
  });

  it("shows rendered prediction images for a completed inference run", async () => {
    const completedTrainingRun = {
      artifact_path: "/tmp/train/run-1",
      config: {},
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: "2026-07-02T00:10:00Z",
      id: "run-1",
      log_path: "/tmp/train/run-1/logs/stdout.log",
      metrics_summary: {},
      model_name: "yolov8n",
      name: "완료 학습",
      project_id: "project-1",
      split_id: "split-1",
      started_at: "2026-07-02T00:00:00Z",
      status: "completed",
      trainer: "ultralytics",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const artifact = {
      created_at: "2026-07-02T00:10:00Z",
      id: "artifact-best",
      kind: "best",
      metrics_snapshot: {},
      path: "/tmp/train/run-1/weights/best.pt",
      training_run_id: "run-1",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const inferenceRun = {
      config: { conf: 0.25, imgsz: 640 },
      created_at: "2026-07-02T00:11:00Z",
      finished_at: "2026-07-02T00:12:00Z",
      id: "inference-1",
      input_path: "/tmp/images",
      input_type: "folder",
      model_artifact_id: artifact.id,
      name: "완료 추론",
      output_path: "/tmp/outputs",
      prediction_count: 1,
      project_id: "project-1",
      started_at: "2026-07-02T00:11:00Z",
      status: "completed",
      updated_at: "2026-07-02T00:12:00Z",
    };
    const prediction = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:12:00Z",
      id: "prediction-1",
      image_path: "/tmp/images/part.jpg",
      inference_run_id: inferenceRun.id,
      max_confidence: 0.91,
      output_image_path: "/tmp/outputs/part.jpg",
      prediction_json: {
        detections: [
          {
            bbox: { height: 0.3, width: 0.2, x_center: 0.5, y_center: 0.5 },
            class_id: 0,
            class_name: "scratch",
            confidence: 0.91,
          },
        ],
      },
      updated_at: "2026-07-02T00:12:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify([completedTrainingRun]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/artifacts")) {
          return new Response(JSON.stringify([artifact]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/inference-runs")) {
          return new Response(JSON.stringify([inferenceRun]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/inference-runs/inference-1/predictions")) {
          return new Response(JSON.stringify([prediction]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="inference" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("완료 추론");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("자세히"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("추론 결과");
      expect(container.textContent).toContain("part.jpg");
      expect(container.textContent).toContain("scratch");
      expect(container.textContent).toContain("0.91");
      expect(
        container.querySelector<HTMLImageElement>(
          "img[src*='/api/projects/project-1/inference-runs/inference-1/predictions/prediction-1/image?v=']",
        ),
      ).not.toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });

  it("does not show original input images when rendered prediction images are missing", async () => {
    const completedTrainingRun = {
      artifact_path: "/tmp/train/run-1",
      config: {},
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: "2026-07-02T00:10:00Z",
      id: "run-1",
      log_path: "/tmp/train/run-1/logs/stdout.log",
      metrics_summary: {},
      model_name: "yolov8n",
      name: "완료 학습",
      project_id: "project-1",
      split_id: "split-1",
      started_at: "2026-07-02T00:00:00Z",
      status: "completed",
      trainer: "ultralytics",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const artifact = {
      created_at: "2026-07-02T00:10:00Z",
      id: "artifact-best",
      kind: "best",
      metrics_snapshot: {},
      path: "/tmp/train/run-1/weights/best.pt",
      training_run_id: "run-1",
      updated_at: "2026-07-02T00:10:00Z",
    };
    const inferenceRun = {
      config: { conf: 0.25, imgsz: 640 },
      created_at: "2026-07-02T00:11:00Z",
      finished_at: "2026-07-02T00:12:00Z",
      id: "inference-1",
      input_path: "/tmp/images",
      input_type: "folder",
      model_artifact_id: artifact.id,
      name: "완료 추론",
      output_path: "/tmp/outputs",
      prediction_count: 1,
      project_id: "project-1",
      started_at: "2026-07-02T00:11:00Z",
      status: "completed",
      updated_at: "2026-07-02T00:12:00Z",
    };
    const prediction = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:12:00Z",
      id: "prediction-1",
      image_path: "/tmp/images/part.jpg",
      inference_run_id: inferenceRun.id,
      max_confidence: 0,
      output_image_path: "",
      prediction_json: {
        detections: [],
        output_image_path: "",
      },
      updated_at: "2026-07-02T00:12:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify([completedTrainingRun]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/artifacts")) {
          return new Response(JSON.stringify([artifact]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/inference-runs")) {
          return new Response(JSON.stringify([inferenceRun]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/inference-runs/inference-1/predictions")) {
          return new Response(JSON.stringify([prediction]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="inference" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("완료 추론");
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("자세히"))
        ?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("결과 이미지 없음");
      expect(container.textContent).toContain("part.jpg");
      expect(
        container.querySelector<HTMLImageElement>(
          "img[src$='/api/projects/project-1/inference-runs/inference-1/predictions/prediction-1/image']",
        ),
      ).toBeNull();
    });

    act(() => root.unmount());
    container.remove();
  });

  it("keeps the training detail inside the selected status filter", async () => {
    const completedRun = {
      artifact_path: null,
      config: {
        batch: 16,
        device: "cpu",
        epochs: 50,
        imgsz: 640,
        learning_rate: 0.01,
        patience: 20,
      },
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      finished_at: "2026-07-02T01:00:00Z",
      id: "run-completed",
      log_path: null,
      metrics_summary: {},
      model_name: "yolo11n",
      name: "완료 학습",
      project_id: "project-1",
      split_id: "split-1",
      started_at: "2026-07-02T00:00:00Z",
      status: "completed",
      trainer: "ultralytics",
      updated_at: "2026-07-02T01:00:00Z",
    };
    const failedRun = {
      ...completedRun,
      finished_at: "2026-07-02T00:30:00Z",
      id: "run-failed",
      name: "실패 학습",
      status: "failed",
      updated_at: "2026-07-02T00:30:00Z",
    };
    const dataset = {
      class_names: ["scratch"],
      created_at: "2026-07-02T00:00:00Z",
      format: "yolo",
      id: "dataset-1",
      image_count: 10,
      label_count: 10,
      name: "라인 A 데이터셋",
      project_id: "project-1",
      source_path: "/data/project-1",
      validation_status: "valid",
      validation_summary: { errors: [], warnings: [] },
    };
    const split = {
      created_at: "2026-07-02T00:00:00Z",
      dataset_id: "dataset-1",
      dataset_yaml_path: "/tmp/data.yaml",
      id: "split-1",
      name: "기본 split",
      seed: 42,
      split_path: "/tmp/split",
      train_count: 8,
      train_ratio: 0.8,
      test_count: 0,
      test_ratio: 0,
      val_count: 2,
      val_ratio: 0.2,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1")) {
          return new Response(
            JSON.stringify({
              created_at: "2026-07-01T00:00:00Z",
              description: "",
              id: "project-1",
              name: "검수 라인 A",
              task_type: "detection",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/datasets")) {
          return new Response(JSON.stringify([dataset]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1")) {
          return new Response(JSON.stringify(dataset), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/datasets/dataset-1/splits")) {
          return new Response(JSON.stringify([split]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs")) {
          return new Response(JSON.stringify([completedRun, failedRun]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-completed")) {
          return new Response(JSON.stringify(completedRun), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-failed")) {
          return new Response(JSON.stringify(failedRun), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/metrics")) {
          return new Response(JSON.stringify({ rows: [], summary: {} }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/artifacts")) {
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.includes("/logs?tail=200")) {
          return new Response(JSON.stringify({ lines: [], offset: 0 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="training" onTabChange={vi.fn()} projectId="project-1" />,
    );

    await waitForAssertion(() => {
      expect(container.querySelector(".training-terminal-panel h2")?.textContent).toBe(
        "실시간 학습 터미널",
      );
      expect(container.querySelector(".training-terminal-title")?.textContent).toContain("완료 학습");
      expect(container.textContent).toContain("학습 결과 보기");
      expect(container.textContent).not.toContain("학습 실행 목록");
    });

    act(() => root.unmount());
    container.remove();
  });
});

describe("LogViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an empty state when the tail log has no lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/logs?tail=200")) {
          return new Response(JSON.stringify({ lines: [], offset: 0 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <LogViewer projectId="project-1" runId="run-1" status="completed" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("로그 없음");
    });
    expect(container.querySelector(".log-viewer__window-controls")).toBeNull();
    expect(container.querySelector(".log-viewer__toolbar")).toBeNull();
    expect(container.querySelector(".log-viewer__body")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("opens the stream from the tail offset and preserves repeated streamed lines", async () => {
    let resolveTail: (response: Response) => void = () => undefined;
    const tailResponse = new Promise<Response>((resolve) => {
      resolveTail = resolve;
    });

    class MockEventSource {
      static instances: MockEventSource[] = [];
      onerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      close = vi.fn();

      constructor(public url: string) {
        MockEventSource.instances.push(this);
      }

      emit(data: string) {
        this.onmessage?.({ data } as MessageEvent<string>);
      }
    }

    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/logs?tail=200")) {
          return tailResponse;
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <LogViewer projectId="project-1" runId="run-1" status="running" />,
    );

    expect(MockEventSource.instances).toHaveLength(0);

    await act(async () => {
      resolveTail(
        new Response(JSON.stringify({ lines: ["tail line"], offset: 123 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
      await tailResponse;
    });

    await waitForAssertion(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });
    expect(MockEventSource.instances[0].url).toContain("offset=123");
    expect(container.textContent).toContain("tail line");

    act(() => {
      MockEventSource.instances[0].emit("stream line");
      MockEventSource.instances[0].emit("retrying");
      MockEventSource.instances[0].emit("retrying");
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("stream line");
      expect(container.querySelector("pre")?.textContent?.match(/retrying/gu)).toHaveLength(2);
    });

    act(() => root.unmount());
    container.remove();
  });
});

describe("TrainingRunPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prioritizes backend best metric summary cards before last epoch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1/training-runs/run-1")) {
          return new Response(
            JSON.stringify({
              artifact_path: "/tmp/train/run-1",
              config: {
                batch: 16,
                device: "cpu",
                epochs: 50,
                imgsz: 640,
                learning_rate: 0.01,
                patience: 20,
              },
              created_at: "2026-07-02T00:00:00Z",
              dataset_id: "dataset-1",
              finished_at: null,
              id: "run-1",
              log_path: null,
              metrics_summary: {},
              model_name: "yolo11n",
              name: "라인 A 학습",
              project_id: "project-1",
              split_id: "split-1",
              started_at: null,
              status: "completed",
              trainer: "ultralytics",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/metrics")) {
          return new Response(
            JSON.stringify({
              rows: [],
              summary: {
                last_epoch: 50,
                best_mAP50: 0.91,
                best_precision: 0.82,
                best_recall: 0.76,
              },
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/downloads")) {
          return new Response(JSON.stringify([
            {
              filename: "results.csv",
              kind: "metrics",
              label: "results.csv",
              url: "/api/projects/project-1/training-runs/run-1/results.csv",
            },
            {
              filename: "best.pt",
              kind: "model_best",
              label: "best.pt",
              url: "/api/projects/project-1/training-runs/run-1/artifacts/artifact-best/download",
            },
            {
              filename: "last.pt",
              kind: "model_last",
              label: "last.pt",
              url: "/api/projects/project-1/training-runs/run-1/artifacts/artifact-last/download",
            },
            {
              filename: "args.yaml",
              kind: "config",
              label: "args.yaml",
              url: "/api/projects/project-1/training-runs/run-1/downloads/args.yaml",
            },
            {
              filename: "results.png",
              kind: "report_image",
              label: "results.png",
              url: "/api/projects/project-1/training-runs/run-1/downloads/results.png",
            },
            {
              filename: "confusion_matrix.png",
              kind: "report_image",
              label: "confusion_matrix.png",
              url: "/api/projects/project-1/training-runs/run-1/downloads/confusion_matrix.png",
            },
          ]), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/logs?tail=200")) {
          return new Response(JSON.stringify({ lines: [], offset: 0 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderWithQuery(
      <TrainingRunPage projectId="project-1" runId="run-1" />,
    );

    await waitForAssertion(() => {
      expect(container.querySelectorAll(".training-detail__summary span").length).toBeGreaterThanOrEqual(3);
    });

    const metricLabels = Array.from(container.querySelectorAll(".training-detail__summary span")).map(
      (element) => element.textContent,
    );

    expect(metricLabels.slice(0, 3)).toEqual([
      "mAP50",
      "Precision",
      "Recall",
    ]);
    expect(metricLabels).not.toContain("Last epoch");
    expect(container.querySelector(".training-detail__model")?.textContent).toContain("yolo11n");
    expect(metricLabels).not.toContain("생성");
    expect(metricLabels).not.toContain("시작");
    expect(metricLabels).not.toContain("종료");
    expect(container.textContent).not.toContain("Snapshot");
    expect(container.textContent).not.toContain("learning_rate");
    expect(container.textContent).not.toContain("생성");
    expect(container.textContent).toContain("시작");
    expect(container.textContent).toContain("종료");
    await waitForAssertion(() => {
      expect(container.textContent).toContain("results.csv");
      expect(container.textContent).toContain("best.pt");
      expect(container.textContent).toContain("last.pt");
      expect(container.textContent).toContain("args.yaml");
      expect(container.textContent).toContain("results.png");
      expect(container.textContent).toContain("confusion_matrix.png");
      const downloadLabels = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(".training-detail__downloads a"),
      ).map((link) => link.textContent);
      expect(downloadLabels).toEqual(["results.csv", "best.pt", "last.pt", "args.yaml"]);
      expect(
        container.querySelector<HTMLImageElement>("img[src$='/downloads/results.png']"),
      ).not.toBeNull();
      expect(container.querySelector(".training-image-modal")).toBeNull();
      const reportButton = container.querySelector<HTMLButtonElement>(
        ".training-report-card button",
      );
      expect(reportButton).not.toBeNull();
      act(() => {
        Simulate.click(reportButton as HTMLButtonElement);
      });
      expect(container.querySelector(".training-image-modal")).not.toBeNull();
      expect(
        container.querySelector<HTMLImageElement>(
          ".training-image-modal img[src$='/downloads/results.png']",
        ),
      ).not.toBeNull();
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(container.querySelector(".training-image-modal")).toBeNull();
      expect(container.textContent).not.toContain("모델 파일");
      expect(container.querySelector(".data-table")).toBeNull();
      expect(container.textContent?.indexOf("mAP50")).toBeLessThan(
        container.textContent?.indexOf("results.csv") ?? -1,
      );
    });
    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/logs?tail=200")),
      ).toBe(true);
      expect(container.textContent).toContain("로그 없음");
      expect(container.textContent).not.toContain("로그 보기");
      expect(container.textContent).not.toContain("로그 숨기기");
    });

    act(() => root.unmount());
    container.remove();
  });

  it("shows legacy download buttons when the downloads endpoint is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1/training-runs/run-legacy")) {
          return new Response(
            JSON.stringify({
              artifact_path: "/tmp/train/run-legacy",
              config: {},
              created_at: "2026-07-02T00:00:00Z",
              dataset_id: "dataset-1",
              finished_at: null,
              id: "run-legacy",
              log_path: null,
              metrics_summary: { best_mAP50: 0.91 },
              model_name: "yolo11n",
              name: "legacy run",
              project_id: "project-1",
              split_id: "split-1",
              started_at: null,
              status: "completed",
              trainer: "ultralytics",
              updated_at: "2026-07-02T00:00:00Z",
            }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-legacy/metrics")) {
          return new Response(JSON.stringify({ rows: [], summary: { best_mAP50: 0.91 } }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-legacy/downloads")) {
          return new Response("not found", { status: 404 });
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-legacy/artifacts")) {
          return new Response(
            JSON.stringify([
              {
                created_at: "2026-07-02T00:00:00Z",
                id: "artifact-best",
                kind: "best",
                metrics_snapshot: {},
                path: "/tmp/train/run-legacy/weights/best.pt",
                training_run_id: "run-legacy",
                updated_at: "2026-07-02T00:00:00Z",
              },
              {
                created_at: "2026-07-02T00:00:00Z",
                id: "artifact-last",
                kind: "last",
                metrics_snapshot: {},
                path: "/tmp/train/run-legacy/weights/last.pt",
                training_run_id: "run-legacy",
                updated_at: "2026-07-02T00:00:00Z",
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        if (url.endsWith("/api/projects/project-1/training-runs/run-legacy/logs?tail=200")) {
          return new Response(JSON.stringify({ lines: [], offset: 0 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { container, root } = renderWithQuery(
      <TrainingRunPage projectId="project-1" runId="run-legacy" />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("results.csv");
      expect(container.textContent).toContain("best.pt");
      expect(container.textContent).toContain("last.pt");
    });

    act(() => root.unmount());
    container.remove();
  });
});
