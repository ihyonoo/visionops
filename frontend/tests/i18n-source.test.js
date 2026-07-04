import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const sourceRoot = resolve(repoRoot, "src");
const allowedKoreanFiles = new Set(["src/i18n/LanguageProvider.tsx"]);

describe("English localization coverage", () => {
  it("keeps Korean UI text inside the translation dictionary", () => {
    const files = execFileSync("rg", ["--files", sourceRoot, "-g", "*.{ts,tsx}"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const offenders = files.flatMap((filePath) => {
      const relativePath = relative(repoRoot, filePath);
      if (allowedKoreanFiles.has(relativePath)) return [];

      return readFileSync(filePath, "utf8")
        .split("\n")
        .map((line, index) => ({ index, line }))
        .filter(({ line }) => /[가-힣]/u.test(line))
        .map(({ index, line }) => `${relativePath}:${index + 1}: ${line.trim()}`);
    });

    expect(offenders).toEqual([]);
  });
});
