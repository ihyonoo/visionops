export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return prefersDark ? "dark" : "light";
}
