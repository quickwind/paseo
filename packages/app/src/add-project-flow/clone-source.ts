import { INTERNAL_EDITION } from "@getpaseo/protocol/internal-edition";
import { i18n } from "@/i18n/i18next";

// Internal edition: Add Project clones from the host's configured GitLab, so
// the "Clone from GitHub" method, its search, and its copy are replaced here.
// The flow keeps its internal `github` method and page ids; only what the user
// sees and which RPCs run change. `isForge` selects the forge RPCs
// (workspace.forge.search_repositories, project.forge.clone). The icon is chosen in
// add-project-flow.tsx: brand icons pull in react-native-svg, which plain unit tests cannot load.

export interface CloneSourceCopy {
  isForge: boolean;
  methodLabel: string;
  methodDescription: (input: { canClone: boolean; canSearch: boolean }) => string;
  pageTitle: string;
  searchPlaceholder: string;
  emptyHint: string;
  searchFailed: string;
  searchUnavailable: string;
  manualUrl: string;
  manualPath: string;
}

function forgeCopy(): CloneSourceCopy {
  const t = (key: string) => i18n.t(`addProjectFlow.forgeClone.${key}`);
  return {
    isForge: true,
    methodLabel: t("method"),
    methodDescription: ({ canClone, canSearch }) => {
      if (!canClone) return t("methodDescriptionUpdate");
      return canSearch ? t("methodDescriptionSearch") : t("methodDescriptionManual");
    },
    pageTitle: t("pageTitle"),
    searchPlaceholder: t("searchPlaceholder"),
    emptyHint: t("emptyHint"),
    searchFailed: t("searchFailed"),
    searchUnavailable: t("searchUnavailable"),
    manualUrl: t("manualUrl"),
    manualPath: t("manualPath"),
  };
}

function githubCopy(): CloneSourceCopy {
  return {
    isForge: false,
    methodLabel: "Clone from GitHub",
    methodDescription: ({ canClone, canSearch }) => {
      if (!canClone) return "Update this host to clone GitHub repositories";
      return canSearch
        ? "Search projects available to your GitHub account"
        : "Enter a GitHub URL or owner/repo";
    },
    pageTitle: "Clone from GitHub",
    searchPlaceholder: "Search or enter a GitHub repository...",
    emptyHint: "Enter a GitHub URL or owner/repo",
    searchFailed: "Unable to search GitHub repositories",
    searchUnavailable: "GitHub search is unavailable",
    manualUrl: "Clone this repository URL",
    manualPath: "Clone owner/repo",
  };
}

/** Read at call time so the copy follows the active language. */
export function getCloneSourceCopy(): CloneSourceCopy {
  return INTERNAL_EDITION.forgeRepositoryClone ? forgeCopy() : githubCopy();
}
