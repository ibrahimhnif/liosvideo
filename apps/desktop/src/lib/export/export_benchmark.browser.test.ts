import { describe, expect, it } from "vitest";
import { PreviewHost } from "../preview/host";
import { ExportEngine } from "./export_engine";

const project = (body: string) =>
  `var __liosProject = (() => { const L = globalThis.__liosvideo; return { default: ${body} }; })();`;

describe("Export benchmark", () => {
  it("renders and encodes 60 frames with WebGPU and WebCodecs without deadlock", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const host = new PreviewHost(canvas, async () => createImageBitmap(new ImageData(1, 1)));

    try {
      const code = project(`
        L.composition({
          width: 640,
          height: 360,
          fps: 30,
          scenes: [
            L.scene("bench", { duration: 2 }, ({ root, width, height }) => {
              const card = root.add(L.rect({
                name: "card",
                x: width / 2,
                y: height / 2,
                width: width * 0.6,
                height: height * 0.4,
                anchorX: 0.5,
                anchorY: 0.5,
                fill: "#38bdf8",
              }));
              card.to({ scaleX: 1.2, scaleY: 1.2 }, { at: 0.5, duration: 0.5 });
            })
          ]
        })
      `);

      const info = await host.load(code);
      expect(info.totalFrames).toBe(60);

      const targetFrames = 60;
      const engine = new ExportEngine({
        width: 640,
        height: 360,
        fps: 30,
        totalFrames: targetFrames,
        bitrate: 4_000_000,
      });

      const frameTimes: number[] = [];
      const t0 = performance.now();

      const mp4Bytes = await engine.export(
        async (f) => {
          const start = performance.now();
          await host.renderFrame(f);
          frameTimes.push(performance.now() - start);
          return canvas;
        },
        null,
      );

      const totalMs = performance.now() - t0;
      const avgRenderMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const fps = (targetFrames / (totalMs / 1000)).toFixed(1);

      console.log(`[Benchmark] ${targetFrames} frames completed in ${totalMs.toFixed(1)}ms (${fps} fps, avg render: ${avgRenderMs.toFixed(1)}ms/frame). Output size: ${mp4Bytes.length} bytes`);

      expect(mp4Bytes).toBeInstanceOf(Uint8Array);
      expect(mp4Bytes.length).toBeGreaterThan(100);
      expect(frameTimes.length).toBe(targetFrames);
    } finally {
      host.dispose();
      canvas.remove();
    }
  }, 30000);

  it("encodes video with audio track", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    document.body.appendChild(canvas);

    // Create a 1-second stereo audio buffer with 440Hz sine wave
    const sampleRate = 48000;
    const audioCtx = new OfflineAudioContext(2, sampleRate, sampleRate);
    const osc = audioCtx.createOscillator();
    osc.frequency.value = 440;
    osc.connect(audioCtx.destination);
    osc.start();
    const audioBuffer = await audioCtx.startRendering();

    const engine = new ExportEngine({
      width: 320,
      height: 240,
      fps: 30,
      totalFrames: 30,
      bitrate: 2_000_000,
      audioBitrate: 128_000,
    });

    const ctx = canvas.getContext("2d")!;
    const bytes = await engine.export(
      async (f) => {
        ctx.fillStyle = f % 2 === 0 ? "#ff0000" : "#00ff00";
        ctx.fillRect(0, 0, 320, 240);
        return canvas;
      },
      audioBuffer,
    );

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(500);
    canvas.remove();
  }, 30000);

  it("encodes across multiple 60-frame flush boundaries without error", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    document.body.appendChild(canvas);

    const engine = new ExportEngine({
      width: 320,
      height: 240,
      fps: 30,
      totalFrames: 130, // cross 60 and 120
      bitrate: 2_000_000,
    });

    const ctx = canvas.getContext("2d")!;
    const bytes = await engine.export(async (f) => {
      ctx.fillStyle = f % 2 === 0 ? "#112233" : "#445566";
      ctx.fillRect(0, 0, 320, 240);
      return canvas;
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    canvas.remove();
  }, 30000);
});
