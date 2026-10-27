import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceRecorder } from "./recorder";

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(["audio-data"]) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
}

describe("VoiceRecorder", () => {
  let recorder: VoiceRecorder;
  let mockStream: any;

  beforeEach(() => {
    mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    };
    recorder = new VoiceRecorder({
      getMediaStream: async () => mockStream,
      createMediaRecorder: () => new MockMediaRecorder() as any,
      now: () => 1000,
    });
  });

  it("records audio and returns blob and duration", async () => {
    await recorder.start();
    expect(recorder.isRecording).toBe(true);

    // advance time
    (recorder as any).now = () => 4000; // 3 seconds elapsed
    const result = await recorder.stop();

    expect(recorder.isRecording).toBe(false);
    expect(result.duration).toBeCloseTo(3.0);
    expect(result.blob).toBeDefined();
  });
});
