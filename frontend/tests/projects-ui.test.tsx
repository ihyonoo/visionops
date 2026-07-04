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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function render(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  return { container, root };
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
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

  it("renders project rows and selects a project", async () => {
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
      <ProjectsPage selectedProjectId={null} onSelectProject={onSelectProject} />,
    );

    await waitForAssertion(() => {
      expect(container.textContent).toContain("검수 라인 A");
    });

    const projectRow = container.querySelector<HTMLTableRowElement>("tbody tr");

    expect(projectRow?.getAttribute("role")).toBe("button");
    expect(projectRow?.getAttribute("aria-selected")).toBe("false");

    act(() => {
      container.querySelector<HTMLElement>("[data-project-row='project-1']")?.click();
    });

    expect(onSelectProject).toHaveBeenCalledWith("project-1");

    act(() => {
      projectRow?.click();
    });

    expect(onSelectProject).toHaveBeenCalledTimes(2);

    act(() => {
      projectRow?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onSelectProject).toHaveBeenCalledTimes(3);

    act(() => {
      projectRow?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    });

    expect(onSelectProject).toHaveBeenCalledTimes(4);

    act(() => root.unmount());
    container.remove();
  });
});

describe("Layout", () => {
  it("keeps project navigation buttons clickable before a project is selected", () => {
    const onOpenProjectTab = vi.fn();
    const { container, root } = render(
      <Layout
        activeTab="overview"
        currentView="projects"
        onOpenProjectTab={onOpenProjectTab}
        onOpenProjects={vi.fn()}
        selectedProjectId={null}
        title="프로젝트"
      >
        <div />
      </Layout>,
    );

    const trainingButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(
      (button) => button.textContent?.includes("학습"),
    );

    expect(trainingButton?.disabled).toBe(false);
    expect(trainingButton?.getAttribute("aria-disabled")).toBe("true");

    act(() => {
      trainingButton?.click();
    });

    expect(onOpenProjectTab).toHaveBeenCalledWith("training");

    act(() => root.unmount());
    container.remove();
  });

  it("shows feedback when header icon buttons are clicked", () => {
    const { container, root } = render(
      <Layout
        activeTab="overview"
        currentView="projects"
        onOpenProjectTab={vi.fn()}
        onOpenProjects={vi.fn()}
        selectedProjectId={null}
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
      <ProjectDetailPage activeTab="overview" onTabChange={onTabChange} projectId="project-1" />,
    );

    const overviewTab = container.querySelector<HTMLButtonElement>("#overview-tab");
    const datasetsTab = container.querySelector<HTMLButtonElement>("#datasets-tab");
    const artifactsTab = container.querySelector<HTMLButtonElement>("#artifacts-tab");

    act(() => {
      overviewTab?.focus();
      overviewTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("datasets");
    expect(document.activeElement).toBe(datasetsTab);

    act(() => {
      datasetsTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("artifacts");
    expect(document.activeElement).toBe(artifactsTab);

    act(() => {
      artifactsTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("overview");
    expect(document.activeElement).toBe(overviewTab);

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
      <ProjectDetailPage activeTab="overview" onTabChange={onTabChange} projectId="project-1" />,
    );

    const inferenceTab = container.querySelector<HTMLButtonElement>("#inference-tab");
    const artifactsTab = container.querySelector<HTMLButtonElement>("#artifacts-tab");

    act(() => {
      inferenceTab?.focus();
      inferenceTab?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    expect(onTabChange).toHaveBeenCalledWith("artifacts");
    expect(document.activeElement).toBe(artifactsTab);

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
      if (url.endsWith("/api/projects/project-1/datasets") && init?.method === "POST") {
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

    const fields = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
    const datasetNameInput = fields.find((input) => input.placeholder === "불량 샘플 7월");
    const sourcePathInput = fields.find((input) => input.placeholder === "/data/vision_ops/line-a");
    const datasetForm = datasetNameInput?.closest("form");

    act(() => {
      setInputValue(datasetNameInput!, "새 데이터셋");
      setInputValue(sourcePathInput!, "/data/new");
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
