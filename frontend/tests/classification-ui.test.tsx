import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => { readFileSync: (path: string, encoding: string) => string };

const { readFileSync } = require("node:fs");

describe("classification UI source", () => {
  it("exposes YOLO classification model catalog", () => {
    const source = readFileSync("src/pages/ProjectDetailPage.tsx", "utf-8");

    for (const family of ["yolo26", "yolo11", "yolov8"]) {
      for (const size of ["n", "s", "m", "l", "x"]) {
        expect(source).toContain(`${family}${size}-cls`);
      }
    }
  });

  it("prioritizes classification training metrics", () => {
    const runSource = readFileSync("src/pages/TrainingRunPage.tsx", "utf-8");
    const managementSource = readFileSync("src/pages/TrainingManagementPage.tsx", "utf-8");

    for (const metricKey of [
      "best_accuracy_top1",
      "best_accuracy_top5",
      "last_val_loss",
      "last_train_loss",
    ]) {
      expect(runSource).toContain(metricKey);
      expect(managementSource).toContain(metricKey);
    }
    expect(runSource).toContain("CLASSIFICATION_QUALITY_KEYS");
    expect(managementSource).toContain("accuracy_top1");
  });

  it("uses localized classification sort labels and guards stale sort state", () => {
    const managementSource = readFileSync("src/pages/TrainingManagementPage.tsx", "utf-8");
    const i18nSource = readFileSync("src/i18n/LanguageProvider.tsx", "utf-8");

    expect(managementSource).toContain('labelKey: "trainingManagement.sortAccuracyTop1"');
    expect(managementSource).toContain("validSortKeys");
    expect(managementSource).toContain("setSortKey(\"latest\")");
    expect(i18nSource).toContain('"trainingManagement.sortAccuracyTop1": "Top-1 accuracy"');
    expect(i18nSource).toContain('"trainingManagement.sortAccuracyTop1": "Top-1 정확도"');
  });

  it("renders classification prediction rankings separately from detection overlays", () => {
    const source = readFileSync("src/pages/ProjectDetailPage.tsx", "utf-8");

    expect(source).toContain("prediction-ranking");
    expect(source).toContain("prediction.prediction_json.ranking");
    expect(source).toContain("isClassificationProject");
    expect(source).not.toContain("String(entry.class_name)");
    expect(source).not.toContain("Number(entry.confidence || 0)");
  });
});
