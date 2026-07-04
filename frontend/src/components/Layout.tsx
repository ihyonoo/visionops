import {
  Bell,
  FolderKanban,
  Search,
  Settings,
} from "lucide-react";
import { ReactNode, useState } from "react";

import { LanguageControl, useLanguage } from "../i18n/LanguageProvider";
import { ThemeControl } from "../theme/ThemeProvider";

type LayoutProps = {
  children: ReactNode;
  currentView: "projects" | "project-detail";
  onOpenProjects: () => void;
  title: string;
};

export function Layout({
  children,
  currentView,
  onOpenProjects,
  title,
}: LayoutProps) {
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { t } = useLanguage();

  return (
    <div className="app-shell">
      <div className="workspace">
        <header className="app-header">
          <div className="header-left">
            <button
              aria-label="VisionOps"
              className="brand brand--header"
              onClick={onOpenProjects}
              title="VisionOps"
              type="button"
            >
              <span className="brand__mark" aria-hidden="true">
                VO
              </span>
              <span>
                <span className="brand__name">VisionOps</span>
              </span>
            </button>
            <div className="header-title">
              <h1>{title}</h1>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              data-active={currentView === "projects" ? "true" : undefined}
              aria-label={t("nav.projects")}
              onClick={onOpenProjects}
              title={t("nav.projects")}
              type="button"
            >
              <FolderKanban aria-hidden="true" size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={t("header.search")}
              onClick={() => {
                setSettingsOpen(false);
                setHeaderNotice(t("header.searchSoon"));
              }}
              title={t("header.search")}
              type="button"
            >
              <Search aria-hidden="true" size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={t("header.notifications")}
              onClick={() => {
                setSettingsOpen(false);
                setHeaderNotice(t("header.noNotifications"));
              }}
              title={t("header.notifications")}
              type="button"
            >
              <Bell aria-hidden="true" size={18} />
            </button>
            <div className="settings-wrapper">
              <button
                aria-controls="settings-panel"
                aria-expanded={settingsOpen}
                className="icon-button"
                data-active={settingsOpen ? "true" : undefined}
                aria-label={t("header.settings")}
                onClick={() => {
                  setHeaderNotice(null);
                  setSettingsOpen((isOpen) => !isOpen);
                }}
                title={t("header.settings")}
                type="button"
              >
                <Settings aria-hidden="true" size={18} />
              </button>
              {settingsOpen ? (
                <div
                  className="settings-panel"
                  id="settings-panel"
                  role="dialog"
                  aria-label={t("header.settings")}
                >
                  <div className="settings-panel__section">
                    <div className="settings-panel__header">
                      <span>{t("settings.theme")}</span>
                    </div>
                    <ThemeControl />
                  </div>
                  <div className="settings-panel__section">
                    <div className="settings-panel__header">
                      <span>{t("settings.language")}</span>
                    </div>
                    <LanguageControl />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {headerNotice ? (
            <div className="header-notice" role="status">
              {headerNotice}
            </div>
          ) : null}
        </header>

        <main className="dashboard" aria-label={t("app.workspace")}>
          {children}
        </main>
      </div>
    </div>
  );
}
