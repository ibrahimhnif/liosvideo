export interface ScopeCheckResult {
  hasOutOfScope: boolean;
  outOfScopeFiles: string[];
}

export function detectOutOfScopeChanges(
  changedFiles: string[],
  selection?: { composition?: string; sceneFile?: string }
): ScopeCheckResult {
  if (!selection || (!selection.sceneFile && !selection.composition)) {
    return { hasOutOfScope: false, outOfScopeFiles: [] };
  }

  const allowed = new Set<string>();
  if (selection.composition) allowed.add(selection.composition);
  if (selection.sceneFile) allowed.add(selection.sceneFile);

  const outOfScopeFiles = changedFiles.filter((file) => {
    // Assets, vo, project settings, script are not considered out-of-scope violations
    if (file.startsWith("assets/") || file === "script.md" || file.startsWith(".liosvideo/")) {
      return false;
    }
    // Flag code/scene files that belong to other scenes or compositions
    if (file.endsWith(".ts") && !allowed.has(file)) {
      return true;
    }
    return false;
  });

  return {
    hasOutOfScope: outOfScopeFiles.length > 0,
    outOfScopeFiles,
  };
}
