export type Capabilities = {
  webgpu: boolean;
  webgpuInWorker: boolean;
  offscreen2dInWorker: boolean;
  systemFontInWorker: boolean;
  videoEncoderH264: boolean;
  videoDecoderH264: boolean;
  audioEncoderAAC: boolean;
};

export type WorkerCapabilities = Pick<Capabilities, "webgpuInWorker" | "offscreen2dInWorker" | "systemFontInWorker">;

const BLOCKING: (keyof Capabilities)[] = ["webgpu", "webgpuInWorker", "offscreen2dInWorker"];

export function blockingFailures(c: Capabilities): string[] {
  return BLOCKING.filter((k) => !c[k]);
}

async function hasAdapter(gpu: GPU | undefined): Promise<boolean> {
  try {
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function supported(check: () => Promise<{ supported?: boolean }> | undefined): Promise<boolean> {
  try {
    return !!(await check())?.supported;
  } catch {
    return false;
  }
}

/** Runs inside the probe worker. */
export async function probeWorkerScope(): Promise<WorkerCapabilities> {
  const webgpuInWorker = await hasAdapter((self.navigator as Navigator).gpu);
  let offscreen2dInWorker = false;
  let systemFontInWorker = false;
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    offscreen2dInWorker = !!ctx;
    if (ctx) {
      ctx.font = '13px "SF Pro Text"';
      const sf = ctx.measureText("Ag").width;
      ctx.font = "13px monospace";
      systemFontInWorker = sf !== ctx.measureText("Ag").width;
    }
  } catch {
    // leave false
  }
  return { webgpuInWorker, offscreen2dInWorker, systemFontInWorker };
}

export async function probeCapabilities(): Promise<Capabilities> {
  const worker = new Worker(new URL("./probe.worker.ts", import.meta.url), { type: "module" });
  const inWorker = await new Promise<WorkerCapabilities>((resolve) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = () => resolve({ webgpuInWorker: false, offscreen2dInWorker: false, systemFontInWorker: false });
  });
  worker.terminate();
  return {
    webgpu: await hasAdapter(navigator.gpu),
    ...inWorker,
    videoEncoderH264: await supported(() =>
      globalThis.VideoEncoder?.isConfigSupported({ codec: "avc1.640028", width: 1920, height: 1080, bitrate: 8e6, framerate: 30 }),
    ),
    videoDecoderH264: await supported(() => globalThis.VideoDecoder?.isConfigSupported({ codec: "avc1.640028" })),
    audioEncoderAAC: await supported(() =>
      globalThis.AudioEncoder?.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }),
    ),
  };
}
