import { SourceMapConsumer } from "source-map-js";
import type { SourceLocation } from "./protocol";

const consumers = new Map<string, SourceMapConsumer | null>();

function consumerFor(code: string): SourceMapConsumer | null {
  if (consumers.has(code)) return consumers.get(code)!;
  const match = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  const consumer = match ? new SourceMapConsumer(JSON.parse(atob(match[1]))) : null;
  if (consumers.size > 8) consumers.clear();
  consumers.set(code, consumer);
  return consumer;
}

/** Maps the first stack frame inside the blob-loaded bundle to its project file, using the bundle's inline source map. */
export function locate(stack: string, code: string): SourceLocation | undefined {
  const consumer = consumerFor(code);
  if (!consumer) return undefined;
  for (const m of stack.matchAll(/blob:[^\s)]*?:(\d+):(\d+)/g)) {
    const pos = consumer.originalPositionFor({ line: Number(m[1]), column: Number(m[2]) - 1 });
    if (pos.source && pos.line) {
      return { file: pos.source.replace(/^project:/, ""), line: pos.line, column: (pos.column ?? 0) + 1 };
    }
  }
  return undefined;
}
