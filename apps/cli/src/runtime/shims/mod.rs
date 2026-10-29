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

globalThis.requestAnimationFrame = (cb) => {
  return setTimeout(() => cb(Date.now()), 16);
};

globalThis.cancelAnimationFrame = (id) => {
  clearTimeout(id);
};

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
