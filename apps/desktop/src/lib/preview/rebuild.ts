const isRootTs = (p: string) => !p.includes("/") && p.endsWith(".ts");

/**
 * Whether a set of changed project paths needs a rebuild. After a failed build any .ts change counts,
 * since the failure may be an import of a file that is only now being created.
 */
export function shouldRebuild(paths: string[], lastFiles: Set<string>, lastBuildOk: boolean): boolean {
  return paths.some((p) => isRootTs(p) || lastFiles.has(p) || (!lastBuildOk && p.endsWith(".ts")));
}

export function touchesRootFiles(paths: string[]): boolean {
  return paths.some(isRootTs);
}
