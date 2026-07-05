import React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { NotificationSettingsPage } from "../src/pages/NotificationSettingsPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

const defaultSettings = [
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
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("NotificationSettingsPage", () => {
  it("renders supported channels and saves Slack webhook settings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/notification-settings") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(defaultSettings), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (url.endsWith("/api/notification-settings/slack") && init?.method === "PUT") {
        return new Response(JSON.stringify({ ...defaultSettings[0], ...JSON.parse(String(init.body)) }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ detail: "not found" }), {
        headers: { "Content-Type": "application/json" },
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = render(<NotificationSettingsPage />);

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Slack");
      expect(container.textContent).toContain("Discord");
      expect(container.textContent).toContain("Telegram");
    });

    const slackEnabled = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack 활성화"]',
    );
    const slackWebhook = container.querySelector<HTMLInputElement>(
      'input[aria-label="Slack Webhook URL"]',
    );
    const slackSave = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Slack 저장"),
    );

    expect(slackEnabled).not.toBeNull();
    expect(slackWebhook).not.toBeNull();
    expect(slackSave).not.toBeUndefined();

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

    act(() => root.unmount());
    container.remove();
  });
});
