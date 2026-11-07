// Clear errors for values a property or option does not accept, raised where the scene code
// writes them (instead of failing later, mid-render, with "x is not a function").

/** Props that only take one of a few strings. */
export const PROP_ENUMS: Record<string, readonly string[]> = {
  fit: ["fill", "contain", "cover"],
  align: ["left", "center", "right"],
  toneMapping: ["none", "linear", "reinhard", "cineon", "aces", "agx", "neutral"],
};

const RUNTIME_FRAME = /(\/packages\/runtime\/src\/|liosvideo\.iife|node_modules|\/liosvideo\/src\/|^\s*at (new )?(Node|TextNode|ImageNode)\b)/;

/** "scenes/hook.ts:42" for the first scene-code frame of the current stack, if it can be read. */
export function callSite(): string | undefined {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    if (RUNTIME_FRAME.test(line)) continue;
    const m = /((?:file:\/\/)?[^\s()]+\.(?:[cm]?[jt]sx?)):(\d+)(?::\d+)?\)?\s*$/.exec(line);
    if (!m || /^(blob:|https?:|data:)/.test(m[1])) continue;
    const parts = m[1].replace(/^file:\/\//, "").split("/");
    return `${parts.slice(-2).join("/")}:${m[2]}`;
  }
  return undefined;
}

export function unknownValue(what: string, value: unknown, allowed: readonly string[], where?: string): Error {
  const site = callSite();
  return new Error(
    `Unknown ${what} ${JSON.stringify(value)}${where ? ` on ${where}` : ""}${site ? ` (${site})` : ""}. Use one of: ${allowed.join(", ")}`,
  );
}

/** Throws for any enum prop in `props` that has a value outside its list. */
export function checkEnumProps(props: Record<string, unknown>, node: string): void {
  for (const [key, allowed] of Object.entries(PROP_ENUMS)) {
    const v = props[key];
    if (v !== undefined && !allowed.includes(v as string)) throw unknownValue(key, v, allowed, `node "${node}"`);
  }
}
