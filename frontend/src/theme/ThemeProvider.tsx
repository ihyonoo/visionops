import { Monitor, Moon, Sun } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";

import { resolveTheme, ThemeChoice } from "./theme";

const STORAGE_KEY = "visionops-theme";
const THEME_CHOICES: Array<{
  value: ThemeChoice;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "밝게", icon: Sun },
  { value: "dark", label: "어둡게", icon: Moon },
  { value: "system", label: "시스템", icon: Monitor },
];

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function readPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState(readPrefersDark);
  const resolvedTheme = useMemo(
    () => resolveTheme(themeChoice, prefersDark),
    [prefersDark, themeChoice],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, themeChoice);
    } catch {
      // Theme selection remains usable even when storage is unavailable.
    }
  }, [themeChoice]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return (
    <>
      {children}
      <div className="theme-control" aria-label="테마 선택">
        {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
          <button
            aria-pressed={themeChoice === value}
            className="theme-control__button"
            key={value}
            onClick={() => setThemeChoice(value)}
            title={`${label} 테마`}
            type="button"
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
