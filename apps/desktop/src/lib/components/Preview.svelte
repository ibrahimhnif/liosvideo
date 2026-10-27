<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { SceneSpan } from "liosvideo";
  import { onMount } from "svelte";
  import { BuildCoordinator, bundleComposition, type BuildError } from "$lib/bundle/bundler";
  import { devLog, devSnapshots } from "$lib/devlog";
  import { loadProjectImage } from "$lib/preview/assets";
  import { PlaybackClock } from "$lib/preview/clock";
  import { PreviewHost } from "$lib/preview/host";
  import ErrorOverlay from "./ErrorOverlay.svelte";
  import Transport from "./Transport.svelte";

  let { entry, onRootFilesChanged }: { entry: string; onRootFilesChanged: () => void } = $props();

  let stage: HTMLDivElement;
  let frame = $state(0);
  let playing = $state(false);
  let info = $state<{ width: number; height: number; fps: number; totalFrames: number; scenes: SceneSpan[] } | null>(null);
  let buildErrors = $state<BuildError[]>([]);
  let runtimeError = $state<{ message: string; stack?: string } | undefined>();

  const clock = new PlaybackClock(30, 0);
  let host: PreviewHost;
  let lastFiles = new Set<string>();
  let requested = -1;
  let loadCount = 0;

  const readFile = (rel: string) => invoke<string>("read_project_file", { rel });

  function fitCanvas() {
    if (!info || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(1, (stage.clientWidth * dpr) / info.width, (stage.clientHeight * dpr) / info.height);
    host.resize(Math.max(1, Math.round(info.width * scale)), Math.max(1, Math.round(info.height * scale)));
  }

  function show(f: number) {
    frame = f;
    if (f !== requested) {
      requested = f;
      host.requestFrame(f);
    }
  }

  const builds = new BuildCoordinator(
    () => bundleComposition(entry, readFile),
    async (result) => {
      if (!result.ok) {
        devLog(`build-error ${entry} ${JSON.stringify(result.errors)}`);
        buildErrors = result.errors;
        return;
      }
      buildErrors = [];
      lastFiles = new Set(result.files);
      try {
        const loaded = await host.load(result.code);
        const sizeChanged = !info || info.width !== loaded.width || info.height !== loaded.height;
        info = loaded;
        runtimeError = undefined;
        clock.setLength(loaded.fps, loaded.totalFrames);
        if (sizeChanged) fitCanvas();
        requested = -1;
        const f = clock.frameAt(performance.now());
        frame = f;
        requested = f;
        await host.renderFrame(f);
        devLog(`loaded ${entry} ${loaded.width}x${loaded.height} frames=${loaded.totalFrames} rendered=${f}`);
        const probes = [0, 30, 95, 129, 150, 204, 240, loaded.totalFrames - 1].filter((p) => p < loaded.totalFrames);
        await devSnapshots(`${entry.replace(/\.ts$/, "")}-${++loadCount}`, probes, (p) => host.renderFrame(p), () => host.snapshot());
        await host.renderFrame(frame);
      } catch (e) {
        devLog(`load-failed ${entry} ${(e as Error).message}`);
        runtimeError ??= { message: (e as Error).message };
      }
    },
  );

  function toggle() {
    const now = performance.now();
    if (clock.playing) clock.pause(now);
    else clock.play(now);
    playing = clock.playing;
  }

  function seek(f: number) {
    clock.seek(f);
    show(clock.frameAt(performance.now()));
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable]") && !(t instanceof HTMLInputElement && t.type === "range")) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (clock.playing) toggle();
      seek(frame + (e.key === "ArrowRight" ? 1 : -1));
    }
  }

  onMount(() => {
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    host = new PreviewHost(canvas, loadProjectImage);
    host.onError((e) => {
      devLog(`preview-error ${e.phase} ${e.message}`);
      runtimeError = { message: e.message, stack: e.stack };
    });

    const resize = new ResizeObserver(fitCanvas);
    resize.observe(stage);

    let raf = 0;
    const tick = () => {
      if (clock.playing) show(clock.frameAt(performance.now()));
      playing = clock.playing;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const unlisten = listen<{ paths: string[] }>("project://changed", ({ payload }) => {
      const rootTs = payload.paths.some((p) => !p.includes("/") && p.endsWith(".ts"));
      if (rootTs) onRootFilesChanged();
      if (rootTs || payload.paths.some((p) => lastFiles.has(p))) {
        devLog(`changed ${payload.paths.join(",")}`);
        builds.trigger();
      }
    });

    builds.trigger();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener("keydown", onKey);
      void unlisten.then((u) => u());
      host.dispose();
    };
  });
</script>

<div class="preview">
  <div class="stage" bind:this={stage} style:--aspect={info ? `${info.width} / ${info.height}` : "16 / 9"}>
    <ErrorOverlay {buildErrors} {runtimeError} />
  </div>
  <Transport {frame} totalFrames={info?.totalFrames ?? 0} fps={info?.fps ?? 30} {playing} scenes={info?.scenes ?? []} onToggle={toggle} onSeek={seek} />
</div>

<style>
  .preview { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; background: #050505; overflow: hidden; }
  .stage :global(canvas) { max-width: 100%; max-height: 100%; aspect-ratio: var(--aspect); width: auto; height: 100%; object-fit: contain; }
</style>
