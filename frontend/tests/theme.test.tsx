import { describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { resolveTheme } from "../src/theme/theme";
import { ThemeProvider } from "../src/theme/ThemeProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("resolveTheme", () => {
  it("returns explicit light or dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("uses system preference for system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("ThemeProvider", () => {
  it("renders when matchMedia is unavailable", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(
          <LanguageProvider>
            <ThemeProvider>
              <div>content</div>
            </ThemeProvider>
          </LanguageProvider>,
        );
      });

      expect(document.documentElement.dataset.theme).toBe("light");
      expect(container.textContent).toContain("content");
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
