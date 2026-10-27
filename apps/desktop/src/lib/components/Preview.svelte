<script lang="ts">
  import { playhead } from "$lib/playhead.svelte";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { BuildCoordinator, bundleComposition, type BuildError } from "$lib/bundle/bundler";
  import { devLog, devSnapshots } from "$lib/devlog";
  import { loadProjectImage } from "$lib/preview/assets";
  import { AudioPlayer } from "$lib/preview/audio_player";
  import { PlaybackClock } from "$lib/preview/clock";
  import { PreviewHost, SceneError, SupersededError, arrayBufferToBase64 } from "$lib/preview/host";
  import type { LoadedInfo, SourceLocation } from "$lib/preview/protocol";
  import { reconcileSelection, visibleRows } from "$lib/timeline/model";
  import { select, selection } from "$lib/timeline/selection.svelte";
  import { shouldRebuild, touchesRootFiles } from "$lib/preview/rebuild";
  import { ExportEngine, type ExportConfig } from "$lib/export/export_engine";
  import { mixdownAudio } from "$lib/export/audio_mixdown";
  import ErrorOverlay from "./ErrorOverlay.svelte";
  import Timeline from "./Timeline.svelte";
  import Transport from "./Transport.svelte";

  let {
    entry,
    onRootFilesChanged,
    onInfoChanged,
  }: {
    entry: string;
    onRootFilesChanged: () => void;
    onInfoChanged?: (info: LoadedInfo | null) => void;
  } = $props();

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let frame = $state(0);
  $effect(() => {
    playhead.frame = frame;
    playhead.fps = info?.fps ?? 30;
  });
  let playing = $state(false);
  let info = $state<LoadedInfo | null>(null);
  let buildErrors = $state<BuildError[]>([]);
  let runtimeError = $state<{ message: string; stack?: string; location?: SourceLocation } | undefined>();

  const clock = new PlaybackClock(30, 0);
  const audioPlayer = new AudioPlayer();
  let host: PreviewHost;
  let currentExportEngine: ExportEngine | null = null;
  let lastFiles = new Set<string>();
  let lastBuildOk = true;
  let buildToken = 0;
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
      const token = ++buildToken;
      lastBuildOk = result.ok;
      if (!result.ok) {
        devLog(`build-error ${entry} ${JSON.stringify(result.errors)}`);
        buildErrors = result.errors;
        return;
      }
      buildErrors = [];
      lastFiles = new Set(result.files);
      try {
        const loaded = await host.load(result.code);
        if (token !== buildToken) return;
        const sizeChanged = !info || info.width !== loaded.width || info.height !== loaded.height;
        info = loaded;
        onInfoChanged?.(loaded);
        runtimeError = undefined;
        clock.setLength(loaded.fps, loaded.totalFrames);
        const allClips = loaded.manifest.audioTracks?.flatMap((t) => t.clips) ?? [];
        audioPlayer.setClips(allClips).catch((e) => devLog(`audio-error ${e}`));
        select(reconcileSelection(selection.current, entry, loaded.manifest));
        invoke("report_timeline_manifest", { composition: entry, manifest: loaded.manifest }).catch(() => {});
        devLog(`timeline ${entry} ${visibleRows(loaded.manifest, new Set(loaded.manifest.scenes.map((s) => s.id))).map((r) => "  ".repeat(r.depth) + r.label).join(" | ")}`);
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
        if (e instanceof SupersededError || token !== buildToken) return;
        devLog(`load-failed ${entry} ${(e as Error).message}`);
        runtimeError = { message: (e as Error).message, location: e instanceof SceneError ? e.location : undefined };
      }
    },
  );

  function toggle() {
    const now = performance.now();
    if (clock.playing) {
      clock.pause(now);
      audioPlayer.pause();
    } else {
      clock.play(now);
      audioPlayer.play(clock.frameAt(now), info?.fps ?? 30);
    }
    playing = clock.playing;
  }

  function seek(f: number) {
    clock.seek(f);
    const targetFrame = clock.frameAt(performance.now());
    show(targetFrame);
    audioPlayer.seek(targetFrame, info?.fps ?? 30);
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

  export async function runExport(config: ExportConfig, onProgress: (pct: number) => void): Promise<string> {
    if (!host || !info) throw new Error("Composition not loaded");
    if (clock.playing) toggle();

    host.resize(config.width, config.height);
    currentExportEngine = new ExportEngine(config);

    try {
      const audioBuffer = info.manifest
        ? await mixdownAudio(info.manifest, async (src) => {
            const path = await invoke<string>("asset_url_path", { rel: src });
            const url = convertFileSrc(path);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Could not load audio asset "${src}" (${res.status})`);
            return res.arrayBuffer();
          })
        : null;

      const bytes = await currentExportEngine.export(
        async (f) => {
          await host.renderFrame(f);
          return canvas;
        },
        audioBuffer,
        onProgress,
      );

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${entry.replace(/\.ts$/, "")}-${timestamp}.mp4`;
      const filePath = await invoke<string>("save_exported_video", {
        filename,
        bytes: Array.from(bytes),
      });
      return filePath;
    } finally {
      currentExportEngine = null;
      fitCanvas();
      await host.renderFrame(frame);
    }
  }

  export function cancelExport() {
    currentExportEngine?.cancel();
  }

  onMount(() => {
    canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    host = new PreviewHost(canvas, loadProjectImage);
    host.onError((e) => {
      devLog(`preview-error ${e.phase} ${e.message}${e.location ? ` at ${e.location.file}:${e.location.line}` : ""}`);
      runtimeError = { message: e.message, stack: e.stack, location: e.location };
    });

    const resize = new ResizeObserver(fitCanvas);
    resize.observe(stage);

    let raf = 0;
    const tick = () => {
      const wasPlaying = playing;
      if (clock.playing) show(clock.frameAt(performance.now()));
      playing = clock.playing;
      if (wasPlaying && !playing) {
        audioPlayer.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const unlisten = listen<{ paths: string[] }>("project://changed", ({ payload }) => {
      if (touchesRootFiles(payload.paths)) onRootFilesChanged();
      if (shouldRebuild(payload.paths, lastFiles, lastBuildOk)) {
        devLog(`changed ${payload.paths.join(",")}`);
        builds.trigger();
      }
    });

    const unlistenCapture = listen<{ id: string; frame: number; composition?: string }>(
      "editor://capture_frame",
      async ({ payload }) => {
        try {
          if (!host) {
            await invoke("report_captured_frame", { id: payload.id, data: "" });
            return;
          }
          await host.renderFrame(payload.frame);
          frame = payload.frame;
          const buffer = await host.snapshot();
          const data = arrayBufferToBase64(buffer);
          await invoke("report_captured_frame", { id: payload.id, data });
        } catch (e) {
          devLog(`capture-frame-failed ${payload.id} ${(e as Error).message}`);
          await invoke("report_captured_frame", { id: payload.id, data: "" }).catch(() => {});
        }
      },
    );

    const unlistenSeek = listen<{ frame: number; timeSeconds: number }>(
      "preview://seek",
      ({ payload }) => {
        seek(payload.frame);
      },
    );

    builds.trigger();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      window.removeEventListener("keydown", onKey);
      void unlisten.then((u) => u());
      void unlistenCapture.then((u) => u());
      void unlistenSeek.then((u) => u());
      audioPlayer.destroy();
      host.dispose();
    };
  });
</script>

<div class="preview">
  <div class="stage" bind:this={stage} style:--aspect={info ? `${info.width} / ${info.height}` : "16 / 9"}>
    <ErrorOverlay {buildErrors} {runtimeError} />
  </div>
  <Transport {frame} totalFrames={info?.totalFrames ?? 0} fps={info?.fps ?? 30} {playing} scenes={info?.scenes ?? []} onToggle={toggle} onSeek={seek} />
  {#if info}
    <Timeline manifest={info.manifest} composition={entry} {frame} selected={selection.current} onSelect={select} onSeek={seek} />
  {/if}
</div>

<style>
  .preview { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; background: #050505; overflow: hidden; }
  .stage :global(canvas) { max-width: 100%; max-height: 100%; aspect-ratio: var(--aspect); width: auto; height: 100%; object-fit: contain; }
</style>
