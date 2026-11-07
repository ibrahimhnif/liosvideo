// The part of deno_web's event module that deno_webgpu imports: enough EventTarget for
// GPUDevice ("uncapturederror") without the rest of the web platform.
const listeners = Symbol("listeners");

export class Event {
  constructor(type) {
    this.type = type;
  }
}

export class EventTarget {
  constructor() {
    this[listeners] = new Map();
  }
  addEventListener(type, fn) {
    const map = (this[listeners] ??= new Map());
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this[listeners]?.get(type);
    if (list) this[listeners].set(type, list.filter((f) => f !== fn));
  }
  dispatchEvent(event) {
    for (const fn of this[listeners]?.get(event.type) ?? []) fn.call(this, event);
    const handler = this["on" + event.type];
    if (typeof handler === "function") handler.call(this, event);
    return true;
  }
}

export const EventTargetPrototype = EventTarget.prototype;

export function setEventTargetData(target) {
  target[listeners] = new Map();
}

export function defineEventHandler(proto, name) {
  const key = Symbol("on" + name);
  Object.defineProperty(proto, "on" + name, {
    get() {
      return this[key] ?? null;
    },
    set(value) {
      this[key] = value;
    },
    configurable: true,
  });
}
