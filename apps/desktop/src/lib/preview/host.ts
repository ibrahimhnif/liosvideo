import type { FromWorker, LoadedInfo, PreviewError, ToWorker } from "./protocol";

export const WATCHDOG_MS = 5000;

const defaultWorker = () => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

/** Owns the render worker: loading code, latest-wins frame requests, and a watchdog for hung scene code. */
export class PreviewHost {
  private worker!: Worker;
  private generation = 0;
  private nextId = 0;
  private loads = new Map<number, Pending<LoadedInfo>>();
  private inFlight: { id: number; frame: number } | undefined;
  private pendingFrame: number | undefined;
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

  /** The current canvas element (replaced after a watchdog restart). */
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

  load(code: string): Promise<LoadedInfo> {
    const generation = ++this.generation;
    const done = new Promise<LoadedInfo>((resolve, reject) => this.loads.set(generation, { resolve, reject }));
    this.post({ type: "load", code, generation });
    this.arm();
    return done;
  }

  requestFrame(frame: number): void {
    if (this.inFlight) {
      this.pendingFrame = frame;
      return;
    }
    this.inFlight = { id: ++this.nextId, frame };
    this.post({ type: "render", frame, id: this.inFlight.id });
    this.arm();
  }

  /** Requests a frame and resolves once it has been rendered (or failed). */
  renderFrame(frame: number): Promise<void> {
    return new Promise((resolve) => {
      this.frameWaiters.push({ frame, resolve });
      this.requestFrame(frame);
    });
  }

  /** PNG bytes of the most recently rendered frame. */
  snapshot(): Promise<ArrayBuffer> {
    const id = ++this.nextId;
    const done = new Promise<ArrayBuffer>((resolve, reject) => this.snapshots.set(id, { resolve, reject }));
    this.post({ type: "snapshot", id });
    return done;
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

  private busy() {
    return this.loads.size > 0 || !!this.inFlight;
  }

  /** (Re)starts the watchdog while a reply is outstanding. */
  private arm() {
    clearTimeout(this.watchdog);
    if (this.busy()) this.watchdog = setTimeout(() => this.restart(), WATCHDOG_MS);
  }

  private emit(e: PreviewError) {
    this.errorListeners.forEach((cb) => cb(e));
  }

  private restart() {
    if (this.disposed) return;
    this.worker.terminate();
    const err = new Error("Scene code timed out");
    this.loads.forEach((p) => p.reject(err));
    this.loads.clear();
    this.snapshots.forEach((p) => p.reject(err));
    this.snapshots.clear();
    this.inFlight = undefined;
    this.pendingFrame = undefined;
    this.frameWaiters.splice(0).forEach((w) => w.resolve());
    this.sentAssets.clear();
    // an OffscreenCanvas can only be transferred once, so the element is replaced
    const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.start();
    this.emit({ phase: "timeout", message: err.message });
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
    const next = this.pendingFrame;
    this.pendingFrame = undefined;
    if (next !== undefined) this.requestFrame(next);
  }

  private receive(msg: FromWorker) {
    switch (msg.type) {
      case "loaded": {
        const pending = this.loads.get(msg.generation);
        this.loads.delete(msg.generation);
        const { type: _, ...info } = msg;
        this.arm();
        void this.sendAssets(msg.assets).then(() => pending?.resolve(info));
        return;
      }
      case "snapshot":
        if (msg.png) this.snapshots.get(msg.id)?.resolve(msg.png);
        else this.snapshots.get(msg.id)?.reject(new Error(msg.error ?? "Snapshot failed"));
        this.snapshots.delete(msg.id);
        return;
      case "rendered":
        this.finishFrame(msg.frame);
        this.arm();
        return;
      case "error":
        if (msg.phase === "load") {
          const err = new Error(msg.message);
          for (const [generation, p] of this.loads) {
            if (msg.generation !== undefined && generation !== msg.generation) continue;
            p.reject(err);
            this.loads.delete(generation);
          }
        } else if (this.inFlight) {
          this.finishFrame(this.inFlight.frame);
        }
        this.arm();
        this.emit({ phase: msg.phase, message: msg.message, stack: msg.stack });
        return;
    }
  }
}
