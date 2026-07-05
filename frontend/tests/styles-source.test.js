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

  it("uses a separate charcoal terminal palette in dark mode", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*?--terminal-bg:\s*#05070a/u);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*?--terminal-border:\s*#263241/u);
    expect(styles).toMatch(/\.log-viewer,\s*[\s\S]*?\.log-viewer__body,\s*[\s\S]*?\.log-viewer > \.empty-state\s*\{[\s\S]*?background:\s*var\(--terminal-bg\)/u);
  });

  it("uses a quiet monochrome depth layer for the dark mode app background", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const darkBackgroundRule = styles.match(/:root\[data-theme="dark"\]\s+\.app-shell\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;

    expect(darkBackgroundRule).toContain("radial-gradient");
    expect(darkBackgroundRule).toContain("#050505");
    expect(darkBackgroundRule).toContain("#191919");
    expect(darkBackgroundRule).not.toContain("repeating-linear-gradient");
    expect(darkBackgroundRule).not.toContain("--gradient-develop");
    expect(darkBackgroundRule).not.toContain("--gradient-preview");
    expect(darkBackgroundRule).not.toContain("--gradient-ship");
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.app-header,/u);
  });

  it("uses a quiet monochrome depth layer for the light mode app background", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const lightBackgroundRule = styles.match(/:root\[data-theme="light"\]\s+\.app-shell\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;

    expect(lightBackgroundRule).toContain("radial-gradient");
    expect(lightBackgroundRule).toContain("#ffffff");
    expect(lightBackgroundRule).toContain("#f4f4f4");
    expect(lightBackgroundRule).not.toContain("repeating-linear-gradient");
    expect(lightBackgroundRule).not.toContain("--gradient-develop");
    expect(lightBackgroundRule).not.toContain("--gradient-preview");
    expect(lightBackgroundRule).not.toContain("--gradient-ship");
  });

  it("centers version metadata and pins the queue segment to the right edge", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.training-queue-widget__summary\s*\{[\s\S]*?grid-template-columns:\s*minmax\(240px,\s*1fr\)\s+minmax\(260px,\s*auto\)\s+minmax\(240px,\s*1fr\)/u);
    expect(styles).toMatch(/\.training-queue-widget__version\s*\{[\s\S]*?justify-self:\s*center/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?justify-self:\s*end/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?min-width:\s*min\(260px,\s*34vw\)/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?max-width:\s*min\(560px,\s*38vw\)/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?padding-left:\s*18px/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?justify-content:\s*center/u);
    expect(styles).toMatch(/\.training-queue-widget__summary-button--queue\s*\{[^}]*?text-align:\s*center/u);
  });

  it("splits training and inference queue sections side by side on wider screens", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const sectionGroupsRule = styles.match(
      /\.training-queue-widget__section-groups\s*\{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;
    const queuePanelRule = styles.match(
      /\.training-queue-widget__panel--queue\s*\{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;

    expect(sectionGroupsRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(sectionGroupsRule).toContain("align-items: start");
    expect(queuePanelRule).toContain("width: min(760px, calc(100vw - 36px))");
    expect(styles).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.training-queue-widget__section-groups\s*\{[\s\S]*?grid-template-columns:\s*1fr/u);
  });

  it("keeps header popovers above page sections but below modal overlays", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.app-header\s*\{[\s\S]*?z-index:\s*36/u);
    expect(styles).toMatch(/\.training-queue-widget\s*\{[\s\S]*?z-index:\s*35/u);
    expect(styles).toMatch(/\.modal-backdrop\s*\{[\s\S]*?z-index:\s*40/u);
  });

  it("renders the brand mark as a logo image instead of a text badge", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const brandMarkRule = styles.match(/(?:^|\n)\.brand__mark\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body;
    const brandImageRule = styles.match(/(?:^|\n)\.brand__mark img\s*\{(?<body>[\s\S]*?)\n\}/u)?.groups?.body;

    expect(brandMarkRule).toContain("width: 68px");
    expect(brandMarkRule).toContain("height: 29px");
    expect(brandMarkRule).toContain("background: transparent");
    expect(brandMarkRule).toContain("border: 0");
    expect(brandImageRule).toContain("object-fit: contain");
  });

  it("marks actionable selected rows without a gray filled background", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const selectedRule = styles.match(
      /\.project-card\[data-selected="true"\],[\s\S]*?\.data-table tr\[data-selected="true"\] td\s*\{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;

    expect(selectedRule).toContain("background: var(--surface)");
    expect(selectedRule).toContain("box-shadow: inset 3px 0 0");
    expect(selectedRule).not.toContain("var(--surface-subtle)");
    expect(styles).not.toContain(".dataset-row[data-selected=\"true\"]");
    expect(styles).not.toContain(".inference-run-row[data-selected=\"true\"]");
    expect(styles).toMatch(/\.project-sidebar__row\[data-selected="true"\]\s*\{[^}]*?background:\s*transparent/u);
    expect(styles).toMatch(/\.data-table tbody tr\[data-selected="true"\]:hover td\s*\{[^}]*?background:\s*var\(--surface\)/u);
  });

  it("keeps primary action buttons visible without a black filled treatment", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const primaryRules = [...styles.matchAll(/\.primary-button\s*\{(?<body>[\s\S]*?)\n\}/gu)];
    const primaryRule = primaryRules.at(-1)?.groups?.body;

    expect(primaryRule).toContain("border-color: var(--border-strong)");
    expect(primaryRule).toContain("background: color-mix(in srgb, var(--surface) 78%, var(--surface-strong))");
    expect(primaryRule).toContain("color: var(--text)");
    expect(primaryRule).not.toContain("background: var(--text)");
    expect(primaryRule).not.toContain("color: var(--surface)");
  });

  it("renders expanded dataset splits as a light inline section", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.dataset-row-detail\s*\{[^}]*?margin-top:\s*-1px/u);
    expect(styles).toMatch(/\.dataset-row-detail\s*\{[^}]*?border-top:\s*1px solid var\(--border\)/u);
    expect(styles).toMatch(/\.dataset-row-detail\s*\{[^}]*?background:\s*color-mix\(in srgb,\s*var\(--surface\) 88%,\s*transparent\)/u);
    expect(styles).toMatch(/\.dataset-row-detail\s*\{[^}]*?box-shadow:\s*none/u);
    expect(styles).not.toMatch(/\.dataset-row-detail\s*\{[^}]*?border-color:\s*var\(--text\)/u);
    expect(styles).toMatch(/\.dataset-row-detail\s+\.split-row\s*\{[^}]*?border-color:\s*var\(--border\)/u);
    expect(styles).toMatch(/\.dataset-row-detail\s+\.split-row\s*\{[^}]*?background:\s*color-mix\(in srgb,\s*var\(--surface\) 92%,\s*transparent\)/u);
    expect(styles).toMatch(/\.split-row\s*\{[^}]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto/u);
    expect(styles).not.toMatch(/\.dataset-row-detail\s+\.split-row > svg/u);
  });

  it("keeps notification settings page styles available", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/NotificationSettingsPage.tsx"),
      "utf8",
    );

    expect(styles).toContain(".settings-page");
    expect(styles).toContain(".settings-page__header");
    expect(styles).toContain(".notification-settings-grid");
    expect(styles).toContain(".notification-card");
    expect(source).toContain('className="settings-page"');
    expect(source).toContain('className="settings-page__header"');
    expect(source).toContain('className="notification-settings-grid"');
    expect(source).toContain('className="notification-card"');
    expect(source).not.toContain('className="panel panel--wide"');
    expect(source).not.toContain('className="project-card-grid"');
    expect(source).not.toContain('className="panel notification');
  });

  it("keeps notification cards equal height with a webhook spacer", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/NotificationSettingsPage.tsx"),
      "utf8",
    );
    const gridRule = styles.match(
      /\.notification-settings-grid\s*\{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;
    const cardRule = styles.match(/\.notification-card\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const formRule = styles.match(/\.notification-card form\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const spacerRule = styles.match(/\.notification-card__webhook-spacer\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const helpRule = styles.match(/\.notification-help\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const openHelpRule = styles.match(/\.notification-help\[open\]\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const helpSummaryRule = styles.match(/\.notification-help summary\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const helpBodyRule = styles.match(/\.notification-help__body\s*\{(?<body>[\s\S]*?)\n\}/u)
      ?.groups?.body;
    const notificationButtonRule = styles.match(
      /\.notification-card \.button-row\s*\{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body;

    expect(gridRule).not.toContain("align-items: start");
    expect(cardRule).toContain("display: grid");
    expect(formRule).toContain("height: 100%");
    expect(formRule).not.toContain("minmax(0, 1fr)");
    expect(spacerRule).toContain("height: 62px");
    expect(helpRule).toContain("display: flex");
    expect(helpRule).toContain("justify-content: center");
    expect(helpRule).toContain("min-height: 48px");
    expect(helpRule).toContain("position: relative");
    expect(openHelpRule).toContain("z-index: 20");
    expect(helpSummaryRule).toContain("min-height: 24px");
    expect(helpBodyRule).toContain("position: absolute");
    expect(helpBodyRule).toContain("top: calc(100% + 8px)");
    expect(notificationButtonRule).toContain("margin-top: auto");
    expect(source).toContain('className="notification-card__webhook-spacer"');
  });
});
