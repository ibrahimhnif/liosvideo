#![allow(clippy::result_large_err)]

use deno_core::error::CoreError;
use deno_core::JsRuntime;

const BROWSER_SHIMS: &str = r#"
// Browser & DOM environment shims for headless execution
globalThis.window = globalThis;
globalThis.self = globalThis;

globalThis.document = {
  createElement: (tag) => ({
    tag,
    width: 0,
    height: 0,
    getContext: (_type) => null,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  createElementNS: (_ns, tag) => ({
    tag,
    width: 0,
    height: 0,
    getContext: (_type) => null,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  body: {
    appendChild: () => {},
    removeChild: () => {},
  },
  head: {
    appendChild: () => {},
    removeChild: () => {},
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

// frames are driven by the renderer, never by an animation loop (and there are no timers)
globalThis.requestAnimationFrame = (_cb) => 0;
globalThis.cancelAnimationFrame = (_id) => {};

// glTF JSON and data: URIs (three's GLTFLoader)
if (!globalThis.TextDecoder) {
  globalThis.TextDecoder = class TextDecoder {
    get encoding() { return "utf-8"; }
    decode(input) {
      if (input === undefined) return "";
      const bytes = input instanceof Uint8Array ? input : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      return Deno.core.decode(bytes);
    }
  };
}
if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return "utf-8"; }
    encode(text = "") { return Deno.core.encode(String(text)); }
  };
}
if (!globalThis.atob) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  globalThis.atob = (input) => {
    const s = String(input).replace(/[\s=]/g, "");
    let out = "";
    let bits = 0;
    let value = 0;
    for (let i = 0; i < s.length; i++) {
      const v = chars.indexOf(s[i]);
      if (v < 0) throw new Error("atob: invalid base64");
      value = (value << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((value >> bits) & 0xff);
      }
    }
    return out;
  };
}

// three's Loader keeps an AbortController; nothing is fetched in the CLI, so it never fires
if (!globalThis.AbortController) {
  globalThis.AbortSignal = class AbortSignal {
    constructor() { this.aborted = false; this.reason = undefined; }
    addEventListener() {}
    removeEventListener() {}
    throwIfAborted() { if (this.aborted) throw this.reason; }
  };
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = new globalThis.AbortSignal(); }
    abort(reason) { this.signal.aborted = true; this.signal.reason = reason; }
  };
}

if (!globalThis.performance) {
  globalThis.performance = {
    now: () => Date.now(),
  };
}

if (!globalThis.console) {
  globalThis.console = {
    log: (...args) => Deno.core.print(args.map(String).join(" ") + "\n", false),
    error: (...args) => Deno.core.print(args.map(String).join(" ") + "\n", true),
    warn: (...args) => Deno.core.print(args.map(String).join(" ") + "\n", true),
    info: (...args) => Deno.core.print(args.map(String).join(" ") + "\n", false),
    debug: (...args) => Deno.core.print(args.map(String).join(" ") + "\n", false),
  };
}
"#;

pub fn inject_shims(runtime: &mut JsRuntime) -> Result<(), CoreError> {
    runtime.execute_script("shims.js", BROWSER_SHIMS)?;
    Ok(())
}
