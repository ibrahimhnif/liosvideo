import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewHost, arrayBufferToBase64 } from "./host";
import type { FromWorker, ToWorker } from "./protocol";

class FakeWorker {
  posted: ToWorker[] = [];
  terminated = false;
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  postMessage(msg: ToWorker) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: FromWorker) {
    this.onmessage?.({ data: msg });
  }
  renders() {
    return this.posted.filter((m) => m.type === "render") as Extract<ToWorker, { type: "render" }>[];
  }
}

function fakeCanvas(): HTMLCanvasElement {
  const c = {
    transferControlToOffscreen: () => ({}),
    cloneNode: () => fakeCanvas(),
    replaceWith: () => {},
  };
  return c as unknown as HTMLCanvasElement;
}

const loaded = (generation: number): FromWorker => ({
  type: "loaded", generation, width: 1920, height: 1080, fps: 30, totalFrames: 90, scenes: [], assets: [],
  manifest: { width: 1920, height: 1080, fps: 30, totalFrames: 90, scenes: [] },
});

function setup() {
  const workers: FakeWorker[] = [];
  const makeWorker = vi.fn(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  const host = new PreviewHost(fakeCanvas(), async () => ({}) as ImageBitmap, makeWorker);
  return { host, workers, makeWorker };
}

async function loadOk(host: PreviewHost, w: FakeWorker) {
  const p = host.load("code");
  const msg = w.posted.find((m) => m.type === "load") as Extract<ToWorker, { type: "load" }>;
  w.reply(loaded(msg.generation));
  return p;
}

afterEach(() => vi.useRealTimers());

describe("PreviewHost", () => {
  it("resolves load with the composition info", async () => {
    const { host, workers } = setup();
    await expect(loadOk(host, workers[0])).resolves.toMatchObject({ totalFrames: 90, fps: 30 });
  });

  it("keeps one render in flight and only the latest pending frame", async () => {
    const { host, workers } = setup();
    const w = workers[0];
    await loadOk(host, w);
    for (const f of [1, 2, 3, 4, 5]) host.requestFrame(f);
    expect(w.renders().map((r) => r.frame)).toEqual([1]);
    w.reply({ type: "rendered", id: w.renders()[0].id, frame: 1 });
    expect(w.renders().map((r) => r.frame)).toEqual([1, 5]);
  });

  it("reports load errors and rejects the load", async () => {
    const { host, workers } = setup();
    const errors: string[] = [];
    host.onError((e) => errors.push(`${e.phase}:${e.message}`));
    const p = host.load("bad");
    workers[0].reply({ type: "error", phase: "load", message: "boom" });
    await expect(p).rejects.toThrow("boom");
    expect(errors).toEqual(["load:boom"]);
  });

  it("restarts the worker when scene code stops responding", async () => {
    vi.useFakeTimers();
    const { host, workers, makeWorker } = setup();
    const errors: string[] = [];
    host.onError((e) => errors.push(e.message));
    const p = host.load("while(true){}").catch(() => "rejected");
    await vi.advanceTimersByTimeAsync(5000);
    expect(errors).toEqual(["Scene code timed out"]);
    expect(makeWorker).toHaveBeenCalledTimes(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posted[0].type).toBe("init");
    await expect(p).resolves.toBe("rejected");
  });

  it("does not time out while the worker keeps replying", async () => {
    vi.useFakeTimers();
    const { host, workers, makeWorker } = setup();
    const w = workers[0];
    await loadOk(host, w);
    for (let i = 0; i < 4; i++) {
      host.requestFrame(i);
      await vi.advanceTimersByTimeAsync(3000);
      const last = w.renders().at(-1)!;
      w.reply({ type: "rendered", id: last.id, frame: last.frame });
    }
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewHost review fixes", () => {
  const loadsOf = (w: FakeWorker) => w.posted.filter((m) => m.type === "load") as Extract<ToWorker, { type: "load" }>[];

  it("rejects an older load that finishes after a newer one as superseded", async () => {
    const { host, workers } = setup();
    const w = workers[0];
    const a = host.load("A").then(() => "A", (e: Error) => e.name);
    const b = host.load("B");
    const [la, lb] = loadsOf(w);
    w.reply(loaded(lb.generation));
    await expect(b).resolves.toMatchObject({ generation: lb.generation });
    w.reply(loaded(la.generation));
    await expect(a).resolves.toBe("SupersededError");
  });

  it("replays the newest queued load after a watchdog restart", async () => {
    vi.useFakeTimers();
    const { host, workers } = setup();
    const hung = host.load("while(true){}").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(2000);
    const fix = host.load("fixed");
    await vi.advanceTimersByTimeAsync(3000);
    expect(workers).toHaveLength(2);
    await expect(hung).resolves.toBe("Scene code timed out");
    const replay = loadsOf(workers[1]);
    expect(replay.map((m) => m.code)).toEqual(["fixed"]);
    workers[1].reply(loaded(replay[0].generation));
    await expect(fix).resolves.toMatchObject({ totalFrames: 90 });
  });

  it("times out from the oldest outstanding request even while new requests keep arriving", async () => {
    vi.useFakeTimers();
    const { host, makeWorker } = setup();
    host.load("hang").catch(() => {});
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1500);
      host.load(`save ${i}`).catch(() => {});
    }
    expect(makeWorker).toHaveBeenCalledTimes(2);
  });

  it("renders a frame requested with renderFrame even if later requests supersede the pending one", async () => {
    const { host, workers } = setup();
    const w = workers[0];
    await loadOk(host, w);
    host.requestFrame(1);
    let done = false;
    const p = host.renderFrame(7).then(() => (done = true));
    host.requestFrame(9);
    w.reply({ type: "rendered", id: w.renders()[0].id, frame: 1 });
    expect(w.renders().map((r) => r.frame)).toEqual([1, 7]);
    w.reply({ type: "rendered", id: w.renders()[1].id, frame: 7 });
    await p;
    expect(done).toBe(true);
    expect(w.renders().map((r) => r.frame)).toEqual([1, 7, 9]);
  });

  it("restarts and reloads the last applied code when the GPU device is lost", async () => {
    const { host, workers, makeWorker } = setup();
    const errors: string[] = [];
    host.onError((e) => errors.push(e.phase));
    const p = host.load("good");
    workers[0].reply(loaded(loadsOf(workers[0])[0].generation));
    await p;
    workers[0].reply({ type: "error", phase: "lost", message: "device lost" });
    expect(makeWorker).toHaveBeenCalledTimes(2);
    expect(loadsOf(workers[1]).map((m) => m.code)).toEqual(["good"]);
    expect(errors).toEqual(["lost"]);
  });

  it("converts an ArrayBuffer to a base64 string", () => {
    const text = "hello world";
    const buf = new Uint8Array([...text].map((c) => c.charCodeAt(0))).buffer;
    const b64 = arrayBufferToBase64(buf);
    expect(b64).toBe(btoa("hello world"));
  });

  it("captureFrame renders the frame and requests snapshot", async () => {
    const { host, workers } = setup();
    const w = workers[0];
    await loadOk(host, w);
    const p = host.captureFrame(12);
    const renderMsg = w.renders().find((r) => r.frame === 12)!;
    expect(renderMsg).toBeDefined();
    w.reply({ type: "rendered", id: renderMsg.id, frame: 12 });
    await Promise.resolve();
    const snapMsg = w.posted.find((m) => m.type === "snapshot") as Extract<ToWorker, { type: "snapshot" }>;
    expect(snapMsg).toBeDefined();
    const fakePng = new ArrayBuffer(8);
    w.reply({ type: "snapshot", id: snapMsg.id, png: fakePng });
    const result = await p;
    expect(result).toBe(fakePng);
  });
});
