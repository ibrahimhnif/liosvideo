// Minimal DOMException for deno_webgpu (the CLI does not load deno_web).
export class DOMException extends Error {
  constructor(message = "", name = "Error") {
    super(message);
    this.name = name;
  }
}
