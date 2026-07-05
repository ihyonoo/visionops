import React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationSetting } from "../src/api/types";
import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { NotificationSettingsPage } from "../src/pages/NotificationSettingsPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function render(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  act(() => {
    root.render(
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </LanguageProvider>,
    );
  });

  mountedRoots.push({ container, root });
  return { container, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  Simulate.change(input, {
    target: {
      value,
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

const defaultSettings: NotificationSetting[] = [
  {
    channel: "slack",
    enabled: false,
    events: {
      inference_completed: false,
      inference_failed: false,
      training_completed: false,
      training_failed: false,
    },
    has_secret: false,
    last_error: null,
    last_sent_at: null,
    last_status: null,
    masked_secret: null,
  },
  {
    channel: "discord",
    enabled: false,
    events: {
      inference_completed: false,
      inference_failed: false,
      training_completed: false,
      training_failed: false,
    },
    has_secret: false,
    last_error: null,
    last_sent_at: null,
    last_status: null,
    masked_secret: null,
  },
  {
    channel: "telegram",
    enabled: false,
    events: {
      inference_completed: false,
      inference_failed: false,
      training_completed: false,
      training_failed: false,
    },
    has_secret: false,
    last_error: null,
    last_sent_at: null,
    last_status: null,
    masked_secret: null,
  },
];

afterEach(() => {
  for (const { container, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function createFetchMock(settings = defaultSettings) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/notification-settings") && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify(settings), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (url.endsWith("/api/notification-settings/slack") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ...settings[0], ...JSON.parse(String(init.body)) }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ detail: "not found" }), {
      headers: { "Content-Type": "application/json" },
      status: 404,
    });
  });
}

function findButton(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(name),
  );
}

describe("NotificationSettingsPage", () => {
  it("renders supported channels and saves Slack webhook settings", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
      expect(container.textContent).toContain("Discord");
      expect(container.textContent).toContain("Telegram");
    });
    expect(container.textContent).not.toContain("notificationSettings.");
    expect(container.querySelector(".settings-page")).not.toBeNull();
    expect(container.querySelector(".notification-settings-grid")).not.toBeNull();
    expect(container.querySelectorAll(".notification-card")).toHaveLength(3);
    expect(container.querySelector(".settings-page > .panel")).toBeNull();

    const slackEnabled = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack 활성화"]',
    );
    const slackWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack Webhook URL"]',
    );
    const slackSave = findButton(container, "저장");

    expect(slackEnabled).not.toBeNull();
    expect(slackWebhook).not.toBeNull();
    expect(slackSave).not.toBeUndefined();
    const slackActions = Array.from(
      container.querySelector(".notification-card .button-row")?.querySelectorAll("button") ?? [],
    ).map((button) => button.textContent);
    expect(slackActions).toEqual(["저장", "삭제", "테스트"]);

    await act(async () => {
      slackEnabled?.click();
    });
    await act(async () => {
      if (slackWebhook) setInputValue(slackWebhook, "https://hooks.slack.test/services/T1/B2/C3");
    });
    await act(async () => {
      slackSave?.click();
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/notification-settings/slack") && init?.method === "PUT",
        ),
      ).toBe(true);
    });

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/notification-settings/slack") && init?.method === "PUT",
    );
    const payload = JSON.parse(String(putCall?.[1]?.body));

    expect(payload).toMatchObject({
      enabled: true,
      events: {
        inference_completed: false,
        inference_failed: false,
        training_completed: false,
        training_failed: false,
      },
      webhook_url: "https://hooks.slack.test/services/T1/B2/C3",
    });
  });

  it("shows backend validation detail when Slack webhook save fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notification-settings") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(defaultSettings), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (url.endsWith("/api/notification-settings/slack") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            detail: "Slack webhook URL must be an HTTPS hooks.slack.com /services/ URL.",
          }),
          { headers: { "Content-Type": "application/json" }, status: 400 },
        );
      }
      return new Response(JSON.stringify({ detail: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
    });

    const slackEnabled = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack 활성화"]',
    );
    const slackWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack Webhook URL"]',
    );
    await act(async () => {
      slackEnabled?.click();
    });
    await act(async () => {
      if (slackWebhook) setInputValue(slackWebhook, "https://hooks.slack.com/triggers/T1/B2/C3");
    });
    await act(async () => {
      findButton(container, "저장")?.click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("알림 설정 저장에 실패했습니다.");
      expect(container.textContent).toContain("Slack webhook URL must be an HTTPS hooks.slack.com");
    });
  });

  it("clears the saved Slack webhook field immediately after successful save", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
    });

    const slackWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack Webhook URL"]',
    );
    const slackSave = findButton(container, "저장");

    expect(slackWebhook).not.toBeNull();
    expect(slackSave).not.toBeUndefined();

    await act(async () => {
      if (slackWebhook) setInputValue(slackWebhook, "https://hooks.slack.test/services/clear");
    });
    await act(async () => {
      slackSave?.click();
    });

    await waitForAssertion(() => {
      expect(slackWebhook?.value).toBe("");
    });
  });

  it("shows a saved Slack webhook as a masked value in the webhook input", async () => {
    const maskedWebhookUrl = "https://hooks.slack.test/***";
    const fetchMock = createFetchMock([
      {
        ...defaultSettings[0],
        has_secret: true,
        masked_secret: maskedWebhookUrl,
      },
      defaultSettings[1],
      defaultSettings[2],
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      const slackWebhook = container.querySelector<HTMLInputElement>(
        'input[aria-label="Slack Webhook URL"]',
      );
      expect(slackWebhook?.value).toBe(maskedWebhookUrl);
      expect(slackWebhook?.type).toBe("text");
      expect(container.textContent).not.toContain(maskedWebhookUrl);
    });
  });

  it("does not submit the masked Slack webhook when only events change", async () => {
    const maskedWebhookUrl = "https://hooks.slack.test/***";
    const fetchMock = createFetchMock([
      {
        ...defaultSettings[0],
        has_secret: true,
        masked_secret: maskedWebhookUrl,
      },
      defaultSettings[1],
      defaultSettings[2],
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
    });

    const trainingCompleted = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack training_completed"]',
    );
    const slackSave = findButton(container, "저장");

    await act(async () => {
      trainingCompleted?.click();
    });
    await act(async () => {
      slackSave?.click();
    });

    await waitForAssertion(() => {
      const putCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith("/api/notification-settings/slack") && init?.method === "PUT",
      );
      const payload = JSON.parse(String(putCall?.[1]?.body));
      expect(payload.webhook_url).toBeUndefined();
    });
  });

  it("asks users to save before sending a test notification", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
    });

    const slackTest = findButton(container, "테스트");

    expect(slackTest).not.toBeUndefined();

    await act(async () => {
      slackTest?.click();
    });

    expect(container.textContent).toContain("테스트 전에 먼저 저장하세요.");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/notification-settings/slack/test") &&
          init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("keeps Slack enabled after save when the follow-up settings refetch fails", async () => {
    let settingsGetCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/notification-settings") && (!init?.method || init.method === "GET")) {
        settingsGetCount += 1;
        if (settingsGetCount === 1) {
          return new Response(JSON.stringify(defaultSettings), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response(JSON.stringify({ detail: "refetch unavailable" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        });
      }

      if (url.endsWith("/api/notification-settings/slack") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            ...defaultSettings[0],
            enabled: true,
            events: JSON.parse(String(init.body)).events,
            has_secret: true,
            masked_secret: "https://hooks.slack.test/***",
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      return new Response(JSON.stringify({ detail: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
    });

    const slackEnabled = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack 활성화"]',
    );
    const slackSave = findButton(container, "저장");

    expect(slackEnabled).not.toBeNull();
    expect(slackSave).not.toBeUndefined();

    await act(async () => {
      slackEnabled?.click();
    });
    await act(async () => {
      slackSave?.click();
    });

    await waitForAssertion(() => {
      expect(settingsGetCount).toBeGreaterThan(1);
      expect(slackEnabled?.checked).toBe(true);
      expect(
        container.querySelector<HTMLInputElement>('input[aria-label="Slack Webhook URL"]')?.value,
      ).toBe("https://hooks.slack.test/***");
      expect(container.textContent).not.toContain("https://hooks.slack.test/***");
    });
  });

  it("preserves an unsaved Discord webhook when Slack save refetches settings", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Discord");
    });

    const slackWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack Webhook URL"]',
    );
    const discordWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Discord Webhook URL"]',
    );
    const slackSave = findButton(container, "저장");

    expect(slackWebhook).not.toBeNull();
    expect(discordWebhook).not.toBeNull();
    expect(slackSave).not.toBeUndefined();

    await act(async () => {
      if (discordWebhook) setInputValue(discordWebhook, "https://discord.test/unsaved");
    });
    await act(async () => {
      if (slackWebhook) setInputValue(slackWebhook, "https://hooks.slack.test/services/refetch");
    });
    await act(async () => {
      slackSave?.click();
    });

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).endsWith("/api/notification-settings") &&
            (!init?.method || init.method === "GET"),
        ).length,
      ).toBeGreaterThan(1);
    });
    expect(discordWebhook?.value).toBe("https://discord.test/unsaved");
  });

  it("renders failed notification errors", async () => {
    const fetchMock = createFetchMock([
      {
        ...defaultSettings[0],
        last_error: "Slack webhook rejected",
        last_status: "failed",
      },
      defaultSettings[1],
      defaultSettings[2],
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack webhook rejected");
    });
  });

  it("resets Slack to disabled after delete when the follow-up settings refetch fails", async () => {
    let settingsGetCount = 0;
    const enabledSettings: NotificationSetting[] = [
      {
        ...defaultSettings[0],
        enabled: true,
        has_secret: true,
        masked_secret: "https://hooks.slack.test/***",
      },
      defaultSettings[1],
      defaultSettings[2],
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/notification-settings") && (!init?.method || init.method === "GET")) {
        settingsGetCount += 1;
        if (settingsGetCount === 1) {
          return new Response(JSON.stringify(enabledSettings), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }
        return new Response(JSON.stringify({ detail: "refetch unavailable" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        });
      }

      if (url.endsWith("/api/notification-settings/slack") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ detail: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Slack 활성화"]')?.checked).toBe(
        true,
      );
    });

    const slackEnabled = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack 활성화"]',
    );
    const slackDelete = findButton(container, "삭제");

    expect(slackEnabled).not.toBeNull();
    expect(slackDelete).not.toBeUndefined();

    await act(async () => {
      slackDelete?.click();
    });

    await waitForAssertion(() => {
      expect(settingsGetCount).toBeGreaterThan(1);
      expect(slackEnabled?.checked).toBe(false);
      expect(container.textContent).not.toContain("https://hooks.slack.test/***");
    });
  });
});
