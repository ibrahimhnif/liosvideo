"use strict";
var __liosvideo = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../packages/runtime/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    BASE_DEFAULTS: () => BASE_DEFAULTS,
    ChromeNode: () => ChromeNode,
    ChromeOmnibox: () => ChromeOmnibox,
    CircleNode: () => CircleNode,
    CursorNode: () => CursorNode,
    DesktopNode: () => DesktopNode,
    EditorNode: () => EditorNode,
    GroupNode: () => GroupNode,
    IDENTITY: () => IDENTITY,
    ImageNode: () => ImageNode,
    Node: () => Node,
    PathNode: () => PathNode,
    PhoneNode: () => PhoneNode,
    RectNode: () => RectNode,
    ShaderNode: () => ShaderNode,
    TerminalNode: () => TerminalNode,
    TextNode: () => TextNode,
    ThreeNode: () => ThreeNode,
    Track: () => Track,
    VideoNode: () => VideoNode,
    VoHelper: () => VoHelper,
    WindowNode: () => WindowNode,
    apply: () => apply,
    applyTransition: () => applyTransition,
    buildManifest: () => buildManifest,
    chrome: () => chrome,
    circle: () => circle,
    clampFrame: () => clampFrame,
    collectAssets: () => collectAssets,
    composition: () => composition,
    cursor: () => cursor,
    desktop: () => desktop,
    ease: () => ease,
    editor: () => editor,
    evaluateFrame: () => evaluateFrame,
    focus: () => focus,
    formatColor: () => formatColor,
    group: () => group,
    image: () => image,
    instantiateScene: () => instantiateScene,
    layoutComposition: () => layoutComposition,
    lerpColor: () => lerpColor,
    logoMark: () => logoMark,
    multiply: () => multiply,
    parseColor: () => parseColor,
    path: () => path,
    phone: () => phone,
    rect: () => rect,
    registerVoTiming: () => registerVoTiming,
    registerVoTimings: () => registerVoTimings,
    scene: () => scene,
    seededRandom: () => seededRandom,
    setTextMeasurer: () => setTextMeasurer,
    shader: () => shader,
    terminal: () => terminal,
    text: () => text,
    three: () => three,
    tokyoNightColors: () => tokyoNightColors,
    transition: () => transition,
    video: () => video,
    vo: () => vo,
    windowNode: () => windowNode
  });

  // ../../packages/runtime/src/anim/easing.ts
  var C1 = 1.70158;
  var C3 = C1 + 1;
  var EASINGS = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - (1 - t) ** 3,
    inOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
    outBack: (t) => 1 + C3 * (t - 1) ** 3 + C1 * (t - 1) ** 2,
    inOutExpo: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
  };
  function ease(e, t) {
    const c = Math.min(1, Math.max(0, t));
    if (c === 0) return 0;
    if (c === 1) return 1;
    return (typeof e === "function" ? e : EASINGS[e])(c);
  }

  // ../../packages/runtime/src/math/color.ts
  function parseColor(hex) {
    let h = hex.replace(/^#/, "");
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (!/^[0-9a-f]{8}$/i.test(h)) throw new Error(`Invalid color "${hex}"`);
    return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  function formatColor([r, g, b, a]) {
    return "#" + [r, g, b, a].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
  }
  function lerpColor(a, b, t) {
    const ca = parseColor(a);
    const cb = parseColor(b);
    return formatColor(ca.map((v, i) => v + (cb[i] - v) * t));
  }

  // ../../packages/runtime/src/anim/track.ts
  var isColor = (v) => typeof v === "string" && v.startsWith("#");
  function interpolate(a, b, k) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
    if (isColor(a) && isColor(b)) return lerpColor(a, b, k);
    return b;
  }
  var Track = class {
    constructor(initial) {
      this.initial = initial;
    }
    initial;
    sorted = [];
    add(seg) {
      this.sorted.push(seg);
      this.sorted.sort((x, y) => x.start - y.start);
    }
    segments() {
      return this.sorted;
    }
    valueAt(t) {
      let value = this.initial;
      for (const seg of this.sorted) {
        if (t < seg.start) break;
        const from = seg.from ?? value;
        if (t >= seg.end) {
          value = seg.to;
        } else {
          const k = ease(seg.ease, (t - seg.start) / (seg.end - seg.start));
          value = interpolate(from, seg.to, k);
        }
      }
      return value;
    }
  };

  // ../../packages/runtime/src/anim/transition.ts
  function transition(typeOrFn, optsOrDuration = 0.5) {
    if (typeof typeOrFn === "function") {
      const duration = typeof optsOrDuration === "number" ? optsOrDuration : optsOrDuration.duration ?? 0.5;
      return { type: "custom", duration, apply: typeOrFn };
    }
    if (typeof optsOrDuration === "number") {
      return { type: typeOrFn, duration: optsOrDuration };
    }
    return {
      type: typeOrFn,
      duration: optsOrDuration.duration ?? 0.5,
      direction: optsOrDuration.direction,
      apply: optsOrDuration.apply
    };
  }
  function applyTransition(node, def, progress, width, height) {
    const t = Math.max(0, Math.min(1, progress));
    const anyNode = node;
    if (def.apply) {
      def.apply(node, t, width, height);
      return;
    }
    switch (def.type) {
      case "fade":
        anyNode.base.opacity = t;
        break;
      case "slide": {
        const dir = def.direction ?? "left";
        if (dir === "left") anyNode.base.x = (1 - t) * width;
        else if (dir === "right") anyNode.base.x = -(1 - t) * width;
        else if (dir === "up") anyNode.base.y = (1 - t) * height;
        else if (dir === "down") anyNode.base.y = -(1 - t) * height;
        break;
      }
      case "zoom":
        anyNode.base.scaleX = 0.8 + 0.2 * t;
        anyNode.base.scaleY = 0.8 + 0.2 * t;
        anyNode.base.opacity = t;
        break;
      case "wipe":
        anyNode.base.opacity = t;
        break;
      case "custom":
        break;
    }
  }

  // ../../packages/runtime/src/math/affine.ts
  var IDENTITY = [1, 0, 0, 1, 0, 0];
  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  var translate = (x, y) => [1, 0, 0, 1, x, y];
  var scale = (sx, sy) => [sx, 0, 0, sy, 0, 0];
  function rotate(degrees) {
    const r = degrees * Math.PI / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [c, s, -s, c, 0, 0];
  }

  // ../../packages/runtime/src/math/random.ts
  function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let a = h >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ../../packages/runtime/src/graph/node.ts
  var BASE_DEFAULTS = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    opacity: 1,
    z: 0,
    blur: 0,
    width: 0,
    height: 0,
    radius: 0,
    clip: false
  };
  var Node = class {
    constructor(kind, defaults, init = {}) {
      this.kind = kind;
      const { name, ...props } = init;
      if (name?.includes("/")) throw new Error(`Node name "${name}" must not contain "/"`);
      this.requestedName = name;
      this._name = name ?? `${kind}0`;
      this.base = { ...defaults, ...props };
    }
    kind;
    parent;
    children = [];
    _name;
    requestedName;
    base;
    tracks = /* @__PURE__ */ new Map();
    get name() {
      return this._name;
    }
    path() {
      return this.parent ? `${this.parent.path()}/${this._name}` : this._name;
    }
    add(child) {
      if (child.requestedName === void 0) {
        child._name = `${child.kind}${this.children.filter((c) => c.kind === child.kind).length}`;
      } else {
        const same = this.children.filter((c) => c.requestedName === child.requestedName).length;
        child._name = same === 0 ? child.requestedName : `${child.requestedName}~${same + 1}`;
      }
      child.parent = this;
      this.children.push(child);
      return child;
    }
    track(key) {
      let tr = this.tracks.get(key);
      if (!tr) {
        tr = new Track(this.base[key]);
        this.tracks.set(key, tr);
      }
      return tr;
    }
    set(props, at) {
      return this.to(props, { at, duration: 0 });
    }
    to(props, opts) {
      for (const key of Object.keys(props)) {
        this.track(key).add({
          start: opts.at,
          end: opts.at + opts.duration,
          from: void 0,
          to: props[key],
          ease: opts.ease ?? "inOutCubic"
        });
      }
      return this;
    }
    /** Time ranges (seconds) in which any property animates; overlapping or touching ranges are merged. */
    spans() {
      const all = [...this.tracks.values()].flatMap((tr) => tr.segments().map((s) => ({ start: s.start, end: s.end })));
      all.sort((a, b) => a.start - b.start || a.end - b.end);
      const merged = [];
      for (const s of all) {
        const last = merged.at(-1);
        if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
        else merged.push({ ...s });
      }
      return merged;
    }
    propsAt(t) {
      const p = { ...this.base };
      for (const [key, tr] of this.tracks) p[key] = tr.valueAt(t);
      return p;
    }
    localMatrix(t) {
      const p = this.propsAt(t);
      return multiply(
        multiply(multiply(translate(p.x, p.y), rotate(p.rotation)), scale(p.scaleX, p.scaleY)),
        translate(-p.anchorX * p.width, -p.anchorY * p.height)
      );
    }
  };

  // ../../packages/runtime/src/graph/three.ts
  var ThreeNode = class extends Node {
    setupFn;
    updateFn;
    constructor(init) {
      super(
        "three",
        {
          ...BASE_DEFAULTS,
          width: 400,
          height: 300,
          camera: "perspective",
          fov: 50,
          setup: init.setup,
          update: init.update
        },
        init
      );
      this.setupFn = init.setup;
      this.updateFn = init.update;
    }
    get width() {
      return this.propsAt(0).width;
    }
    get height() {
      return this.propsAt(0).height;
    }
    get cameraType() {
      return this.propsAt(0).camera;
    }
    get fov() {
      return this.propsAt(0).fov;
    }
  };
  function three(init) {
    return new ThreeNode(init);
  }

  // ../../packages/runtime/src/graph/kinds.ts
  var GroupNode = class extends Node {
    constructor(init) {
      super("group", BASE_DEFAULTS, init);
    }
  };
  var RectNode = class extends Node {
    constructor(init) {
      super("rect", { ...BASE_DEFAULTS, fill: "#ffffff", stroke: "", strokeWidth: 0 }, init);
    }
  };
  var measurer;
  function setTextMeasurer(m) {
    measurer = m;
  }
  var TextNode = class extends Node {
    constructor(init) {
      super(
        "text",
        { ...BASE_DEFAULTS, text: "", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2 },
        init
      );
    }
    propsAt(t) {
      const p = super.propsAt(t);
      if (measurer && p.width === 0 && p.height === 0) Object.assign(p, measurer(p));
      return p;
    }
  };
  var ImageNode = class extends Node {
    constructor(init) {
      super("image", { ...BASE_DEFAULTS, src: "", fit: "fill" }, init);
    }
  };
  var VideoNode = class extends Node {
    constructor(init) {
      super("video", { ...BASE_DEFAULTS, src: "", fit: "fill", startOffset: 0, speed: 1, loop: false }, init);
    }
  };
  var CircleNode = class extends Node {
    constructor(init) {
      const r = init?.radius ?? 50;
      const diameter = r * 2;
      super(
        "circle",
        { ...BASE_DEFAULTS, width: diameter, height: diameter, radius: r, fill: "#ffffff", stroke: "", strokeWidth: 0 },
        { ...init, width: init?.width ?? diameter, height: init?.height ?? diameter, radius: r }
      );
    }
  };
  var PathNode = class extends Node {
    constructor(init) {
      super("path", { ...BASE_DEFAULTS, d: "", fill: "#ffffff", stroke: "", strokeWidth: 0 }, init);
    }
  };
  var ShaderNode = class extends Node {
    constructor(init) {
      super("shader", { ...BASE_DEFAULTS, code: "", uniforms: {} }, init);
    }
  };
  var group = (init) => new GroupNode(init);
  var rect = (init) => new RectNode(init);
  var circle = (init) => new CircleNode(init);
  var path = (init) => new PathNode(init);
  var shader = (init) => new ShaderNode(init);
  var text = (init) => new TextNode(init);
  var image = (init) => new ImageNode(init);
  var video = (init) => new VideoNode(init);

  // ../../packages/runtime/src/composition.ts
  function scene(id, opts, build) {
    return { id, duration: opts.duration, background: opts.background, transition: opts.transition, build, site: new Error().stack };
  }
  function composition(c) {
    return { ...c, background: c.background ?? "#000000" };
  }
  function layoutComposition(c) {
    const seen = /* @__PURE__ */ new Set();
    for (const s of c.scenes) {
      if (seen.has(s.id)) throw new Error(`Duplicate scene id "${s.id}"`);
      seen.add(s.id);
    }
    let frame = 0;
    const scenes = c.scenes.map((s) => {
      const startFrame = frame;
      frame += Math.round(s.duration * c.fps);
      return { id: s.id, startFrame, endFrame: frame };
    });
    return { totalFrames: frame, scenes };
  }
  function clampFrame(c, frame) {
    const last = Math.max(layoutComposition(c).totalFrames - 1, 0);
    return Math.min(Math.max(Math.floor(frame), 0), last);
  }
  var instances = /* @__PURE__ */ new WeakMap();
  function instantiateScene(c, def) {
    let byDef = instances.get(c);
    if (!byDef) instances.set(c, byDef = /* @__PURE__ */ new WeakMap());
    let root = byDef.get(def);
    if (!root) {
      root = group({ name: def.id, width: c.width, height: c.height });
      def.build({ root, width: c.width, height: c.height, duration: def.duration, random: seededRandom(def.id) });
      byDef.set(def, root);
    }
    return root;
  }

  // ../../packages/runtime/src/evaluate.ts
  function drawable(node, t, matrix, opacity) {
    const path2 = node.path();
    if (node instanceof RectNode) {
      const p = node.propsAt(t);
      return {
        kind: "rect",
        path: path2,
        matrix,
        width: p.width,
        height: p.height,
        radius: p.radius,
        fill: p.fill,
        stroke: p.stroke || void 0,
        strokeWidth: p.strokeWidth,
        opacity
      };
    }
    if (node instanceof CircleNode) {
      const p = node.propsAt(t);
      return {
        kind: "circle",
        path: path2,
        matrix,
        radius: p.radius,
        width: p.width,
        height: p.height,
        fill: p.fill,
        stroke: p.stroke || void 0,
        strokeWidth: p.strokeWidth,
        opacity
      };
    }
    if (node instanceof PathNode) {
      const p = node.propsAt(t);
      return {
        kind: "path",
        path: path2,
        matrix,
        d: p.d,
        width: p.width,
        height: p.height,
        fill: p.fill,
        stroke: p.stroke || void 0,
        strokeWidth: p.strokeWidth,
        opacity
      };
    }
    if (node instanceof ShaderNode) {
      const p = node.propsAt(t);
      return {
        kind: "shader",
        path: path2,
        matrix,
        code: p.code,
        width: p.width,
        height: p.height,
        uniforms: p.uniforms,
        opacity
      };
    }
    if (node instanceof TextNode) {
      const p = node.propsAt(t);
      return {
        kind: "text",
        path: path2,
        matrix,
        text: p.text,
        fontFamily: p.fontFamily,
        fontSize: p.fontSize,
        fontWeight: p.fontWeight,
        color: p.color,
        lineHeight: p.lineHeight,
        opacity
      };
    }
    if (node instanceof ImageNode) {
      const p = node.propsAt(t);
      return { kind: "image", path: path2, matrix, src: p.src, width: p.width, height: p.height, fit: p.fit, opacity };
    }
    if (node instanceof VideoNode) {
      const p = node.propsAt(t);
      const time = t * p.speed + p.startOffset;
      return { kind: "video", path: path2, matrix, src: p.src, time, width: p.width, height: p.height, fit: p.fit, opacity };
    }
    if (node instanceof ThreeNode) {
      const p = node.propsAt(t);
      return { kind: "three", path: path2, matrix, width: p.width, height: p.height, opacity };
    }
    return void 0;
  }
  function sortedChildren(node, t) {
    return node.children.map((child, i) => ({ child, i, z: child.propsAt(t).z })).sort((a, b) => a.z - b.z || a.i - b.i).map((e) => e.child);
  }
  function emit(node, t, parent, inherited, out) {
    const p = node.propsAt(t);
    const opacity = inherited * p.opacity;
    if (opacity <= 0) return;
    const matrix = multiply(parent, node.localMatrix(t));
    const isolated = p.blur > 0 || p.clip || p.opacity < 1 && node.children.length > 0;
    const childOpacity = isolated ? 1 : opacity;
    const target = isolated ? [] : out;
    const own = drawable(node, t, matrix, childOpacity);
    if (own) target.push(own);
    for (const child of sortedChildren(node, t)) emit(child, t, matrix, childOpacity, target);
    if (isolated) {
      out.push({
        kind: "layer",
        path: node.path(),
        items: target,
        opacity,
        blur: p.blur,
        ...p.clip ? { clip: { matrix, width: p.width, height: p.height, radius: p.radius } } : {}
      });
    }
  }
  function imageSrcs(items, into) {
    for (const item of items) {
      if (item.kind === "image" || item.kind === "video") into.add(item.src);
      else if (item.kind === "layer") imageSrcs(item.items, into);
    }
    return into;
  }
  function evaluateFrame(c, frame) {
    const f = clampFrame(c, frame);
    const { scenes } = layoutComposition(c);
    const index = scenes.findIndex((s) => f >= s.startFrame && f < s.endFrame);
    if (index < 0) return { width: c.width, height: c.height, background: c.background, items: [], assets: [] };
    const def = c.scenes[index];
    const t = (f - scenes[index].startFrame) / c.fps;
    const items = [];
    const root = instantiateScene(c, def);
    if (def.transition) {
      const progress = t / Math.max(1e-3, def.transition.duration);
      applyTransition(root, def.transition, progress, c.width, c.height);
    }
    emit(root, t, [1, 0, 0, 1, 0, 0], 1, items);
    return {
      width: c.width,
      height: c.height,
      background: def.background ?? c.background,
      items,
      assets: [...imageSrcs(items, /* @__PURE__ */ new Set())].sort()
    };
  }
  function collectAssets(c) {
    const srcs = /* @__PURE__ */ new Set();
    const walk = (node) => {
      if (node instanceof ImageNode || node instanceof VideoNode) srcs.add(node.propsAt(0).src);
      node.children.forEach(walk);
    };
    for (const def of c.scenes) walk(instantiateScene(c, def));
    return [...srcs].sort();
  }

  // ../../packages/runtime/src/manifest.ts
  function describe(node, scene2, fps) {
    const clamp = (f) => Math.min(Math.max(f, scene2.startFrame), scene2.endFrame);
    return {
      path: node.path(),
      name: node.name,
      kind: node.kind,
      spans: node.spans().map((s) => ({
        startFrame: clamp(scene2.startFrame + Math.round(s.start * fps)),
        endFrame: clamp(scene2.startFrame + Math.round(s.end * fps))
      })),
      children: node.children.map((c) => describe(c, scene2, fps))
    };
  }
  function buildManifest(c) {
    const { totalFrames, scenes } = layoutComposition(c);
    const audioTracks = c.audio?.map((track) => {
      const clipsList = Array.isArray(track.clips) ? track.clips : track.src ? [
        {
          src: track.src,
          startFrame: track.startFrame ?? Math.round((track.startAt ?? 0) * c.fps),
          duration: track.duration,
          startOffset: track.startOffset,
          volume: track.volume,
          ducking: track.ducking
        }
      ] : [];
      return {
        id: track.id,
        name: track.name ?? track.id,
        clips: clipsList.map((clip) => {
          const startFrame = clip.startFrame ?? Math.round((clip.startAt ?? 0) * c.fps);
          const endFrame = clip.duration !== void 0 ? startFrame + Math.round(clip.duration * c.fps) : Math.max(startFrame + 1, totalFrames);
          return {
            src: clip.src,
            startFrame,
            endFrame,
            duration: clip.duration,
            startOffset: clip.startOffset,
            volume: clip.volume,
            ducking: clip.ducking
          };
        })
      };
    });
    return {
      width: c.width,
      height: c.height,
      fps: c.fps,
      totalFrames,
      scenes: scenes.map((span, i) => ({ ...span, tree: describe(instantiateScene(c, c.scenes[i]), span, c.fps), site: c.scenes[i].site })),
      ...audioTracks ? { audioTracks } : {}
    };
  }

  // ../../packages/runtime/src/audio/timing.ts
  var VO_REGISTRY = /* @__PURE__ */ new Map();
  function registerVoTiming(timing) {
    const key = timing.lineId || timing.line_id;
    if (key) VO_REGISTRY.set(key, timing);
  }
  function registerVoTimings(timings) {
    if (Array.isArray(timings)) {
      timings.forEach(registerVoTiming);
    } else if (timings && typeof timings === "object") {
      Object.entries(timings).forEach(([k, v]) => registerVoTiming({ ...v, lineId: v.lineId || k }));
    }
  }
  var VoHelper = class {
    constructor(lineId, timing) {
      this.lineId = lineId;
      this.timing = timing;
      this.end = timing?.duration ?? 0;
    }
    lineId;
    timing;
    start = 0;
    end;
    get isReady() {
      return !!(this.timing && (this.timing.duration > 0 || this.timing.words && this.timing.words.length > 0));
    }
    get duration() {
      return this.end;
    }
    wordTime(text3) {
      if (!this.timing || !this.timing.words?.length) {
        return void 0;
      }
      const target = text3.trim().toLowerCase();
      const found = this.timing.words.find(
        (w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target)
      );
      return found ? found.start : void 0;
    }
    word(text3) {
      if (!this.timing || !this.timing.words?.length) {
        return { start: 0, end: 0 };
      }
      const target = text3.trim().toLowerCase();
      const found = this.timing.words.find(
        (w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target)
      );
      if (found) {
        return { start: found.start, end: found.end };
      }
      return { start: 0, end: 0 };
    }
  };
  var vo = (lineId, timing) => {
    const resolved = timing ?? VO_REGISTRY.get(lineId) ?? globalThis.__liosVoTimings?.[lineId];
    return new VoHelper(lineId, resolved);
  };

  // ../../packages/runtime/src/mockups/window.ts
  var WindowNode = class extends GroupNode {
    frame;
    titleBar;
    titleBorder;
    trafficLights;
    closeBtn;
    minBtn;
    maxBtn;
    titleText;
    contentArea;
    constructor(init = {}) {
      const { title = "Window", theme = "dark", width = 800, height = 600, ...rest } = init;
      super({ ...rest, width, height });
      const isDark = theme === "dark";
      const bgFill = isDark ? "#1e1e1e" : "#f6f6f6";
      const barFill = isDark ? "#2d2d2d" : "#e8e8e8";
      const barBorder = isDark ? "#1f1f1f" : "#d8d8d8";
      const titleColor = isDark ? "#d0d0d0" : "#4a4a4a";
      this.frame = this.add(
        rect({
          name: "frame",
          width,
          height,
          radius: 10,
          fill: bgFill,
          stroke: isDark ? "#383838" : "#d0d0d0",
          strokeWidth: 1
        })
      );
      this.titleBar = this.add(
        rect({
          name: "titleBar",
          width,
          height: 38,
          radius: 10,
          fill: barFill
        })
      );
      this.titleBorder = this.add(
        rect({
          name: "titleBorder",
          y: 37,
          width,
          height: 1,
          fill: barBorder
        })
      );
      this.trafficLights = this.add(
        group({
          name: "trafficLights",
          x: 14,
          y: 13,
          width: 52,
          height: 12
        })
      );
      this.closeBtn = this.trafficLights.add(
        rect({ name: "close", x: 0, width: 12, height: 12, radius: 6, fill: "#ff5f56" })
      );
      this.minBtn = this.trafficLights.add(
        rect({ name: "minimize", x: 20, width: 12, height: 12, radius: 6, fill: "#ffbd2e" })
      );
      this.maxBtn = this.trafficLights.add(
        rect({ name: "maximize", x: 40, width: 12, height: 12, radius: 6, fill: "#27c93f" })
      );
      this.titleText = this.add(
        text({
          name: "titleText",
          text: title,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          fontSize: 13,
          fontWeight: 500,
          color: titleColor,
          anchorX: 0.5,
          anchorY: 0.5,
          x: width / 2,
          y: 19
        })
      );
      this.contentArea = this.add(
        group({
          name: "content",
          y: 38,
          width,
          height: Math.max(0, height - 38),
          clip: true,
          radius: 10
        })
      );
    }
    get width() {
      return this.propsAt(0).width;
    }
    get height() {
      return this.propsAt(0).height;
    }
  };
  var windowNode = (init) => new WindowNode(init);

  // ../../packages/runtime/src/mockups/desktop.ts
  var DesktopNode = class extends GroupNode {
    wallpaper;
    menuBar;
    appleIcon;
    appTitle;
    menuItems;
    clock;
    constructor(init = {}) {
      const { wallpaper: wallSrc, appName = "Desktop", theme = "dark", width = 1920, height = 1080, ...rest } = init;
      super({ ...rest, width, height });
      const isDark = theme === "dark";
      const barBg = isDark ? "#18181fb3" : "#f5f5f7cc";
      const textCol = isDark ? "#f0f0f5" : "#1d1d1f";
      if (wallSrc) {
        this.wallpaper = this.add(
          image({
            name: "wallpaper",
            src: wallSrc,
            width,
            height,
            fit: "cover"
          })
        );
      } else {
        this.wallpaper = this.add(
          rect({
            name: "wallpaper",
            width,
            height,
            fill: isDark ? "#1b192e" : "#8ab4f8"
          })
        );
      }
      this.menuBar = this.add(
        rect({
          name: "menuBar",
          width,
          height: 28,
          fill: barBg
        })
      );
      this.appleIcon = this.add(
        text({
          name: "appleIcon",
          text: "\uF8FF",
          x: 16,
          y: 6,
          fontSize: 14,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: textCol
        })
      );
      this.appTitle = this.add(
        text({
          name: "appTitle",
          text: appName,
          x: 38,
          y: 7,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: textCol
        })
      );
      this.menuItems = this.add(
        text({
          name: "menuItems",
          text: "File   Edit   View   Go   Window   Help",
          x: 104,
          y: 7,
          fontSize: 13,
          fontWeight: 400,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: isDark ? "#b0b0b8" : "#55555c"
        })
      );
      this.clock = this.add(
        text({
          name: "clock",
          text: "Sun 10:24 AM",
          x: width - 16,
          y: 7,
          anchorX: 1,
          fontSize: 13,
          fontWeight: 400,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: textCol
        })
      );
    }
    get width() {
      return this.propsAt(0).width;
    }
    get height() {
      return this.propsAt(0).height;
    }
  };
  var desktop = (init) => new DesktopNode(init);

  // ../../packages/runtime/src/mockups/terminal.ts
  var TerminalNode = class extends WindowNode {
    prompt;
    actions = [];
    bufferNode;
    constructor(init = {}) {
      const { cwd = "~", user = "user", host = "macbook", title = `Terminal \u2014 ${cwd}`, ...rest } = init;
      super({ ...rest, title, theme: "dark" });
      this.prompt = `${user}@${host} ${cwd} % `;
      const term = this;
      class DynamicBufferNode extends TextNode {
        propsAt(t) {
          const p = super.propsAt(t);
          p.text = term.textAt(t);
          return p;
        }
      }
      this.bufferNode = this.contentArea.add(
        new DynamicBufferNode({
          name: "buffer",
          x: 16,
          y: 16,
          text: this.prompt,
          fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.45,
          color: "#f0f0f0"
        })
      );
    }
    type(command, opts) {
      this.actions.push({
        kind: "type",
        prompt: this.prompt,
        command,
        at: opts.at,
        duration: Math.max(0.01, opts.duration)
      });
      this.actions.sort((a, b) => a.at - b.at);
      return this;
    }
    writeln(text3, at) {
      this.actions.push({
        kind: "line",
        text: text3,
        at
      });
      this.actions.sort((a, b) => a.at - b.at);
      return this;
    }
    clear(at) {
      this.actions.push({
        kind: "clear",
        at
      });
      this.actions.sort((a, b) => a.at - b.at);
      return this;
    }
    textAt(t) {
      const lines = [];
      let currentLine = this.prompt;
      for (const a of this.actions) {
        if (a.at > t) break;
        if (a.kind === "clear") {
          lines.length = 0;
          currentLine = this.prompt;
        } else if (a.kind === "line") {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = "";
          }
          lines.push(a.text);
        } else if (a.kind === "type") {
          const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
          const chars = Math.floor(progress * a.command.length);
          const typed = a.command.slice(0, chars);
          currentLine = `${a.prompt}${typed}`;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      return lines.join("\n");
    }
  };
  var terminal = (init) => new TerminalNode(init);

  // ../../packages/runtime/src/mockups/chrome.ts
  var ChromeOmnibox = class {
    actions = [];
    initialUrl;
    constructor(initialUrl = "about:blank") {
      this.initialUrl = initialUrl;
    }
    type(url, opts) {
      this.actions.push({
        targetUrl: url,
        at: opts.at,
        duration: Math.max(0.01, opts.duration)
      });
      this.actions.sort((a, b) => a.at - b.at);
      return this;
    }
    textAt(t) {
      let current = this.initialUrl;
      for (const a of this.actions) {
        if (a.at > t) break;
        const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
        const chars = Math.floor(progress * a.targetUrl.length);
        current = a.targetUrl.slice(0, chars);
      }
      return current;
    }
  };
  var ChromeNode = class extends WindowNode {
    tabTitle;
    tabRect;
    navBar;
    urlbarRect;
    urlbarText;
    urlbar;
    pageArea;
    constructor(init = {}) {
      const { url = "https://example.com", title, tabTitle = title ?? "New Tab", width = 1e3, height = 700, ...rest } = init;
      super({ ...rest, title: "", width, height, theme: "dark" });
      const chrome2 = this;
      this.urlbar = new ChromeOmnibox(url);
      this.titleText.set({ opacity: 0 }, 0);
      this.tabRect = this.add(
        rect({
          name: "activeTab",
          x: 80,
          y: 6,
          width: 190,
          height: 32,
          radius: 8,
          fill: "#35363a"
        })
      );
      this.tabTitle = this.add(
        text({
          name: "tabTitle",
          text: tabTitle,
          x: 96,
          y: 14,
          fontSize: 12,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: "#e8eaed"
        })
      );
      this.navBar = this.add(
        rect({
          name: "navBar",
          y: 38,
          width,
          height: 42,
          fill: "#35363a"
        })
      );
      this.add(
        text({
          name: "navIcons",
          text: "\u2039   \u203A   \u21BB",
          x: 16,
          y: 48,
          fontSize: 16,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: "#9aa0a6"
        })
      );
      const omniboxWidth = Math.max(200, width - 120);
      this.urlbarRect = this.add(
        rect({
          name: "urlbarRect",
          x: 96,
          y: 45,
          width: omniboxWidth,
          height: 28,
          radius: 14,
          fill: "#202124"
        })
      );
      class DynamicUrlTextNode extends TextNode {
        propsAt(t) {
          const p = super.propsAt(t);
          p.text = `\u{1F512}  ${chrome2.urlbar.textAt(t)}`;
          return p;
        }
      }
      this.urlbarText = this.add(
        new DynamicUrlTextNode({
          name: "urlbarText",
          text: `\u{1F512}  ${url}`,
          x: 112,
          y: 51,
          fontSize: 12,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: "#e8eaed"
        })
      );
      this.pageArea = this.contentArea.add(
        group({
          name: "pageArea",
          y: 42,
          // relative to contentArea (which starts at y=38, so pageArea is at y=80 overall)
          width,
          height: Math.max(0, height - 80),
          clip: true
        })
      );
    }
  };
  var chrome = (init) => new ChromeNode(init);

  // ../../packages/runtime/src/mockups/editor.ts
  var EditorNode = class extends WindowNode {
    tabTitle;
    tabRect;
    gutter;
    gutterText;
    codeNode;
    highlightRects = /* @__PURE__ */ new Map();
    highlights = [];
    typeActions = [];
    initialCode;
    constructor(init = {}) {
      const { filename = "index.ts", code = "", width = 900, height = 600, ...rest } = init;
      super({ ...rest, title: `Visual Studio Code \u2014 ${filename}`, width, height, theme: "dark" });
      this.initialCode = code;
      const ed = this;
      this.tabRect = this.add(
        rect({
          name: "tabRect",
          x: 80,
          y: 6,
          width: 160,
          height: 32,
          radius: 4,
          fill: "#1e1e1e"
        })
      );
      this.tabTitle = this.add(
        text({
          name: "tabTitle",
          text: filename,
          x: 104,
          y: 14,
          fontSize: 12,
          fontFamily: "SF Pro Text, -apple-system, sans-serif",
          color: "#ffffff"
        })
      );
      this.gutter = this.contentArea.add(
        rect({
          name: "gutter",
          width: 48,
          height: Math.max(0, height - 38),
          fill: "#181818"
        })
      );
      class DynamicGutterTextNode extends TextNode {
        propsAt(t) {
          const p = super.propsAt(t);
          const codeLines = ed.codeAt(t).split("\n").length;
          p.text = Array.from({ length: Math.max(1, codeLines) }, (_, i) => String(i + 1)).join("\n");
          return p;
        }
      }
      this.gutterText = this.contentArea.add(
        new DynamicGutterTextNode({
          name: "gutterText",
          x: 36,
          y: 12,
          anchorX: 1,
          fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#6e7681"
        })
      );
      class DynamicCodeTextNode extends TextNode {
        propsAt(t) {
          const p = super.propsAt(t);
          p.text = ed.codeAt(t);
          return p;
        }
      }
      this.codeNode = this.contentArea.add(
        new DynamicCodeTextNode({
          name: "codeText",
          x: 60,
          y: 12,
          text: code,
          fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#e6edf3"
        })
      );
    }
    typeCode(code, opts) {
      this.typeActions.push({
        code,
        at: opts.at,
        duration: Math.max(0.01, opts.duration)
      });
      this.typeActions.sort((a, b) => a.at - b.at);
      return this;
    }
    codeAt(t) {
      let current = this.initialCode;
      for (const a of this.typeActions) {
        if (a.at > t) break;
        const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
        const chars = Math.floor(progress * a.code.length);
        current = a.code.slice(0, chars);
      }
      return current;
    }
    highlightLine(line, opts) {
      const duration = opts.duration ?? Infinity;
      this.highlights.push({
        line,
        start: opts.at,
        end: opts.at + duration
      });
      return this;
    }
    isLineHighlighted(line, t) {
      return this.highlights.some((h) => h.line === line && t >= h.start && t <= h.end);
    }
  };
  var editor = (init) => new EditorNode(init);

  // ../../packages/runtime/src/mockups/cursor.ts
  var CursorNode = class extends GroupNode {
    icon;
    constructor(init = {}) {
      const { pointer = false, x = 0, y = 0, ...rest } = init;
      super({ ...rest, x, y, z: 999 });
      this.icon = this.add(
        text({
          name: "icon",
          text: pointer ? "\u{1F446}" : "\u2196",
          fontSize: 24,
          fontFamily: "-apple-system, sans-serif",
          color: "#ffffff"
        })
      );
    }
    moveTo(x, y, opts) {
      return this.to({ x, y }, opts);
    }
    click(opts) {
      const dur = opts.duration ?? 0.15;
      const half = dur / 2;
      this.to({ scaleX: 0.8, scaleY: 0.8 }, { at: opts.at, duration: half });
      this.to({ scaleX: 1, scaleY: 1 }, { at: opts.at + half, duration: half });
      return this;
    }
  };
  var cursor = (init) => new CursorNode(init);

  // ../../packages/runtime/src/mockups/focus.ts
  function focus(target, opts) {
    const duration = opts.duration ?? 0.5;
    const scale2 = opts.scale ?? 1.02;
    const dimOthers = opts.dimOthers ?? 0.4;
    const blurOthers = opts.blurOthers ?? 6;
    target.to(
      {
        z: 10,
        scaleX: scale2,
        scaleY: scale2,
        opacity: 1,
        blur: 0
      },
      { at: opts.at, duration }
    );
    if (target.parent) {
      for (const sibling of target.parent.children) {
        if (sibling === target || sibling instanceof CursorNode) continue;
        sibling.to(
          {
            z: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: dimOthers,
            blur: blurOthers
          },
          { at: opts.at, duration }
        );
      }
    }
  }

  // ../../packages/runtime/src/mockups/phone.ts
  var PhoneNode = class extends GroupNode {
    bezel;
    screen;
    contentArea;
    dynamicIsland;
    timeText;
    homeIndicator;
    constructor(init = {}) {
      const {
        theme = "dark",
        time = "9:41",
        showIsland = true,
        showHomeIndicator = true,
        width = 400,
        height = 820,
        ...rest
      } = init;
      super({ ...rest, width, height });
      const isDark = theme === "dark";
      const bezelColor = isDark ? "#1a1a1e" : "#e2e2e8";
      const bezelBorder = isDark ? "#2e2e36" : "#c4c4cc";
      const screenBg = isDark ? "#000000" : "#ffffff";
      const textColor = isDark ? "#ffffff" : "#000000";
      const outerRadius = 50;
      const innerRadius = 42;
      const bezelWidth = 8;
      this.bezel = this.add(
        rect({
          name: "bezel",
          width,
          height,
          radius: outerRadius,
          fill: bezelColor,
          stroke: bezelBorder,
          strokeWidth: 2
        })
      );
      const screenW = width - bezelWidth * 2;
      const screenH = height - bezelWidth * 2;
      this.screen = this.add(
        rect({
          name: "screen",
          x: bezelWidth,
          y: bezelWidth,
          width: screenW,
          height: screenH,
          radius: innerRadius,
          fill: screenBg,
          clip: true
        })
      );
      this.contentArea = this.screen.add(
        group({
          name: "contentArea",
          width: screenW,
          height: screenH
        })
      );
      this.timeText = this.screen.add(
        text({
          name: "timeText",
          text: time,
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "SF Pro Text",
          color: textColor,
          x: 32,
          y: 14,
          z: 99
        })
      );
      const islandWidth = Math.min(screenW * 0.32, 126);
      const islandHeight = 32;
      this.dynamicIsland = this.screen.add(
        rect({
          name: "dynamicIsland",
          width: islandWidth,
          height: islandHeight,
          x: (screenW - islandWidth) / 2,
          y: 11,
          radius: 16,
          fill: "#000000",
          opacity: showIsland ? 1 : 0,
          z: 100
        })
      );
      const homeW = Math.min(screenW * 0.36, 140);
      const homeH = 5;
      this.homeIndicator = this.screen.add(
        rect({
          name: "homeIndicator",
          width: homeW,
          height: homeH,
          x: (screenW - homeW) / 2,
          y: screenH - 12,
          radius: 2.5,
          fill: isDark ? "#ffffff" : "#000000",
          opacity: showHomeIndicator ? 0.8 : 0,
          z: 100
        })
      );
    }
    get width() {
      return this.propsAt(0).width;
    }
    get height() {
      return this.propsAt(0).height;
    }
  };
  function phone(init = {}) {
    return new PhoneNode(init);
  }

  // ../../packages/runtime/src/mockups/logo.ts
  var tokyoNightColors = {
    window: "#16161e",
    sky: "#7aa2f7",
    green: "#9ece6a"
  };
  function logoMark(name, size, x, y) {
    const colors = tokyoNightColors;
    const mark = group({ name, width: size, height: size, x, y, anchorX: 0.5, anchorY: 0.5 });
    mark.add(
      rect({
        name: "plate",
        width: size,
        height: size,
        radius: size * 0.26,
        fill: colors.window,
        stroke: colors.sky,
        strokeWidth: Math.max(2, size * 0.03)
      })
    );
    mark.add(
      path({
        name: "playGlyph",
        d: `M ${size * 0.4} ${size * 0.3} L ${size * 0.72} ${size * 0.5} L ${size * 0.4} ${size * 0.7} Z`,
        fill: colors.sky
      })
    );
    mark.add(
      circle({
        name: "sparkDot",
        radius: size * 0.05,
        x: size * 0.8,
        y: size * 0.2,
        anchorX: 0.5,
        anchorY: 0.5,
        fill: colors.green
      })
    );
    return mark;
  }
  return __toCommonJS(index_exports);
})();

globalThis.__liosvideo = __liosvideo;
