import React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsPage } from "../src/pages/ProjectsPage";
import { ProjectDetailPage } from "../src/pages/ProjectDetailPage";
import { StatusBadge } from "../src/components/StatusBadge";
import { LogViewer } from "../src/components/LogViewer";
import { TrainingRunPage } from "../src/pages/TrainingRunPage";
import { Layout } from "../src/components/Layout";
import { LanguageProvider, useLanguage } from "../src/i18n/LanguageProvider";
import { ThemeProvider } from "../src/theme/ThemeProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
    const nameInput = fields.find((field) => field.getAttribute("placeholder") === "검수 라인 A") as HTMLInputElement;
    const descriptionInput = fields.find(
      (field) => field.getAttribute("placeholder") === "라인 결함 탐지",
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
  it("shows only global project navigation before a project is selected", () => {
    const onOpenProjects = vi.fn();
    const { container, root } = render(
      <Layout
        currentView="projects"
        onOpenProjects={onOpenProjects}
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
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>("[aria-label='프로젝트']")).not.toBeNull();
    expect(container.textContent).not.toContain("데이터셋");
    expect(container.textContent).not.toContain("학습");
    expect(container.textContent).not.toContain("추론");

    act(() => root.unmount());
    container.remove();
  });

  it("shows feedback when header icon buttons are clicked", () => {
    const { container, root } = render(
      <Layout
        currentView="projects"
        onOpenProjects={vi.fn()}
        title="프로젝트"
      >
        <div />
      </Layout>,
    );

    act(() => {
      container.querySelector<HTMLButtonElement>("[aria-label='알림']")?.click();
    });

    expect(container.textContent).toContain("알림이 없습니다.");

    act(() => root.unmount());
    container.remove();
  });

  it("opens theme controls from the settings button", () => {
    const { container, root } = render(
      <ThemeProvider>
        <Layout
          currentView="projects"
          onOpenProjects={vi.fn()}
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
          currentView="projects"
          onOpenProjects={vi.fn()}
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
    expect(container.querySelector("[aria-label='Projects']")).not.toBeNull();
    expect(container.textContent).toContain("Theme");
    expect(container.textContent).toContain("Language");

    act(() => root.unmount());
    container.remove();
  });
});

describe("ProjectDetailPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

    const ratioInputs = Array.from(container.querySelectorAll<HTMLInputElement>(".split-form input"));
    const trainInput = ratioInputs[1];
    const splitButton = container.querySelector<HTMLButtonElement>(".split-form .primary-button");

    act(() => {
      setInputValue(trainInput, "0.9");
    });

    expect(container.textContent).toContain("합은 1.0");
    expect(splitButton?.disabled).toBe(true);

    act(() => root.unmount());
    container.remove();
  });

  it("moves focus when using arrow keys on tabs", async () => {
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
        return new Response("not found", { status: 404 });
      }),
    );
    const onTabChange = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={onTabChange} projectId="project-1" />,
    );

    const datasetsTab = container.querySelector<HTMLButtonElement>("#datasets-tab");
    const trainingTab = container.querySelector<HTMLButtonElement>("#training-tab");
    const inferenceTab = container.querySelector<HTMLButtonElement>("#inference-tab");

    act(() => {
      datasetsTab?.focus();
      datasetsTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("training");
    expect(document.activeElement).toBe(trainingTab);

    act(() => {
      datasetsTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("inference");
    expect(document.activeElement).toBe(inferenceTab);

    act(() => {
      inferenceTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("datasets");
    expect(document.activeElement).toBe(datasetsTab);

    act(() => root.unmount());
    container.remove();
  });

  it("moves tabs from the focused tab rather than the selected tab", async () => {
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
        return new Response("not found", { status: 404 });
      }),
    );
    const onTabChange = vi.fn();
    const { container, root } = renderWithQuery(
      <ProjectDetailPage activeTab="datasets" onTabChange={onTabChange} projectId="project-1" />,
    );

    const inferenceTab = container.querySelector<HTMLButtonElement>("#inference-tab");

    act(() => {
      inferenceTab?.focus();
      inferenceTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("datasets");
    expect(document.activeElement).toBe(container.querySelector<HTMLButtonElement>("#datasets-tab"));

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
    const datasetNameInput = fields.find((input) => input.placeholder === "불량 샘플 7월");
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

  it("shows a real training form and blocks creation when splits are missing", async () => {
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
      expect(container.textContent).toContain("Split 없음");
      expect(container.textContent).toContain("학습에 사용할 Split을 먼저 생성하세요.");
    });

    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("학습 시작"),
    );
    expect(submitButton?.disabled).toBe(true);

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
            blocking_issues: ["Ultralytics가 설치되어 있지 않습니다."],
            can_start: false,
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
      expect(container.textContent).toContain("현재 학습 가능");
      expect(container.textContent).toContain("CUDA GPU 0");
    });

    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.placeholder === "라인 A 기준 모델",
    );
    const hyperparameterPresetSelect = container.querySelector<HTMLSelectElement>(
      "[aria-label='하이퍼파라미터 preset']",
    );
    const trainingForm = nameInput?.closest("form");
    const formText = trainingForm?.textContent ?? "";
    expect(formText.indexOf("device")).toBeLessThan(formText.indexOf("학습 환경"));

    act(() => {
      setSelectValue(hyperparameterPresetSelect!, "accuracy");
      setInputValue(nameInput!, "preflight run");
    });
    await act(async () => {
      if (trainingForm) Simulate.submit(trainingForm);
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
      expect(container.textContent).toContain("학습 전 확인 필요");
      expect(container.textContent).toContain("Ultralytics가 설치되어 있지 않습니다.");
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          return String(url).endsWith("/api/projects/project-1/training-runs") && init?.method === "POST";
        }),
      ).toBe(false);
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
      expect(container.textContent).toContain("추론 실행");
      expect(container.textContent).toContain("완료 학습 / best");
      expect(container.textContent).toContain("best.pt");
    });

    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.placeholder === "검수 이미지 추론",
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
      expect(container.textContent).toContain("추론 결과");
      expect(container.textContent).toContain("part.jpg");
      expect(container.textContent).toContain("scratch");
      expect(container.textContent).toContain("0.91");
      expect(
        container.querySelector<HTMLImageElement>(
          "img[src$='/api/projects/project-1/inference-runs/inference-1/predictions/prediction-1/image']",
        ),
      ).not.toBeNull();
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
      expect(container.querySelector(".training-detail__header h2")?.textContent).toBe("완료 학습");
    });

    const failedFilterButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".segment-control button"),
    ).find((button) => button.textContent === "실패");

    act(() => {
      failedFilterButton?.click();
    });

    await waitForAssertion(() => {
      expect(container.querySelector(".training-detail__header h2")?.textContent).toBe("실패 학습");
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/projects/project-1/training-runs/run-1")) {
          return new Response(
            JSON.stringify({
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
        if (url.endsWith("/api/projects/project-1/training-runs/run-1/artifacts")) {
          return new Response(JSON.stringify([]), {
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
      }),
    );

    const { container, root } = renderWithQuery(
      <TrainingRunPage projectId="project-1" runId="run-1" />,
    );

    await waitForAssertion(() => {
      expect(container.querySelectorAll(".metric-card span").length).toBeGreaterThanOrEqual(3);
    });

    const metricLabels = Array.from(container.querySelectorAll(".metric-card span")).map(
      (element) => element.textContent,
    );

    expect(metricLabels.slice(0, 3)).toEqual([
      "Best mAP50",
      "Best Precision",
      "Best Recall",
    ]);
    expect(metricLabels).not.toContain("Last epoch");

    act(() => root.unmount());
    container.remove();
  });
});
