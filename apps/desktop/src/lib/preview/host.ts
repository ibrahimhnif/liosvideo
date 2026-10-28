import type { FromWorker, LoadedInfo, PreviewError, SourceLocation, ToWorker } from "./protocol";
import { locate } from "./sourcemap";

export const WATCHDOG_MS = 5000;

const defaultWorker = () => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };
type Load = Pending<LoadedInfo> & { code: string; sentAt: number };

/** A load that a newer load replaced before it was applied. Callers can ignore it. */
export class SupersededError extends Error {
  override name = "SupersededError";
  constructor() {
    super("Superseded by a newer load");
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** A scene error, with its position in the project source when the stack could be mapped. */
export class SceneError extends Error {
  constructor(
    message: string,
    readonly location?: SourceLocation,
  ) {
    super(message);
  }
}

/** Owns the render worker: loading code, latest-wins frame requests, and a watchdog for hung scene code. */
export class PreviewHost {
  private worker!: Worker;
  private generation = 0;
  private nextId = 0;
  private loads = new Map<number, Load>();
  /** newest generation the worker reported as loaded, and its code (for mapping errors and replays) */
  private applied: { generation: number; code: string } | undefined;
  private inFlight: { id: number; frame: number; sentAt: number } | undefined;
  private pendingFrame: number | undefined;
  private forcedFrames: number[] = [];
  private snapshots = new Map<number, Pending<ArrayBuffer>>();
  private frameWaiters: { frame: number; resolve: () => void }[] = [];
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private errorListeners: ((e: PreviewError) => void)[] = [];
  private sentAssets = new Set<string>();
  private size: { width: number; height: number } | undefined;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private readonly resolveAsset: (src: string) => Promise<ImageBitmap>,
    private readonly makeWorker: () => Worker = defaultWorker,
  ) {
    this.start();
  }

  /** The current canvas element (replaced after a restart). */
  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  onError(cb: (e: PreviewError) => void): void {
    this.errorListeners.push(cb);
  }

  resize(width: number, height: number): void {
    this.size = { width, height };
    this.post({ type: "resize", width, height });
  }

  setTimings(timings: Record<string, any>): void {
    this.post({ type: "timings", timings });
  }

  /** Loads a bundle. Rejects with SceneError, SupersededError, or a timeout Error. */
  load(code: string): Promise<LoadedInfo> {
    const generation = ++this.generation;
    const done = new Promise<LoadedInfo>((resolve, reject) =>
      this.loads.set(generation, { resolve, reject, code, sentAt: Date.now() }),
    );
    this.post({ type: "load", code, generation });
    this.arm();
    return done;
  }

  /** Latest-wins: while a frame renders, only the most recent request is kept. */
  requestFrame(frame: number): void {
    if (this.inFlight) this.pendingFrame = frame;
    else this.send(frame);
  }

  /** Renders exactly this frame (never merged away) and resolves once it is done or failed. */
  renderFrame(frame: number): Promise<void> {
    return new Promise((resolve) => {
      this.frameWaiters.push({ frame, resolve });
      if (this.inFlight) this.forcedFrames.push(frame);
      else this.send(frame);
    });
  }

  /** PNG bytes of the most recently rendered frame. */
  snapshot(): Promise<ArrayBuffer> {
    const id = ++this.nextId;
    const done = new Promise<ArrayBuffer>((resolve, reject) => this.snapshots.set(id, { resolve, reject }));
    this.post({ type: "snapshot", id });
    return done;
  }

  /** Renders the frame and captures its PNG bytes. */
  async captureFrame(frame: number): Promise<ArrayBuffer> {
    await this.renderFrame(frame);
    return this.snapshot();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.watchdog);
    this.worker.terminate();
  }

  private start() {
    this.worker = this.makeWorker();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: "init", canvas: offscreen } satisfies ToWorker, [offscreen as unknown as Transferable]);
    if (this.size) this.post({ type: "resize", ...this.size });
  }

  private post(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  private send(frame: number) {
    this.inFlight = { id: ++this.nextId, frame, sentAt: Date.now() };
    this.post({ type: "render", frame, id: this.inFlight.id });
    this.arm();
  }

  /** Schedules the watchdog for the oldest outstanding request; new requests don't postpone it. */
  private arm() {
    clearTimeout(this.watchdog);
    const sent = [...[...this.loads.values()].map((l) => l.sentAt), ...(this.inFlight ? [this.inFlight.sentAt] : [])];
    if (!sent.length) return;
    const due = Math.min(...sent) + WATCHDOG_MS - Date.now();
    this.watchdog = setTimeout(() => this.restart("timeout", "Scene code timed out"), Math.max(0, due));
  }

  private emit(e: PreviewError) {
    this.errorListeners.forEach((cb) => cb(e));
  }

  private oldestLoad(): number | undefined {
    let oldest: number | undefined;
    for (const [g, l] of this.loads) if (oldest === undefined || l.sentAt < this.loads.get(oldest)!.sentAt) oldest = g;
    return oldest;
  }

  /** Replaces the worker. Replays the newest pending load (unless it is the one that hung), or the applied code. */
  private restart(reason: "timeout" | "lost", message: string) {
    if (this.disposed) return;
    this.worker.terminate();
    const err = new Error(message);

    const newest = this.loads.size ? Math.max(...this.loads.keys()) : undefined;
    const renderHung = !!this.inFlight && (this.oldestLoad() === undefined || this.inFlight.sentAt <= this.loads.get(this.oldestLoad()!)!.sentAt);
    const hungLoad = reason === "timeout" && !renderHung ? this.oldestLoad() : undefined;
    const replay = newest !== undefined && newest !== hungLoad ? newest : undefined;
    for (const [g, l] of this.loads) {
      if (g === replay) continue;
      l.reject(err);
      this.loads.delete(g);
    }

    this.snapshots.forEach((p) => p.reject(err));
    this.snapshots.clear();
    this.inFlight = undefined;
    this.pendingFrame = undefined;
    this.forcedFrames = [];
    this.frameWaiters.splice(0).forEach((w) => w.resolve());
    this.sentAssets.clear();
    // an OffscreenCanvas can only be transferred once, so the element is replaced
    const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.start();

    if (replay !== undefined) {
      const l = this.loads.get(replay)!;
      l.sentAt = Date.now();
      this.post({ type: "load", code: l.code, generation: replay });
    } else if (reason === "lost" && this.applied) {
      this.load(this.applied.code).catch(() => {});
    }
    this.arm();
    this.emit({ phase: reason, message });
  }

  private async sendAssets(srcs: string[]) {
    const todo = srcs.filter((s) => !this.sentAssets.has(s));
    const results = await Promise.allSettled(todo.map(async (s) => [s, await this.resolveAsset(s)] as [string, ImageBitmap]));
    const bitmaps = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    bitmaps.forEach(([s]) => this.sentAssets.add(s));
    if (bitmaps.length) this.post({ type: "assets", bitmaps }, bitmaps.map(([, b]) => b));
  }

  private finishFrame(frame: number) {
    this.inFlight = undefined;
    this.frameWaiters = this.frameWaiters.filter((w) => (w.frame === frame ? (w.resolve(), false) : true));
    const forced = this.forcedFrames.shift();
    if (forced !== undefined) return this.send(forced);
    const next = this.pendingFrame;
    this.pendingFrame = undefined;
    if (next !== undefined) this.send(next);
  }

  private async loaded(msg: Extract<FromWorker, { type: "loaded" }>) {
    const pending = this.loads.get(msg.generation);
    this.loads.delete(msg.generation);
    if (this.applied && msg.generation < this.applied.generation) {
      pending?.reject(new SupersededError());
      return;
    }
    for (const [g, l] of this.loads) {
      if (g >= msg.generation) continue;
      l.reject(new SupersededError());
      this.loads.delete(g);
    }
    this.applied = { generation: msg.generation, code: pending?.code ?? this.applied?.code ?? "" };
    this.arm();
    const { type: _, ...info } = msg;
    const code = this.applied.code;
    info.manifest = { ...info.manifest, scenes: info.manifest.scenes.map((s) => ({ ...s, source: s.site ? locate(s.site, code)?.file : undefined })) };
    await this.sendAssets(msg.assets);
    if (this.applied.generation !== msg.generation) pending?.reject(new SupersededError());
    else pending?.resolve(info);
  }

  private receive(msg: FromWorker) {
    switch (msg.type) {
      case "loaded":
        void this.loaded(msg);
        return;
      case "snapshot":
        if (msg.png) this.snapshots.get(msg.id)?.resolve(msg.png);
        else this.snapshots.get(msg.id)?.reject(new Error(msg.error ?? "Snapshot failed"));
        this.snapshots.delete(msg.id);
        return;
      case "rendered":
        this.finishFrame(msg.frame);
        this.arm();
        return;
      case "error": {
        if (msg.phase === "lost") return this.restart("lost", msg.message);
        const code = msg.phase === "load" ? this.loads.get(msg.generation ?? -1)?.code : this.applied?.code;
        const location = msg.stack && code ? locate(msg.stack, code) : undefined;
        if (msg.phase === "load") {
          for (const [generation, p] of this.loads) {
            if (msg.generation !== undefined && generation !== msg.generation) continue;
            p.reject(new SceneError(msg.message, location));
            this.loads.delete(generation);
          }
        } else if (this.inFlight) {
          this.finishFrame(this.inFlight.frame);
        }
        this.arm();
        this.emit({ phase: msg.phase, message: msg.message, stack: msg.stack, location });
        return;
      }
    }
  }
}
