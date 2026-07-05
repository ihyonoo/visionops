import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("styles source", () => {
  it("keeps parameter help inside field flow so modal tooltips are not clipped", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toContain(".field-label__help");
    expect(styles).not.toMatch(/\.parameter-help__bubble\s*\{[\s\S]*?position:\s*absolute/u);
  });

  it("lets the training terminal body fill the panel and wrap long paths", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.training-terminal-panel\s+\.log-viewer__body\s*\{[\s\S]*?min-height:\s*420px/u);
    expect(styles).toMatch(/\.log-viewer__body\s*\{[\s\S]*?overflow-wrap:\s*anywhere/u);
    expect(styles).toMatch(/\.log-viewer__body\s*\{[\s\S]*?word-break:\s*break-word/u);
  });

  it("keeps notification settings page styles available", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toContain(".settings-page");
    expect(styles).toContain(".notification-settings-grid");
    expect(styles).toContain(".notification-card");
    expect(styles).toContain(".notification-settings-card");
  });
});
