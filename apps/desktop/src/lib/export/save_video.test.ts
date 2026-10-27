import { describe, expect, it } from "vitest";
import { saveExportedVideoChunks, uint8ArrayToBase64 } from "./save_video";

describe("save_video", () => {
  describe("uint8ArrayToBase64", () => {
    it("converts empty array", () => {
      expect(uint8ArrayToBase64(new Uint8Array())).toBe("");
    });

    it("converts known ascii bytes correctly", () => {
      const data = new TextEncoder().encode("Hello World!");
      expect(uint8ArrayToBase64(data)).toBe(btoa("Hello World!"));
    });

    it("handles buffers larger than subchunk boundary", () => {
      const large = new Uint8Array(70_000);
      for (let i = 0; i < large.length; i++) {
        large[i] = i % 256;
      }
      const b64 = uint8ArrayToBase64(large);
      expect(b64.length).toBeGreaterThan(0);
      // Verify roundtrip
      const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      expect(decoded).toEqual(large);
    });
  });

  describe("saveExportedVideoChunks", () => {
    it("saves empty bytes with append=false", async () => {
      const calls: any[] = [];
      const mockInvoke = async (cmd: string, args?: any) => {
        calls.push({ cmd, args });
        return "/path/to/out/test.mp4";
      };

      const result = await saveExportedVideoChunks("test.mp4", new Uint8Array(), mockInvoke as any);
      expect(result).toBe("/path/to/out/test.mp4");
      expect(calls).toEqual([
        {
          cmd: "save_exported_video_chunk",
          args: {
            filename: "test.mp4",
            chunkBase64: "",
            append: false,
          },
        },
      ]);
    });

    it("splits data into chunks with append=false for first chunk and append=true for subsequent", async () => {
      const calls: any[] = [];
      const mockInvoke = async (cmd: string, args?: any) => {
        calls.push({ cmd, args });
        return `/path/to/out/${args.filename}`;
      };

      const data = new Uint8Array(250);
      data.fill(42);

      // use a 100-byte chunkSize to test 3 chunks: 100, 100, 50
      const result = await saveExportedVideoChunks("video.mp4", data, mockInvoke as any, 100);
      expect(result).toBe("/path/to/out/video.mp4");
      expect(calls.length).toBe(3);
      expect(calls[0].args.append).toBe(false);
      expect(calls[1].args.append).toBe(true);
      expect(calls[2].args.append).toBe(true);

      // Verify decoded chunks combine to original 250 bytes
      const decodedParts = calls.map((c) => Uint8Array.from(atob(c.args.chunkBase64), (ch) => ch.charCodeAt(0)));
      const combined = new Uint8Array(decodedParts.reduce((acc, p) => acc + p.length, 0));
      let offset = 0;
      for (const p of decodedParts) {
        combined.set(p, offset);
        offset += p.length;
      }
      expect(combined).toEqual(data);
    });
  });
});
