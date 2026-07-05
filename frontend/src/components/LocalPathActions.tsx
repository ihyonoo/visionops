import { Copy, FolderOpen } from "lucide-react";

import type { TranslationFunction } from "../i18n/LanguageProvider";
import { copyLocalPath, isManagedVisionOpsPath, openLocalPath } from "../utils/localPaths";

type LocalPathActionsProps = {
  path: string | null | undefined;
  t: TranslationFunction;
  variant?: "button" | "menu";
};

export function LocalPathActions({ path, t, variant = "button" }: LocalPathActionsProps) {
  if (!path) return null;

  const buttonClassName = variant === "button" ? "secondary-button local-path-action" : undefined;
  const isManagedPath = isManagedVisionOpsPath(path);

  return (
    <>
      {isManagedPath ? (
        <button
          className={buttonClassName}
          onClick={() => {
            void openLocalPath(path).catch(() => undefined);
          }}
          title={path}
          type="button"
        >
          <FolderOpen aria-hidden="true" size={15} />
          <span>{t("localFiles.openFolder")}</span>
        </button>
      ) : null}
      <button
        className={buttonClassName}
        onClick={() => {
          void copyLocalPath(path).catch(() => undefined);
        }}
        title={path}
        type="button"
      >
        <Copy aria-hidden="true" size={15} />
        <span>{t("localFiles.copyPath")}</span>
      </button>
    </>
  );
}
