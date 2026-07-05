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

  it("does not render repeated section eyebrow captions", () => {
    const files = execFileSync("rg", ["--files", sourceRoot, "-g", "*.tsx"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const offenders = files.flatMap((filePath) => {
      const relativePath = relative(repoRoot, filePath);
      return readFileSync(filePath, "utf8")
        .split("\n")
        .map((line, index) => ({ index, line }))
        .filter(({ line }) => line.includes("section-label"))
        .map(({ index, line }) => `${relativePath}:${index + 1}: ${line.trim()}`);
    });

    expect(offenders).toEqual([]);
  });

  it("uses instructional placeholder copy instead of sample values", () => {
    const source = readFileSync(resolve(sourceRoot, "i18n/LanguageProvider.tsx"), "utf8");

    expect(source).toContain('"projects.namePlaceholder": "Enter a project name"');
    expect(source).toContain('"projects.descriptionPlaceholder": "Enter a project description"');
    expect(source).toContain('"dataset.namePlaceholder": "Enter a dataset name"');
    expect(source).toContain('"training.namePlaceholder": "Enter a training run name"');
    expect(source).toContain('"inference.namePlaceholder": "Enter an inference run name"');
    expect(source).toContain('"projects.namePlaceholder": "프로젝트 이름을 입력하세요"');
    expect(source).toContain('"projects.descriptionPlaceholder": "프로젝트 설명을 입력하세요"');
    expect(source).toContain('"dataset.namePlaceholder": "데이터셋 이름을 입력하세요"');
    expect(source).toContain('"training.namePlaceholder": "학습 실행 이름을 입력하세요"');
    expect(source).toContain('"inference.namePlaceholder": "추론 실행 이름을 입력하세요"');
  });

  it("uses active queue empty states instead of first-run wording", () => {
    const source = readFileSync(resolve(sourceRoot, "i18n/LanguageProvider.tsx"), "utf8");

    expect(source).toContain('"trainingQueue.queueEmpty": "표시할 실행이 없습니다."');
    expect(source).toContain('"trainingQueue.empty": "표시할 학습 작업이 없습니다."');
    expect(source).toContain('"trainingQueue.inferenceEmpty": "표시할 추론 작업이 없습니다."');
    expect(source).not.toContain("아직 학습 실행이 없습니다.");
    expect(source).not.toContain("아직 추론 실행이 없습니다.");
  });
});
