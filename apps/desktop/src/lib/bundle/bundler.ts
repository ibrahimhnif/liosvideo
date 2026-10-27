import * as esbuild from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";

export type BuildError = { file: string; line: number; column: number; message: string };
export type BuildResult = { ok: true; code: string; files: string[] } | { ok: false; errors: BuildError[] };

const PROJECT = "project";
const RUNTIME = "lios-runtime";

let ready: Promise<void> | undefined;
function init(): Promise<void> {
  ready ??= esbuild.initialize(typeof window === "undefined" ? {} : { wasmURL });
  return ready;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const dirname = (p: string) => p.split("/").slice(0, -1).join("/");

function toError(m: esbuild.Message): BuildError {
  return {
    file: m.location?.file.replace(`${PROJECT}:`, "") ?? "",
    line: m.location?.line ?? 0,
    column: m.location?.column ?? 0,
    message: m.text,
  };
}

/** Bundles a project entry file. Only `liosvideo` (mapped to `globalThis.__liosvideo`) and relative imports resolve. */
export async function bundleComposition(entry: string, readFile: (rel: string) => Promise<string>): Promise<BuildResult> {
  await init();
  const files = new Set<string>();
  const exists = async (rel: string) => {
    try {
      await readFile(rel);
      return true;
    } catch {
      return false;
    }
  };

  const plugin: esbuild.Plugin = {
    name: "liosvideo-project",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") return { path: normalize(args.path), namespace: PROJECT };
        if (args.path === "liosvideo") return { path: "liosvideo", namespace: RUNTIME };
        if (!args.path.startsWith(".")) {
          return { errors: [{ text: "Only 'liosvideo' and relative imports are allowed" }] };
        }
        const base = normalize(`${dirname(args.importer)}/${args.path}`);
        for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
          if (/\.ts$/.test(candidate) && (await exists(candidate))) return { path: candidate, namespace: PROJECT };
        }
        return { errors: [{ text: `Could not resolve "${args.path}"` }] };
      });
      build.onLoad({ filter: /.*/, namespace: PROJECT }, async (args) => {
        files.add(args.path);
        return { contents: await readFile(args.path), loader: "ts" };
      });
      build.onLoad({ filter: /.*/, namespace: RUNTIME }, () => ({
        contents: "module.exports = globalThis.__liosvideo",
        loader: "js",
      }));
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "__liosProject",
      target: "es2022",
      sourcemap: "inline",
      plugins: [plugin],
      logLevel: "silent",
    });
    return { ok: true, code: result.outputFiles[0].text, files: [...files] };
  } catch (e) {
    const errors = (e as esbuild.BuildFailure).errors;
    if (!errors) throw e;
    return { ok: false, errors: errors.map(toError) };
  }
}

/** Debounces build triggers and only applies the newest build's result. */
export class BuildCoordinator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = 0;
  private applied = 0;

  constructor(
    private readonly build: () => Promise<BuildResult>,
    private readonly onResult: (r: BuildResult) => void,
    private readonly debounceMs = 80,
  ) {}

  trigger(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.debounceMs);
  }

  private async run(): Promise<void> {
    const generation = ++this.started;
    const result = await this.build();
    if (generation <= this.applied) return;
    this.applied = generation;
    this.onResult(result);
  }
}
