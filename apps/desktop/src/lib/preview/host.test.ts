import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewHost } from "./host";
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
