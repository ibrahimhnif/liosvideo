var __liosvideo = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// ../../packages/runtime/src/anim/easing.ts
	const C1 = 1.70158;
	const C3 = 2.70158;
	const EASINGS = {
		linear: (t) => t,
		inQuad: (t) => t * t,
		outQuad: (t) => 1 - (1 - t) * (1 - t),
		inOutQuad: (t) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
		inCubic: (t) => t * t * t,
		outCubic: (t) => 1 - (1 - t) ** 3,
		inOutCubic: (t) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
		outBack: (t) => 1 + C3 * (t - 1) ** 3 + C1 * (t - 1) ** 2,
		inExpo: (t) => t === 0 ? 0 : 2 ** (10 * t - 10),
		outExpo: (t) => t === 1 ? 1 : 1 - 2 ** (-10 * t),
		inOutExpo: (t) => t === 0 ? 0 : t === 1 ? 1 : t < .5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
		inSine: (t) => 1 - Math.cos(t * Math.PI / 2),
		outSine: (t) => Math.sin(t * Math.PI / 2),
		inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2
	};
	/** Every built-in easing name, in documentation order. */
	const EASE_NAMES = Object.keys(EASINGS);
	function isEase(e) {
		return typeof e === "function" || typeof e === "string" && Object.hasOwn(EASINGS, e);
	}
	function ease(e, t) {
		const fn = typeof e === "function" ? e : Object.hasOwn(EASINGS, e) ? EASINGS[e] : void 0;
		if (!fn) throw new Error(`Unknown ease ${JSON.stringify(e)}. Use one of: ${EASE_NAMES.join(", ")}`);
		const c = Math.min(1, Math.max(0, t));
		if (c === 0) return 0;
		if (c === 1) return 1;
		return fn(c);
	}
	// ../../packages/runtime/src/math/color.ts
	function parseColor(hex) {
		let h = hex.replace(/^#/, "");
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
		if (h.length === 6) h += "ff";
		if (!/^[0-9a-f]{8}$/i.test(h)) throw new Error(`Invalid color "${hex}"`);
		return [
			0,
			2,
			4,
			6
		].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	}
	function formatColor([r, g, b, a]) {
		return "#" + [
			r,
			g,
			b,
			a
		].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
	}
	function lerpColor(a, b, t) {
		const ca = parseColor(a);
		const cb = parseColor(b);
		return formatColor(ca.map((v, i) => v + (cb[i] - v) * t));
	}
	// ../../packages/runtime/src/anim/track.ts
	const isColor = (v) => typeof v === "string" && v.startsWith("#");
	function interpolate(a, b, k) {
		if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
		if (isColor(a) && isColor(b)) return lerpColor(a, b, k);
		return b;
	}
	/** Keyframe track for one property. Pure: valueAt depends only on t and the segments. */
	var Track = class {
		initial;
		sorted = [];
		constructor(initial) {
			this.initial = initial;
		}
		/** Replaces the value before the first keyframe. */
		setBase(value) {
			this.initial = value;
		}
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
				if (t >= seg.end) value = seg.to;
				else {
					const k = ease(seg.ease, (t - seg.start) / (seg.end - seg.start));
					value = interpolate(from, seg.to, k);
				}
			}
			return value;
		}
	};
	// ../../packages/runtime/src/graph/enums.ts
	/** Props that only take one of a few strings. */
	const PROP_ENUMS = {
		fit: [
			"fill",
			"contain",
			"cover"
		],
		align: [
			"left",
			"center",
			"right"
		],
		toneMapping: [
			"none",
			"linear",
			"reinhard",
			"cineon",
			"aces",
			"agx",
			"neutral"
		]
	};
	const RUNTIME_FRAME = /(\/packages\/runtime\/src\/|liosvideo\.iife|node_modules|\/liosvideo\/src\/|^\s*at (new )?(Node|TextNode|ImageNode)\b)/;
	/** "scenes/hook.ts:42" for the first scene-code frame of the current stack, if it can be read. */
	function callSite() {
		const stack = (/* @__PURE__ */ new Error()).stack ?? "";
		for (const line of stack.split("\n").slice(1)) {
			if (RUNTIME_FRAME.test(line)) continue;
			const m = /((?:file:\/\/)?[^\s()]+\.(?:[cm]?[jt]sx?)):(\d+)(?::\d+)?\)?\s*$/.exec(line);
			if (!m || /^(blob:|https?:|data:)/.test(m[1])) continue;
			return `${m[1].replace(/^file:\/\//, "").split("/").slice(-2).join("/")}:${m[2]}`;
		}
	}
	function unknownValue(what, value, allowed, where) {
		const site = callSite();
		return /* @__PURE__ */ new Error(`Unknown ${what} ${JSON.stringify(value)}${where ? ` on ${where}` : ""}${site ? ` (${site})` : ""}. Use one of: ${allowed.join(", ")}`);
	}
	/** Throws for any enum prop in `props` that has a value outside its list. */
	function checkEnumProps(props, node) {
		for (const [key, allowed] of Object.entries(PROP_ENUMS)) {
			const v = props[key];
			if (v !== void 0 && !allowed.includes(v)) throw unknownValue(key, v, allowed, `node "${node}"`);
		}
	}
	// ../../packages/runtime/src/anim/transition.ts
	const TRANSITIONS = [
		"fade",
		"slide",
		"zoom",
		"wipe"
	];
	const DIRECTIONS = [
		"left",
		"right",
		"up",
		"down"
	];
	function transition(typeOrFn, optsOrDuration = .5) {
		if (typeof typeOrFn !== "function" && !TRANSITIONS.includes(typeOrFn)) throw unknownValue("transition", typeOrFn, TRANSITIONS);
		const direction = typeof optsOrDuration === "object" ? optsOrDuration.direction : void 0;
		if (direction !== void 0 && !DIRECTIONS.includes(direction)) throw unknownValue("direction", direction, DIRECTIONS, "transition");
		if (typeof typeOrFn === "function") return {
			type: "custom",
			duration: typeof optsOrDuration === "number" ? optsOrDuration : optsOrDuration.duration ?? .5,
			apply: typeOrFn
		};
		if (typeof optsOrDuration === "number") return {
			type: typeOrFn,
			duration: optsOrDuration
		};
		return {
			type: typeOrFn,
			duration: optsOrDuration.duration ?? .5,
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
				anyNode.base.scaleX = .8 + .2 * t;
				anyNode.base.scaleY = .8 + .2 * t;
				anyNode.base.opacity = t;
				break;
			case "wipe": anyNode.base.opacity = t;
		}
	}
	// ../../packages/runtime/src/math/affine.ts
	const IDENTITY = [
		1,
		0,
		0,
		1,
		0,
		0
	];
	/** m · n — n is applied first. */
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
	const translate = (x, y) => [
		1,
		0,
		0,
		1,
		x,
		y
	];
	const scale = (sx, sy) => [
		sx,
		0,
		0,
		sy,
		0,
		0
	];
	function rotate(degrees) {
		const r = degrees * Math.PI / 180;
		const c = Math.cos(r);
		const s = Math.sin(r);
		return [
			c,
			s,
			-s,
			c,
			0,
			0
		];
	}
	// ../../packages/runtime/src/math/random.ts
	/** Deterministic RNG (mulberry32 over an FNV-1a hash of the seed). */
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
	// ../../packages/runtime/src/assets/attributions.ts
	const HEADERS = [
		["asset", /^(asset|aset|file|berkas|path)\b/i],
		["license", /(licen[cs]e|lisensi)/i],
		["author", /(author|creator|pembuat|kreator|fotografer|photographer|credit)/i],
		["source", /(source|sumber|url|link)/i],
		["notes", /(notes?|usage|scene|catatan|pemakaian|adegan)/i]
	];
	const STANDARD = [
		"asset",
		"source",
		"author",
		"license",
		"notes"
	];
	let rows = /* @__PURE__ */ new Map();
	let byName = /* @__PURE__ */ new Map();
	const normalise = (path) => path.trim().replace(/^`|`$/g, "").trim().replace(/^\.?\//, "");
	const basename = (path) => path.split("/").pop() ?? path;
	const cellsOf = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
	/**
	* Parses the attribution table(s). Columns are matched by header name (Asset/File, Source/Sumber,
	* Author/Creator, License/Lisensi, Notes/Scene), falling back to the standard order.
	*/
	function registerAttributions(markdown) {
		rows = /* @__PURE__ */ new Map();
		byName = /* @__PURE__ */ new Map();
		let columns = STANDARD;
		for (const line of (markdown ?? "").split("\n")) {
			if (!line.trim().startsWith("|")) continue;
			const cells = cellsOf(line);
			if (cells.every((c) => /^:?-*:?$/.test(c))) continue;
			const header = cells.map((c) => HEADERS.find(([, re]) => re.test(c))?.[0]);
			if (header[0] === "asset" && !cells[0].includes(".")) {
				columns = header;
				continue;
			}
			const row = {
				asset: "",
				source: "",
				author: "",
				license: "",
				notes: ""
			};
			cells.forEach((c, i) => {
				const field = columns[i];
				if (field && !row[field]) row[field] = field === "asset" ? normalise(c) : c;
			});
			if (!row.asset) continue;
			rows.set(row.asset, row);
			if (!byName.has(basename(row.asset))) byName.set(basename(row.asset), row);
		}
	}
	/** The attribution row for a project asset path (or a row listing just its file name). */
	function attribution(asset) {
		const hosted = globalThis.__liosAttributions;
		if (!rows.size && hosted) registerAttributions(hosted);
		const path = normalise(asset);
		return rows.get(path) ?? byName.get(basename(path));
	}
	/**
	* The recorded file `<dir>/<stem>.<any extension>`, for names that leave the extension out
	* (`sfx: "whoosh"` finds an `assets/audio/sfx/whoosh.mp3` downloaded with its row). A `.wav`
	* wins when several are recorded.
	*/
	function attributedFile(dir, stem) {
		const hosted = globalThis.__liosAttributions;
		if (!rows.size && hosted) registerAttributions(hosted);
		const prefix = `${normalise(dir).replace(/\/$/, "")}/${stem}.`;
		const found = [...rows.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
		return found.find((path) => path.endsWith(".wav")) ?? found[0];
	}
	// ../../packages/runtime/src/audio/sfx.ts
	const ON = ["start", "end"];
	/** The cue for a move from `start` to `end` (scene seconds). */
	function sfxCue(spec, start, end, where) {
		const o = typeof spec === "string" ? { name: spec } : spec;
		if (!o.name) throw new Error(`SFX for ${where} needs a name`);
		const on = o.on ?? "start";
		if (!ON.includes(on)) throw new Error(`SFX on ${JSON.stringify(on)} for ${where}: use one of: ${ON.join(", ")}`);
		const cue = {
			name: o.name,
			at: Math.max(0, (on === "end" ? end : start) + (o.offset ?? 0))
		};
		if (o.volume !== void 0) cue.volume = o.volume;
		if (o.duration !== void 0) cue.duration = o.duration;
		return cue;
	}
	/**
	* File, level and fades of a cue: the library entry, else a path as written, else the
	* `assets/audio/sfx/<name>.*` recorded in assets/ATTRIBUTIONS.md, else assets/audio/sfx/<name>.wav.
	*/
	function resolveSfx(cue, opts = {}) {
		const entry = opts.library?.[cue.name];
		const libSrc = typeof entry === "string" ? entry : entry?.src;
		const libVolume = typeof entry === "object" ? entry.volume : void 0;
		const looksLikePath = /[/.]/.test(cue.name);
		return {
			src: libSrc ?? (looksLikePath ? cue.name : attributedFile("assets/audio/sfx", cue.name) ?? `assets/audio/sfx/${cue.name}.wav`),
			volume: cue.volume ?? libVolume ?? opts.volume ?? .5,
			duration: cue.duration,
			fadeIn: .005,
			fadeOut: cue.duration !== void 0 ? Math.min(.12, cue.duration / 3) : .03
		};
	}
	// ../../packages/runtime/src/graph/node.ts
	const BASE_DEFAULTS = {
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
		clip: false,
		pixelate: 0,
		posterize: 0,
		halftone: 0,
		outline: 0,
		outlineColor: "#111111",
		chalk: 0,
		glow: 0,
		glowIntensity: 1,
		glowThreshold: 0,
		sticker: 0,
		stickerColor: "#ffffff",
		stickerGap: 6,
		stickerWobble: .5,
		stickerBoil: 8
	};
	var Node = class {
		kind;
		parent;
		children = [];
		_name;
		requestedName;
		base;
		tracks = /* @__PURE__ */ new Map();
		drivers = [];
		cues = [];
		constructor(kind, defaults, init = {}) {
			this.kind = kind;
			const { name, ...props } = init;
			if (name?.includes("/")) throw new Error(`Node name "${name}" must not contain "/"`);
			this.requestedName = name;
			this._name = name ?? `${kind}0`;
			checkEnumProps(props, this._name);
			this.base = {
				...defaults,
				...props
			};
		}
		get name() {
			return this._name;
		}
		path() {
			return this.parent ? `${this.parent.path()}/${this._name}` : this._name;
		}
		add(child) {
			if (child.requestedName === void 0) child._name = `${child.kind}${this.children.filter((c) => c.kind === child.kind).length}`;
			else {
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
		/** Changes base (un-animated) values, e.g. from a layout helper; keyframes still win where they apply. */
		assign(props) {
			checkEnumProps(props, this._name);
			Object.assign(this.base, props);
			for (const key of Object.keys(props)) this.tracks.get(key)?.setBase(props[key]);
			return this;
		}
		set(props, at) {
			return this.to(props, {
				at,
				duration: 0
			});
		}
		/**
		* Animates to `props`. `sfx: "whoosh"` (or `{ name, on: "start" | "end", volume, offset, duration }`)
		* plays a sound effect with the move; the composition adds it to the soundtrack.
		*/
		to(props, opts) {
			checkEnumProps(props, this._name);
			if (opts.ease !== void 0 && !isEase(opts.ease)) throw unknownValue("ease", opts.ease, EASE_NAMES, `node "${this._name}" (${Object.keys(props).join(", ")})`);
			for (const key of Object.keys(props)) this.track(key).add({
				start: opts.at,
				end: opts.at + opts.duration,
				from: void 0,
				to: props[key],
				ease: opts.ease ?? "inOutCubic"
			});
			if (opts.sfx !== void 0) this.cues.push(sfxCue(opts.sfx, opts.at, opts.at + opts.duration, `node "${this._name}"`));
			return this;
		}
		/** Sound effects of this node's moves, in scene seconds. */
		sfxCues() {
			return this.cues;
		}
		/**
		* Sets props from a pure function of scene time, applied after keyframes (later drivers win).
		* For values that follow something else, e.g. a callout pinned to a projected 3D point.
		*/
		drive(fn) {
			this.drivers.push(fn);
			return this;
		}
		/** Time ranges (seconds) in which any property animates; overlapping or touching ranges are merged. */
		spans() {
			const all = [...this.tracks.values()].flatMap((tr) => tr.segments().map((s) => ({
				start: s.start,
				end: s.end
			})));
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
			for (const fn of this.drivers) Object.assign(p, fn(t));
			return p;
		}
		localMatrix(t) {
			const p = this.propsAt(t);
			return multiply(multiply(multiply(translate(p.x, p.y), rotate(p.rotation)), scale(p.scaleX, p.scaleY)), translate(-p.anchorX * p.width, -p.anchorY * p.height));
		}
	};
	// ../../packages/runtime/src/math/svgpath.ts
	const ARITY = {
		M: 2,
		L: 2,
		H: 1,
		V: 1,
		C: 6,
		S: 4,
		Q: 4,
		T: 2,
		A: 7,
		Z: 0
	};
	const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
	function tokenize(d) {
		const out = [];
		for (const match of d.matchAll(TOKEN)) out.push(match[1] ?? Number(match[2]));
		return out;
	}
	var Accumulator = class {
		minX = Infinity;
		minY = Infinity;
		maxX = -Infinity;
		maxY = -Infinity;
		get empty() {
			return this.minX > this.maxX || this.minY > this.maxY;
		}
		x(value) {
			if (value < this.minX) this.minX = value;
			if (value > this.maxX) this.maxX = value;
		}
		y(value) {
			if (value < this.minY) this.minY = value;
			if (value > this.maxY) this.maxY = value;
		}
		point(x, y) {
			this.x(x);
			this.y(y);
		}
	};
	/** Interior extrema of a cubic Bézier on one axis (endpoints included by the caller). */
	function cubicExtrema(p0, p1, p2, p3, into) {
		const a = -p0 + 3 * p1 - 3 * p2 + p3;
		const b = 2 * (p0 - 2 * p1 + p2);
		const c = p1 - p0;
		if (Math.abs(a) < 1e-12) {
			if (Math.abs(b) > 1e-12) into(-c / b);
			return;
		}
		const disc = b * b - 4 * a * c;
		if (disc < 0) return;
		const root = Math.sqrt(disc);
		into((-b + root) / (2 * a));
		into((-b - root) / (2 * a));
	}
	function cubicPoint(p0, p1, p2, p3, t) {
		const u = 1 - t;
		return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
	}
	function addCubic(bounds, x0, y0, x1, y1, x2, y2, x, y) {
		bounds.point(x, y);
		cubicExtrema(x0, x1, x2, x, (t) => {
			if (t > 0 && t < 1) bounds.x(cubicPoint(x0, x1, x2, x, t));
		});
		cubicExtrema(y0, y1, y2, y, (t) => {
			if (t > 0 && t < 1) bounds.y(cubicPoint(y0, y1, y2, y, t));
		});
	}
	function addQuad(bounds, x0, y0, x1, y1, x, y) {
		bounds.point(x, y);
		const peak = (p0, p1, p2) => {
			const den = p0 - 2 * p1 + p2;
			return den === 0 ? NaN : (p0 - p1) / den;
		};
		const tx = peak(x0, x1, x);
		if (tx > 0 && tx < 1) {
			const u = 1 - tx;
			bounds.x(u * u * x0 + 2 * u * tx * x1 + tx * tx * x);
		}
		const ty = peak(y0, y1, y);
		if (ty > 0 && ty < 1) {
			const u = 1 - ty;
			bounds.y(u * u * y0 + 2 * u * ty * y1 + ty * ty * y);
		}
	}
	/** Samples an elliptical arc (SVG spec F.6.5 endpoint parameterisation) at ~1°. */
	function addArc(bounds, x0, y0, rx, ry, rotation, largeArc, sweep, x, y) {
		bounds.point(x, y);
		rx = Math.abs(rx);
		ry = Math.abs(ry);
		if (rx === 0 || ry === 0 || x0 === x && y0 === y) return;
		const phi = rotation * Math.PI / 180;
		const cos = Math.cos(phi);
		const sin = Math.sin(phi);
		const dx = (x0 - x) / 2;
		const dy = (y0 - y) / 2;
		const x1 = cos * dx + sin * dy;
		const y1 = -sin * dx + cos * dy;
		const lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
		if (lambda > 1) {
			const k = Math.sqrt(lambda);
			rx *= k;
			ry *= k;
		}
		const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
		const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
		if (den === 0) return;
		const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
		const cxp = coef * rx * y1 / ry;
		const cyp = -coef * ry * x1 / rx;
		const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
		const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
		const angle = (ux, uy, vx, vy) => {
			const dot = ux * vx + uy * vy;
			const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
			const raw = len === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot / len)));
			return ux * vy - uy * vx < 0 ? -raw : raw;
		};
		const ux = (x1 - cxp) / rx;
		const uy = (y1 - cyp) / ry;
		const vx = (-x1 - cxp) / rx;
		const vy = (-y1 - cyp) / ry;
		const start = angle(1, 0, ux, uy);
		let delta = angle(ux, uy, vx, vy);
		if (!sweep && delta > 0) delta -= Math.PI * 2;
		if (sweep && delta < 0) delta += Math.PI * 2;
		const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 180)));
		for (let i = 1; i < steps; i++) {
			const a = start + delta * i / steps;
			const px = rx * Math.cos(a);
			const py = ry * Math.sin(a);
			bounds.point(cx + cos * px - sin * py, cy + sin * px + cos * py);
		}
	}
	function trace(tokens, bounds) {
		let i = 0;
		let cmd = "";
		let cx = 0;
		let cy = 0;
		let sx = 0;
		let sy = 0;
		let prev = "";
		let cubicX = 0;
		let cubicY = 0;
		let quadX = 0;
		let quadY = 0;
		while (i < tokens.length) {
			const token = tokens[i];
			if (typeof token === "string") {
				cmd = token;
				i++;
			} else if (!cmd) {
				i++;
				continue;
			}
			const upper = cmd.toUpperCase();
			const rel = cmd !== upper;
			const arity = ARITY[upper];
			if (arity === void 0) {
				cmd = "";
				continue;
			}
			if (arity === 0) {
				cx = sx;
				cy = sy;
				prev = "Z";
				cmd = "";
				continue;
			}
			const args = [];
			while (args.length < arity && i < tokens.length && typeof tokens[i] === "number") args.push(tokens[i++]);
			if (args.length < arity) break;
			switch (upper) {
				case "M": {
					const x = rel ? cx + args[0] : args[0];
					const y = rel ? cy + args[1] : args[1];
					cx = x;
					cy = y;
					sx = x;
					sy = y;
					bounds.point(x, y);
					prev = "M";
					cmd = rel ? "l" : "L";
					break;
				}
				case "L": {
					const x = rel ? cx + args[0] : args[0];
					const y = rel ? cy + args[1] : args[1];
					bounds.point(x, y);
					cx = x;
					cy = y;
					prev = "L";
					break;
				}
				case "H": {
					const x = rel ? cx + args[0] : args[0];
					bounds.point(x, cy);
					cx = x;
					prev = "H";
					break;
				}
				case "V": {
					const y = rel ? cy + args[0] : args[0];
					bounds.point(cx, y);
					cy = y;
					prev = "V";
					break;
				}
				case "C": {
					const x1 = rel ? cx + args[0] : args[0];
					const y1 = rel ? cy + args[1] : args[1];
					const x2 = rel ? cx + args[2] : args[2];
					const y2 = rel ? cy + args[3] : args[3];
					const x = rel ? cx + args[4] : args[4];
					const y = rel ? cy + args[5] : args[5];
					addCubic(bounds, cx, cy, x1, y1, x2, y2, x, y);
					cubicX = x2;
					cubicY = y2;
					cx = x;
					cy = y;
					prev = "C";
					break;
				}
				case "S": {
					const x2 = rel ? cx + args[0] : args[0];
					const y2 = rel ? cy + args[1] : args[1];
					const x = rel ? cx + args[2] : args[2];
					const y = rel ? cy + args[3] : args[3];
					const smooth = prev === "C" || prev === "S";
					const x1 = smooth ? 2 * cx - cubicX : cx;
					const y1 = smooth ? 2 * cy - cubicY : cy;
					addCubic(bounds, cx, cy, x1, y1, x2, y2, x, y);
					cubicX = x2;
					cubicY = y2;
					cx = x;
					cy = y;
					prev = "S";
					break;
				}
				case "Q": {
					const x1 = rel ? cx + args[0] : args[0];
					const y1 = rel ? cy + args[1] : args[1];
					const x = rel ? cx + args[2] : args[2];
					const y = rel ? cy + args[3] : args[3];
					addQuad(bounds, cx, cy, x1, y1, x, y);
					quadX = x1;
					quadY = y1;
					cx = x;
					cy = y;
					prev = "Q";
					break;
				}
				case "T": {
					const x = rel ? cx + args[0] : args[0];
					const y = rel ? cy + args[1] : args[1];
					const smooth = prev === "Q" || prev === "T";
					const x1 = smooth ? 2 * cx - quadX : cx;
					const y1 = smooth ? 2 * cy - quadY : cy;
					addQuad(bounds, cx, cy, x1, y1, x, y);
					quadX = x1;
					quadY = y1;
					cx = x;
					cy = y;
					prev = "T";
					break;
				}
				case "A": {
					const x = rel ? cx + args[5] : args[5];
					const y = rel ? cy + args[6] : args[6];
					addArc(bounds, cx, cy, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, x, y);
					cx = x;
					cy = y;
					prev = "A";
					break;
				}
			}
		}
	}
	/**
	* Bounds of `d` in local units. `strokeWidth` widens the box by half on every side,
	* since a stroke straddles the path. Malformed or empty paths give a zero box.
	*/
	function pathBounds(d, strokeWidth = 0) {
		const bounds = new Accumulator();
		trace(tokenize(d), bounds);
		if (bounds.empty) return {
			x: 0,
			y: 0,
			width: 0,
			height: 0
		};
		const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
		return {
			x: bounds.minX - pad,
			y: bounds.minY - pad,
			width: bounds.maxX - bounds.minX + pad * 2,
			height: bounds.maxY - bounds.minY + pad * 2
		};
	}
	// ../../packages/runtime/src/three/dof.ts
	const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
	/** `n` points spread evenly over the unit disc (a Vogel spiral); the same for the same `n`. */
	function dofOffsets(n) {
		return Array.from({ length: n }, (_, i) => {
			const r = Math.sqrt((i + .5) / n);
			const a = i * GOLDEN_ANGLE;
			return [r * Math.cos(a), r * Math.sin(a)];
		});
	}
	/**
	* The camera moves for one frame: call each pass before a render; it returns the function that
	* puts the camera back. Without depth of field (or for an orthographic camera) there is one pass
	* that changes nothing. `height` is the render height in pixels.
	*/
	function depthOfFieldPasses(dof, camera, time, height) {
		const plain = [() => () => {}];
		if (!dof) return plain;
		if (!(dof.aperture >= 0)) throw new Error(`depthOfField: aperture must be 0 or more, got ${dof.aperture}`);
		const samples = dof.samples ?? 16;
		if (!(Number.isInteger(samples) && samples >= 1)) throw new Error(`depthOfField: samples must be a whole number ≥ 1, got ${samples}`);
		const cam = camera;
		if (!cam.isPerspectiveCamera || dof.aperture === 0 || samples === 1) return plain;
		cam.updateMatrixWorld();
		const m = cam.matrixWorld.elements;
		const right = [
			m[0],
			m[1],
			m[2]
		];
		const up = [
			m[4],
			m[5],
			m[6]
		];
		const forward = [
			-m[8],
			-m[9],
			-m[10]
		];
		const eye = [
			m[12],
			m[13],
			m[14]
		];
		const focus = typeof dof.focus === "function" ? dof.focus(time) : dof.focus;
		const distance = Array.isArray(focus) ? (focus[0] - eye[0]) * forward[0] + (focus[1] - eye[1]) * forward[1] + (focus[2] - eye[2]) * forward[2] : focus;
		if (!(distance > 0)) throw new Error(`depthOfField: the focus must be in front of the camera (distance ${distance})`);
		const pxPerUnit = height / 2 / (distance * Math.tan(cam.fov * Math.PI / 180 / 2) / cam.zoom);
		return dofOffsets(samples).map(([ox, oy]) => () => {
			const position = cam.position.clone();
			const view = cam.view ? { ...cam.view } : null;
			const sx = ox * dof.aperture;
			const sy = oy * dof.aperture;
			const shift = [
				right[0] * sx + up[0] * sy,
				right[1] * sx + up[1] * sy,
				right[2] * sx + up[2] * sy
			];
			if (cam.parent) {
				const inv = cam.parent.matrixWorld.clone().invert().elements;
				cam.position.set(position.x + inv[0] * shift[0] + inv[4] * shift[1] + inv[8] * shift[2], position.y + inv[1] * shift[0] + inv[5] * shift[1] + inv[9] * shift[2], position.z + inv[2] * shift[0] + inv[6] * shift[1] + inv[10] * shift[2]);
			} else cam.position.set(position.x + shift[0], position.y + shift[1], position.z + shift[2]);
			cam.updateMatrixWorld();
			const fullHeight = height;
			const fullWidth = height * cam.aspect;
			const baseX = view?.enabled ? view.offsetX : 0;
			const baseY = view?.enabled ? view.offsetY : 0;
			cam.setViewOffset(view?.enabled ? view.fullWidth : fullWidth, view?.enabled ? view.fullHeight : fullHeight, baseX - sx * pxPerUnit, baseY + sy * pxPerUnit, view?.enabled ? view.width : fullWidth, view?.enabled ? view.height : fullHeight);
			return () => {
				cam.position.copy(position);
				if (view?.enabled) cam.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
				else cam.clearViewOffset();
				cam.updateMatrixWorld();
			};
		});
	}
	/** Sums equally sized pixel buffers and gives their rounded average. */
	function pixelAverage(length) {
		const sum = new Float64Array(length);
		let count = 0;
		return {
			add(pixels) {
				for (let i = 0; i < length; i++) sum[i] += pixels[i];
				count++;
			},
			result() {
				const out = new Uint8Array(length);
				for (let i = 0; i < length; i++) out[i] = Math.round(sum[i] / Math.max(count, 1));
				return out;
			}
		};
	}
	// ../../packages/runtime/src/graph/three.ts
	const CAMERA = Symbol("liosvideo.threeCamera");
	var ThreeNode = class extends Node {
		setupFn;
		updateFn;
		constructor(init) {
			super("three", {
				...BASE_DEFAULTS,
				width: 400,
				height: 300,
				camera: "perspective",
				fov: 50,
				setup: init.setup,
				update: init.update
			}, init);
			const path = init.cameraPath;
			if (!path) {
				this.setupFn = init.setup;
				this.updateFn = init.update;
				return;
			}
			const stash = (ctx, result) => {
				const state = result ?? {};
				state[CAMERA] = ctx.camera;
				if (!("camera" in state)) state.camera = ctx.camera;
				path.apply(ctx.camera, 0);
				return state;
			};
			const setup = init.setup;
			this.setupFn = (ctx) => {
				const result = setup(ctx);
				return result instanceof Promise ? result.then((r) => stash(ctx, r)) : stash(ctx, result);
			};
			const update = init.update;
			this.updateFn = (state, progress, time) => {
				const camera = state?.[CAMERA];
				if (camera) path.apply(camera, time);
				update?.(state, progress, time);
			};
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
		/**
		* The camera moves for one frame of this node: one plain pass, or one per depth-of-field sample.
		* Each renderer calls a pass, renders, calls what the pass returned, and averages the renders.
		*/
		lensPasses(camera, time, height) {
			return depthOfFieldPasses(this.propsAt(0).depthOfField, camera, time, height);
		}
		/**
		* Where a world-space point is drawn at scene time `time`, in the coordinates of this node's parent
		* (the same space as its x / y). Exact for the camera that `cameraPath` drives. `depth` is the
		* distance in front of the camera; `visible` is false behind it or outside the node's frame.
		*/
		project(point, time) {
			const props = this.propsAt(time);
			if (!props.cameraPath) throw new Error(`project() on "${this.name}" needs the camera at build time: give three() a cameraPath (a still camera is cameraPath([{ at: 0, position: [x, y, z], target: [0, 0, 0] }]))`);
			const [px, py, pz] = typeof point === "function" ? point(time) : point;
			const pose = props.cameraPath.sample(time);
			const [ex, ey, ez] = pose.position;
			let zx = ex - pose.target[0], zy = ey - pose.target[1], zz = ez - pose.target[2];
			let len = Math.hypot(zx, zy, zz);
			if (len === 0) [zx, zy, zz, len] = [
				0,
				0,
				1,
				1
			];
			zx /= len;
			zy /= len;
			zz /= len;
			let xx = zz, xy = 0, xz = -zx;
			len = Math.hypot(xx, xy, xz);
			if (len === 0) {
				zz += 1e-4;
				len = Math.hypot(zx, zy, zz);
				zx /= len;
				zy /= len;
				zz /= len;
				xx = zz;
				xy = 0;
				xz = -zx;
				len = Math.hypot(xx, xy, xz);
			}
			xx /= len;
			xy /= len;
			xz /= len;
			const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
			const dx = px - ex, dy = py - ey, dz = pz - ez;
			const vx = dx * xx + dy * xy + dz * xz;
			const vy = dx * yx + dy * yy + dz * yz;
			const depth = -(dx * zx + dy * zy + dz * zz);
			const { width, height } = this;
			let nx;
			let ny;
			if (props.camera === "orthographic") {
				nx = vx / (width / 2);
				ny = vy / (height / 2);
			} else {
				const f = Math.tan((pose.fov ?? props.fov) * Math.PI / 180 / 2);
				nx = vx / (depth * f * (width / height));
				ny = vy / (depth * f);
			}
			const [x, y] = apply(this.localMatrix(time), (nx + 1) / 2 * width, (1 - ny) / 2 * height);
			return {
				x,
				y,
				depth,
				visible: depth > .1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1
			};
		}
		get renderOptions() {
			const p = this.propsAt(0);
			return {
				shadows: !!p.shadows,
				toneMapping: p.toneMapping ?? "none",
				exposure: p.exposure ?? 1
			};
		}
	};
	function three(init) {
		return new ThreeNode(init);
	}
	// ../../packages/runtime/src/graph/kinds.ts
	/** The packed cut-out `liosvideo asset matte` writes for a video: `dir/name.matte.mp4`. */
	function mattePath(src) {
		if (src.endsWith(".matte.mp4")) return src;
		const slash = src.lastIndexOf("/");
		const dot = src.lastIndexOf(".");
		return `${dot > slash ? src.slice(0, dot) : src}.matte.mp4`;
	}
	/** The file a video node decodes: its packed cut-out when `matte` is on. */
	function videoFile(p) {
		if (typeof p.matte === "string" && p.matte) return p.matte;
		return p.matte === true ? mattePath(p.src) : p.src;
	}
	var GroupNode = class extends Node {
		constructor(init) {
			super("group", BASE_DEFAULTS, init);
		}
	};
	var RectNode = class extends Node {
		constructor(init) {
			super("rect", {
				...BASE_DEFAULTS,
				fill: "#ffffff",
				stroke: "",
				strokeWidth: 0
			}, init);
		}
	};
	let measurer;
	const wrapCache = /* @__PURE__ */ new Map();
	const WRAP_CACHE_LIMIT = 2048;
	/** Installs how text is measured (the render worker uses Canvas2D). Text without an explicit size is sized by it. */
	function setTextMeasurer(m) {
		measurer = m;
		wrapCache.clear();
	}
	/**
	* Size of a text run with the installed measurer; without one (tests, static checks) an estimate of
	* 0.6 em per character, so layout code works the same everywhere.
	*/
	function measureText(p) {
		const full = {
			...BASE_DEFAULTS,
			fontFamily: "SF Pro Text",
			fontWeight: 400,
			color: "#ffffff",
			lineHeight: 1.2,
			align: "left",
			maxWidth: 0,
			...p
		};
		if (measurer) return measurer(full);
		const lines = full.text.split("\n");
		return {
			width: Math.max(...lines.map((l) => l.length)) * full.fontSize * .6,
			height: lines.length * full.fontSize * full.lineHeight
		};
	}
	/** Greedy word wrap: each `\n` line is broken at spaces so no line is wider than `maxWidth`; a lone long word keeps its own line. */
	function wrapText$1(p, m) {
		const key = JSON.stringify([
			p.text,
			p.fontFamily,
			p.fontSize,
			p.fontWeight,
			p.lineHeight,
			p.maxWidth
		]);
		const hit = wrapCache.get(key);
		if (hit !== void 0) return hit;
		const fits = (line) => m({
			...p,
			text: line
		}).width <= p.maxWidth;
		const out = [];
		for (const hard of p.text.split("\n")) {
			let line = "";
			for (const word of hard.split(" ").filter((w) => w !== "")) {
				const next = line ? `${line} ${word}` : word;
				if (line && !fits(next)) {
					out.push(line);
					line = word;
				} else line = next;
			}
			out.push(line);
		}
		const wrapped = out.join("\n");
		if (wrapCache.size >= WRAP_CACHE_LIMIT) wrapCache.clear();
		wrapCache.set(key, wrapped);
		return wrapped;
	}
	var TextNode = class extends Node {
		constructor(init) {
			super("text", {
				...BASE_DEFAULTS,
				text: "",
				fontFamily: "SF Pro Text",
				fontSize: 48,
				fontWeight: 400,
				color: "#ffffff",
				lineHeight: 1.2,
				align: "left",
				maxWidth: 0
			}, init);
		}
		propsAt(t) {
			const p = super.propsAt(t);
			if (!measurer) return p;
			if (p.maxWidth > 0) p.text = wrapText$1(p, measurer);
			if (p.width === 0 && p.height === 0) {
				const size = measurer(p);
				p.width = p.maxWidth > 0 ? p.maxWidth : size.width;
				p.height = size.height;
			}
			return p;
		}
	};
	var ImageNode = class extends Node {
		constructor(init) {
			super("image", {
				...BASE_DEFAULTS,
				src: "",
				fit: "fill"
			}, init);
		}
	};
	var VideoNode = class extends Node {
		constructor(init) {
			super("video", {
				...BASE_DEFAULTS,
				src: "",
				fit: "fill",
				startOffset: 0,
				speed: 1,
				loop: false,
				matte: false
			}, init);
		}
	};
	var CircleNode = class extends Node {
		constructor(init) {
			const r = init?.radius ?? 50;
			const diameter = r * 2;
			super("circle", {
				...BASE_DEFAULTS,
				width: diameter,
				height: diameter,
				radius: r,
				fill: "#ffffff",
				stroke: "",
				strokeWidth: 0
			}, {
				...init,
				width: init?.width ?? diameter,
				height: init?.height ?? diameter,
				radius: r
			});
		}
	};
	var PathNode = class extends Node {
		constructor(init) {
			const bounds = pathBounds(init.d, init.stroke ? init.strokeWidth ?? 0 : 0);
			super("path", {
				...BASE_DEFAULTS,
				d: "",
				fill: "#ffffff",
				stroke: "",
				strokeWidth: 0
			}, {
				...init,
				width: init.width ?? bounds.width,
				height: init.height ?? bounds.height
			});
		}
	};
	var ShaderNode = class extends Node {
		constructor(init) {
			super("shader", {
				...BASE_DEFAULTS,
				code: "",
				uniforms: {}
			}, init);
		}
	};
	const group = (init) => new GroupNode(init);
	const rect = (init) => new RectNode(init);
	const circle = (init) => new CircleNode(init);
	const path = (init) => new PathNode(init);
	const shader = (init) => new ShaderNode(init);
	const text = (init) => new TextNode(init);
	const image = (init) => new ImageNode(init);
	const video = (init) => new VideoNode(init);
	// ../../packages/runtime/src/audio/timing.ts
	const VO_REGISTRY = /* @__PURE__ */ new Map();
	function registerVoTiming(timing) {
		const key = timing.lineId || timing.line_id;
		if (key) VO_REGISTRY.set(key, timing);
	}
	function registerVoTimings(timings) {
		if (Array.isArray(timings)) timings.forEach(registerVoTiming);
		else if (timings && typeof timings === "object") Object.entries(timings).forEach(([k, v]) => registerVoTiming({
			...v,
			lineId: v.lineId || k
		}));
	}
	var VoHelper = class {
		lineId;
		timing;
		start = 0;
		end;
		constructor(lineId, timing) {
			this.lineId = lineId;
			this.timing = timing;
			this.end = timing?.duration ?? 0;
		}
		get isReady() {
			return !!(this.timing && (this.timing.duration > 0 || this.timing.words && this.timing.words.length > 0));
		}
		get duration() {
			return this.end;
		}
		/** Word timings (seconds from the start of the line); empty until the line has been generated. */
		get words() {
			return this.timing?.words ?? [];
		}
		wordTime(text) {
			if (!this.timing || !this.timing.words?.length) return;
			const target = text.trim().toLowerCase();
			const found = this.timing.words.find((w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target));
			return found ? found.start : void 0;
		}
		word(text) {
			if (!this.timing || !this.timing.words?.length) return {
				start: 0,
				end: 0
			};
			const target = text.trim().toLowerCase();
			const found = this.timing.words.find((w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target));
			if (found) return {
				start: found.start,
				end: found.end
			};
			return {
				start: 0,
				end: 0
			};
		}
	};
	const vo = (lineId, timing) => {
		return new VoHelper(lineId, timing ?? VO_REGISTRY.get(lineId) ?? globalThis.__liosVoTimings?.[lineId]);
	};
	// ../../packages/runtime/src/audio/narration.ts
	const VO_PAD = .35;
	const VO_GAP = .3;
	/** Stand-in length of a line that has no audio yet, so the scene can be previewed. */
	const VO_PLACEHOLDER = 2.5;
	/** Where each line of a scene starts, and how long the scene runs to hold them all. */
	function planVo(opts) {
		const lead = opts.lead ?? opts.pad ?? .35;
		const tail = opts.tail ?? opts.pad ?? .35;
		const gap = opts.gap ?? .3;
		let t = lead;
		return {
			cues: (opts.vo ?? []).map((id, i) => {
				const line = vo(id);
				const ready = line.isReady && line.duration > 0;
				if (i > 0) t += gap;
				const cue = {
					id,
					at: t,
					duration: ready ? line.duration : VO_PLACEHOLDER,
					ready
				};
				t += cue.duration;
				return cue;
			}),
			duration: t + tail
		};
	}
	const norm = (s) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
	/** The `cue(line)` and `word(line, wordOrIndex)` helpers of a scene's builder: scene-local seconds. */
	function sceneCues(sceneId, cues) {
		const find = (id) => {
			const cue = cues.find((c) => c.id === id);
			if (!cue) {
				const list = cues.length ? cues.map((c) => c.id).join(", ") : "none; add scene(id, { vo: [...] })";
				throw new Error(`cue(): VO line "${id}" is not narrated in scene "${sceneId}" (its lines: ${list})`);
			}
			return cue;
		};
		const cue = (id) => find(id).at;
		const word = (id, which) => {
			const c = find(id);
			const words = vo(id).words;
			if (!c.ready || !words.length) return c.at;
			if (typeof which === "number") {
				const w = words[which];
				if (!w) throw new Error(`word(): VO line "${id}" has no word ${which} (it has ${words.length})`);
				return c.at + w.start;
			}
			const target = norm(which);
			const w = words.find((x) => norm(x.word) === target) ?? words.find((x) => norm(x.word).startsWith(target));
			if (!w) throw new Error(`word(): no word "${which}" in VO line "${id}" (words: ${words.map((x) => x.word).join(", ")})`);
			return c.at + w.start;
		};
		return {
			cue,
			word
		};
	}
	// ../../packages/runtime/src/composition.ts
	/**
	* A scene. With `vo: [lineIds]` the lines are spoken back to back (`lead`/`gap`/`tail`, or `pad`) and
	* the duration follows the generated audio unless `duration` is given; the builder's `cue()` and
	* `word()` give scene-local times and the composition places the audio.
	*/
	function scene(id, opts, build) {
		const site = (/* @__PURE__ */ new Error()).stack;
		if (!opts.vo) return {
			id,
			duration: opts.duration,
			background: opts.background,
			transition: opts.transition,
			build,
			site
		};
		const plan = planVo(opts);
		return {
			id,
			duration: opts.duration ?? plan.duration,
			background: opts.background,
			transition: opts.transition,
			build,
			vo: plan.cues,
			site
		};
	}
	function composition(c) {
		return {
			...c,
			background: c.background ?? "#000000"
		};
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
			return {
				id: s.id,
				startFrame,
				endFrame: frame
			};
		});
		return {
			totalFrames: frame,
			scenes
		};
	}
	function clampFrame(c, frame) {
		const last = Math.max(layoutComposition(c).totalFrames - 1, 0);
		return Math.min(Math.max(Math.floor(frame), 0), last);
	}
	const instances = /* @__PURE__ */ new WeakMap();
	function instantiateScene(c, def) {
		let byDef = instances.get(c);
		if (!byDef) instances.set(c, byDef = /* @__PURE__ */ new WeakMap());
		let root = byDef.get(def);
		if (!root) {
			root = group({
				name: def.id,
				width: c.width,
				height: c.height
			});
			const { cue, word } = sceneCues(def.id, def.vo ?? []);
			def.build({
				root,
				width: c.width,
				height: c.height,
				duration: def.duration,
				random: seededRandom(def.id),
				cue,
				word
			});
			byDef.set(def, root);
		}
		return root;
	}
	// ../../packages/runtime/src/layout/grid.ts
	const GAPS = [
		1,
		2,
		3,
		4,
		6,
		8
	];
	const GRID = {
		landscape: {
			columns: 12,
			rows: 6
		},
		portrait: {
			columns: 4,
			rows: 12
		},
		square: {
			columns: 8,
			rows: 8
		}
	};
	const SLOTS = {
		landscape: {
			full: [
				1,
				12,
				1,
				6,
				"center"
			],
			title: [
				1,
				10,
				1,
				2,
				"left"
			],
			center: [
				2,
				10,
				3,
				3,
				"center"
			],
			body: [
				1,
				12,
				3,
				3,
				"left"
			],
			left: [
				1,
				6,
				3,
				3,
				"left"
			],
			right: [
				7,
				6,
				3,
				3,
				"left"
			],
			lowerThird: [
				1,
				7,
				5,
				2,
				"left"
			],
			caption: [
				2,
				10,
				6,
				1,
				"center"
			]
		},
		portrait: {
			full: [
				1,
				4,
				1,
				12,
				"center"
			],
			title: [
				1,
				4,
				1,
				3,
				"left"
			],
			center: [
				1,
				4,
				4,
				8,
				"center"
			],
			body: [
				1,
				4,
				4,
				8,
				"left"
			],
			left: [
				1,
				4,
				4,
				4,
				"left"
			],
			right: [
				1,
				4,
				8,
				4,
				"left"
			],
			lowerThird: [
				1,
				4,
				10,
				3,
				"left"
			],
			caption: [
				1,
				4,
				12,
				1,
				"center"
			]
		},
		square: {
			full: [
				1,
				8,
				1,
				8,
				"center"
			],
			title: [
				1,
				7,
				1,
				2,
				"left"
			],
			center: [
				1,
				8,
				3,
				5,
				"center"
			],
			body: [
				1,
				8,
				3,
				5,
				"left"
			],
			left: [
				1,
				4,
				3,
				5,
				"left"
			],
			right: [
				5,
				4,
				3,
				5,
				"left"
			],
			lowerThird: [
				1,
				6,
				7,
				2,
				"left"
			],
			caption: [
				1,
				8,
				8,
				1,
				"center"
			]
		}
	};
	function orientationOf(width, height) {
		const ratio = width / height;
		if (ratio > 1.15) return "landscape";
		if (ratio < .87) return "portrait";
		return "square";
	}
	/**
	* The layout grid for a frame size: safe area, columns/rows, spacing scale, named slots and a type scale.
	* Pass the scene's `{ width, height }`; the same calls give a correct layout in 16:9, 9:16 and 1:1.
	*/
	function layout({ width, height }) {
		const orientation = orientationOf(width, height);
		const u = Math.min(width, height) / 100;
		const edge = u * 6;
		const top = orientation === "portrait" ? Math.max(edge, height * .05) : edge;
		const bottom = orientation === "portrait" ? Math.max(edge, height * .12) : edge;
		const safe = {
			x: edge,
			y: top,
			width: width - edge * 2,
			height: height - top - bottom
		};
		const { columns, rows } = GRID[orientation];
		const gutter = u * 2;
		const colW = (safe.width - gutter * (columns - 1)) / columns;
		const rowH = (safe.height - gutter * (rows - 1)) / rows;
		const check = (what, count, start, span) => {
			if (!Number.isInteger(start) || !Number.isInteger(span) || start < 1 || span < 1 || start + span - 1 > count) throw new Error(`${what} ${start}–${start + span - 1} do not fit the ${count}-${what.slice(0, -1)} ${orientation} grid`);
		};
		const col = (start, span = 1) => {
			check("columns", columns, start, span);
			return {
				x: safe.x + (start - 1) * (colW + gutter),
				width: span * colW + (span - 1) * gutter
			};
		};
		const row = (start, span = 1) => {
			check("rows", rows, start, span);
			return {
				y: safe.y + (start - 1) * (rowH + gutter),
				height: span * rowH + (span - 1) * gutter
			};
		};
		const cell = (colStart, colSpan, rowStart, rowSpan) => {
			const c = col(colStart, colSpan);
			const r = row(rowStart, rowSpan);
			return {
				x: c.x,
				y: r.y,
				width: c.width,
				height: r.height
			};
		};
		const gap = (n) => {
			if (!GAPS.includes(n)) throw new Error(`gap(${n}): use one of 1, 2, 3, 4, 6, 8`);
			return u * n;
		};
		const slots = SLOTS[orientation];
		const slot = (name) => {
			const def = slots[name];
			if (!def) throw new Error(`Unknown slot "${name}". Slots: ${Object.keys(slots).join(", ")}`);
			const [c, cs, r, rs, align] = def;
			return {
				...cell(c, cs, r, rs),
				align
			};
		};
		const t = orientation === "portrait" ? 1.25 : 1;
		const style = (size, lineHeight, fontWeight) => ({
			fontSize: Math.round(u * size * t * 10) / 10,
			lineHeight,
			fontWeight
		});
		const type = {
			display: style(9, 1.1, 800),
			h1: style(6.5, 1.15, 700),
			h2: style(4.5, 1.2, 700),
			body: style(3.2, 1.45, 400),
			caption: style(2.6, 1.4, 500),
			label: style(2, 1.3, 600)
		};
		return {
			width,
			height,
			orientation,
			u,
			safe,
			columns,
			rows,
			gutter,
			col,
			row,
			cell,
			gap,
			slot,
			slotNames: Object.keys(slots),
			type
		};
	}
	// ../../packages/runtime/src/layout/stack.ts
	const factor = (a) => a === "center" ? .5 : a === "end" || a === "right" ? 1 : 0;
	const textAlign = (a) => a === "center" ? "center" : a === "end" || a === "right" ? "right" : "left";
	/**
	* Lays children out in a box and returns a group at the box's position holding them.
	* Sizes are read once, when the scene is built: text is measured (and, in a column, wrapped to the box
	* width with the stack's alignment); other nodes need an explicit width/height. Animate opacity/scale on
	* the children freely; animating their x/y replaces the stacked position.
	*/
	function stack(box, children, opts) {
		const direction = opts.direction ?? "column";
		const align = opts.align ?? box.align;
		const k = factor(align);
		const g = new GroupNode({
			name: opts.name ?? "stack",
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height
		});
		if (direction === "column") {
			for (const c of children) if (c instanceof TextNode) {
				const p = c.propsAt(0);
				c.assign({
					maxWidth: p.maxWidth || box.width,
					align: textAlign(align)
				});
			}
		}
		const sizes = children.map((c) => {
			const p = c.propsAt(0);
			return {
				w: p.width,
				h: p.height,
				ax: p.anchorX,
				ay: p.anchorY
			};
		});
		const main = (s) => direction === "column" ? s.h : s.w;
		const total = sizes.reduce((sum, s) => sum + main(s), 0) + opts.gap * Math.max(0, children.length - 1);
		let cursor = ((direction === "column" ? box.height : box.width) - total) * factor(opts.justify);
		children.forEach((c, i) => {
			const s = sizes[i];
			const cross = direction === "column" ? (box.width - s.w) * k : (box.height - s.h) * k;
			const [x, y] = direction === "column" ? [cross, cursor] : [cursor, cross];
			c.assign({
				x: x + s.ax * s.w,
				y: y + s.ay * s.h
			});
			cursor += main(s) + opts.gap;
			g.add(c);
		});
		return g;
	}
	// ../../packages/runtime/src/evaluate.ts
	/** The node's filters, or undefined when none is on. */
	function activeFilters(p, t = 0) {
		if (!(p.pixelate > 0 || p.posterize > 0 || p.halftone > 0 || p.outline > 0 || p.chalk > 0 || p.glow > 0 || p.sticker > 0)) return void 0;
		const { pixelate, posterize, halftone, outline, outlineColor, chalk, glow, glowIntensity, glowThreshold } = p;
		const { sticker, stickerColor, stickerGap, stickerWobble } = p;
		return {
			pixelate,
			posterize,
			halftone,
			outline,
			outlineColor,
			chalk,
			glow,
			glowIntensity,
			glowThreshold,
			sticker,
			stickerColor,
			stickerGap,
			stickerWobble,
			stickerSeed: p.stickerBoil > 0 ? Math.floor(t * p.stickerBoil + 1e-6) : 0
		};
	}
	/** The node's own drawable (groups have none), with opacity already multiplied in. */
	function drawable(node, t, matrix, opacity, duration) {
		const path = node.path();
		if (node instanceof RectNode) {
			const p = node.propsAt(t);
			return {
				kind: "rect",
				path,
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
				path,
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
				path,
				matrix,
				d: p.d,
				bounds: pathBounds(p.d, p.stroke ? p.strokeWidth : 0),
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
				path,
				matrix,
				code: p.code,
				width: p.width,
				height: p.height,
				uniforms: p.uniforms,
				opacity,
				time: t,
				progress: t / Math.max(.001, duration)
			};
		}
		if (node instanceof TextNode) {
			const p = node.propsAt(t);
			return {
				kind: "text",
				path,
				matrix,
				text: p.text,
				fontFamily: p.fontFamily,
				fontSize: p.fontSize,
				fontWeight: p.fontWeight,
				color: p.color,
				lineHeight: p.lineHeight,
				opacity,
				align: p.align,
				boxWidth: p.width
			};
		}
		if (node instanceof ImageNode) {
			const p = node.propsAt(t);
			return {
				kind: "image",
				path,
				matrix,
				src: p.src,
				width: p.width,
				height: p.height,
				fit: p.fit,
				opacity
			};
		}
		if (node instanceof VideoNode) {
			const p = node.propsAt(t);
			const time = t * p.speed + p.startOffset;
			const src = videoFile(p);
			return {
				kind: "video",
				path,
				matrix,
				src,
				time,
				width: p.width,
				height: p.height,
				fit: p.fit,
				opacity,
				...src !== p.src ? { matte: { source: p.src } } : {}
			};
		}
		if (node instanceof ThreeNode) {
			const p = node.propsAt(t);
			return {
				kind: "three",
				path,
				matrix,
				width: p.width,
				height: p.height,
				opacity,
				time: t,
				duration
			};
		}
	}
	function sortedChildren(node, t) {
		return node.children.map((child, i) => ({
			child,
			i,
			z: child.propsAt(t).z
		})).sort((a, b) => a.z - b.z || a.i - b.i).map((e) => e.child);
	}
	/** Emits items for `node` into `out`. `inherited` is the ancestors' opacity not yet absorbed by a layer. */
	function emit(node, t, duration, parent, inherited, out) {
		const p = node.propsAt(t);
		const opacity = inherited * p.opacity;
		if (opacity <= 0) return;
		const matrix = multiply(parent, node.localMatrix(t));
		const filters = activeFilters(p, t);
		const isolated = p.blur > 0 || p.clip || filters !== void 0 || p.opacity < 1 && node.children.length > 0;
		const childOpacity = isolated ? 1 : opacity;
		const target = isolated ? [] : out;
		const own = drawable(node, t, matrix, childOpacity, duration);
		if (own) target.push(own);
		for (const child of sortedChildren(node, t)) emit(child, t, duration, matrix, childOpacity, target);
		if (isolated) out.push({
			kind: "layer",
			path: node.path(),
			items: target,
			opacity,
			blur: p.blur,
			...filters ? { filters } : {},
			...p.clip ? { clip: {
				matrix,
				width: p.width,
				height: p.height,
				radius: p.radius
			} } : {}
		});
	}
	function imageSrcs(items, into) {
		for (const item of items) if (item.kind === "image" || item.kind === "video") into.add(item.src);
		else if (item.kind === "layer") imageSrcs(item.items, into);
		return into;
	}
	function evaluateFrame(c, frame) {
		const f = clampFrame(c, frame);
		const { scenes } = layoutComposition(c);
		const index = scenes.findIndex((s) => f >= s.startFrame && f < s.endFrame);
		if (index < 0) return {
			width: c.width,
			height: c.height,
			background: c.background,
			items: [],
			assets: []
		};
		const def = c.scenes[index];
		const t = (f - scenes[index].startFrame) / c.fps;
		const items = [];
		const root = instantiateScene(c, def);
		if (def.transition) {
			const progress = t / Math.max(.001, def.transition.duration);
			applyTransition(root, def.transition, progress, c.width, c.height);
		}
		emit(root, t, def.duration, [
			1,
			0,
			0,
			1,
			0,
			0
		], 1, items);
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
			if (node instanceof ImageNode) srcs.add(node.propsAt(0).src);
			else if (node instanceof VideoNode) srcs.add(videoFile(node.propsAt(0)));
			node.children.forEach(walk);
		};
		for (const def of c.scenes) walk(instantiateScene(c, def));
		return [...srcs].sort();
	}
	// ../../packages/runtime/src/manifest.ts
	function describe(node, scene, fps) {
		const clamp = (f) => Math.min(Math.max(f, scene.startFrame), scene.endFrame);
		return {
			path: node.path(),
			name: node.name,
			kind: node.kind,
			spans: node.spans().map((s) => ({
				startFrame: clamp(scene.startFrame + Math.round(s.start * fps)),
				endFrame: clamp(scene.startFrame + Math.round(s.end * fps))
			})),
			children: node.children.map((c) => describe(c, scene, fps))
		};
	}
	/** The timeline view of a composition: scenes, their object trees, and when each object animates. */
	function buildManifest(c) {
		const { totalFrames, scenes } = layoutComposition(c);
		const audioTracks = c.audio?.map((track) => {
			const clipsList = Array.isArray(track.clips) ? track.clips : track.src ? [{
				src: track.src,
				startFrame: track.startFrame ?? Math.round((track.startAt ?? 0) * c.fps),
				duration: track.duration,
				startOffset: track.startOffset,
				volume: track.volume,
				ducking: track.ducking,
				role: track.role
			}] : [];
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
						ducking: clip.ducking,
						role: clip.role ?? track.role,
						...clip.fadeIn !== void 0 ? { fadeIn: clip.fadeIn } : {},
						...clip.fadeOut !== void 0 ? { fadeOut: clip.fadeOut } : {}
					};
				})
			};
		});
		const narration = narrationTracks(c, scenes, audioTracks ?? []);
		const effects = sfxTracks(c, scenes, totalFrames);
		const added = [...narration, ...effects];
		const tracks = audioTracks || added.length ? [...audioTracks ?? [], ...added] : void 0;
		return {
			width: c.width,
			height: c.height,
			fps: c.fps,
			totalFrames,
			scenes: scenes.map((span, i) => ({
				...span,
				tree: describe(instantiateScene(c, c.scenes[i]), span, c.fps),
				site: c.scenes[i].site
			})),
			...tracks ? { audioTracks: tracks } : {},
			...c.mix ? { mix: c.mix } : {}
		};
	}
	/** Audio for the VO lines of `scene({ vo })` scenes that the composition does not already list. */
	function narrationTracks(c, scenes, listed) {
		if (c.narration === false) return [];
		const volume = c.narration?.volume;
		const have = new Set(listed.flatMap((t) => t.clips.map((clip) => clip.src.replace(/^\.\//, ""))));
		const out = [];
		c.scenes.forEach((def, i) => {
			for (const line of def.vo ?? []) {
				const src = `assets/audio/vo/${line.id}.mp3`;
				if (!line.ready || have.has(src)) continue;
				const startFrame = scenes[i].startFrame + Math.round(line.at * c.fps);
				out.push({
					id: `vo-${line.id}`,
					name: `VO ${line.id}`,
					clips: [{
						src,
						startFrame,
						endFrame: startFrame + Math.round(line.duration * c.fps),
						duration: line.duration,
						role: "vo",
						...volume !== void 0 ? { volume } : {}
					}]
				});
			}
		});
		return out;
	}
	/** Sound effects of the scenes' moves (`sfx` on `to()` and on camera paths), in tree order. */
	function sfxTracks(c, scenes, totalFrames) {
		if (c.sfx === false) return [];
		const out = [];
		c.scenes.forEach((def, i) => {
			const cues = [];
			const walk = (node) => {
				cues.push(...node.sfxCues());
				if (node instanceof ThreeNode) cues.push(...node.propsAt(0).cameraPath?.sfx ?? []);
				node.children.forEach(walk);
			};
			walk(instantiateScene(c, def));
			cues.forEach((cue, n) => {
				const clip = resolveSfx(cue, c.sfx || void 0);
				const startFrame = scenes[i].startFrame + Math.round(cue.at * c.fps);
				out.push({
					id: `sfx-${def.id}-${n + 1}-${cue.name.replace(/[^\w-]+/g, "_")}`,
					name: `SFX ${cue.name}`,
					clips: [{
						src: clip.src,
						startFrame,
						endFrame: clip.duration !== void 0 ? startFrame + Math.round(clip.duration * c.fps) : Math.max(startFrame + 1, totalFrames),
						...clip.duration !== void 0 ? { duration: clip.duration } : {},
						volume: clip.volume,
						role: "sfx",
						fadeIn: clip.fadeIn,
						fadeOut: clip.fadeOut
					}]
				});
			});
		});
		return out;
	}
	// ../../packages/runtime/src/three/assets.ts
	let loaders;
	/** Called by the host that renders three() nodes. */
	function registerThreeLoaders(impl) {
		loaders = impl;
	}
	function need(name, awaited = true) {
		if (!loaders) throw new Error(`${name}() works inside three({ setup })${awaited ? ": make setup async and await it there" : ""}`);
		return loaders;
	}
	/** Loads a .glb / .gltf from the project (meshes, PBR materials, textures); parts by name via `model.part()`. */
	async function gltf(src) {
		return need("gltf").gltf(src);
	}
	/** Loads a Radiance .hdr as an equirectangular environment: `scene.environment = await hdr(...)`. */
	async function hdr(src) {
		return need("hdr").hdr(src);
	}
	/** Loads an image from the project as a texture (`map`, `normalMap`, `roughnessMap`, …). */
	async function texture(src, opts) {
		return need("texture").texture(src, opts);
	}
	/**
	* Seeded, camera-facing glowing particles (dust, sparks, embers); call inside three({ setup }), add
	* `.object` to the scene and call `.update(time, camera)` from update(). Same field every render.
	*/
	function particles(opts) {
		return need("particles", false).particles(opts);
	}
	/**
	* A soft shadow on the floor under `object`, darkest where it touches (call inside three({ setup }),
	* after placing the object). Add `.mesh` to the scene; call `.update()` from update() if the object moves.
	*/
	function contactShadow(object, opts) {
		return need("contactShadow", false).contactShadow(object, opts);
	}
	// ../../packages/runtime/src/three/camera_path.ts
	const SPLINES = ["catmull", "linear"];
	function fromSampler(sample, sfx = []) {
		return {
			sfx,
			sample,
			apply(camera, time) {
				const pose = sample(time);
				camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
				camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
				const persp = camera;
				if (pose.fov !== void 0 && persp.isPerspectiveCamera) {
					persp.fov = pose.fov;
					persp.updateProjectionMatrix();
				}
				camera.updateMatrixWorld();
			}
		};
	}
	const lerp = (a, b, t) => a + (b - a) * t;
	const lerp3 = (a, b, t) => [
		lerp(a[0], b[0], t),
		lerp(a[1], b[1], t),
		lerp(a[2], b[2], t)
	];
	function catmull(p0, p1, p2, p3, t) {
		const t2 = t * t;
		const t3 = t2 * t;
		return .5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
	}
	const catmull3 = (a, b, c, d, t) => [
		catmull(a[0], b[0], c[0], d[0], t),
		catmull(a[1], b[1], c[1], d[1], t),
		catmull(a[2], b[2], c[2], d[2], t)
	];
	/**
	* A keyframed camera move through `keys` (sorted by `at`). Before the first key and after the last
	* the camera holds still. Pass it to `three({ cameraPath })`, or call `path.apply(camera, time)` in `update`.
	*/
	function cameraPath(keys, options = {}) {
		if (!keys.length) throw new Error("cameraPath() needs at least one key");
		const spline = options.spline ?? "catmull";
		if (!SPLINES.includes(spline)) throw new Error(`Unknown spline ${JSON.stringify(spline)}. Use one of: ${SPLINES.join(", ")}`);
		const easing = options.ease ?? "inOutCubic";
		ease(easing, .5);
		const sorted = keys.map((k, i) => ({
			k,
			i
		})).sort((a, b) => a.k.at - b.k.at || a.i - b.i).map((e) => e.k);
		const firstFov = sorted.find((k) => k.fov !== void 0)?.fov;
		let target = [
			0,
			0,
			0
		];
		let fov = firstFov;
		const filled = sorted.map((k) => {
			target = k.target ? [...k.target] : target;
			fov = k.fov ?? fov;
			return {
				at: k.at,
				position: [...k.position],
				target,
				fov
			};
		});
		const last = filled.length - 1;
		return fromSampler((time) => {
			if (time <= filled[0].at || last === 0) return pose(filled[0]);
			if (time >= filled[last].at) return pose(filled[last]);
			let i = 0;
			while (time >= filled[i + 1].at) i++;
			const a = filled[i];
			const b = filled[i + 1];
			const u = ease(easing, (time - a.at) / (b.at - a.at));
			const fovAt = a.fov === void 0 || b.fov === void 0 ? a.fov : lerp(a.fov, b.fov, u);
			if (spline === "linear") return {
				position: lerp3(a.position, b.position, u),
				target: lerp3(a.target, b.target, u),
				fov: fovAt
			};
			const p = filled[Math.max(0, i - 1)];
			const n = filled[Math.min(last, i + 2)];
			return {
				position: catmull3(p.position, a.position, b.position, n.position, u),
				target: catmull3(p.target, a.target, b.target, n.target, u),
				fov: fovAt
			};
		}, sorted.flatMap((k, i) => k.sfx === void 0 ? [] : [sfxCue(k.sfx, k.at, sorted[Math.min(i + 1, last)].at, `cameraPath key at ${k.at}s`)]));
	}
	function pose(k) {
		return {
			position: [...k.position],
			target: [...k.target],
			fov: k.fov
		};
	}
	const fovAt = (fov, u) => Array.isArray(fov) ? lerp(fov[0], fov[1], u) : fov;
	const spanCues = (o, what) => o.sfx === void 0 ? [] : [sfxCue(o.sfx, o.start, o.end, what)];
	function spanProgress({ start, end, ease: e = "inOutCubic" }) {
		ease(e, .5);
		return (time) => ease(e, end > start ? (time - start) / (end - start) : time >= end ? 1 : 0);
	}
	/**
	* Circles `target` at `radius`, from angle `from` to `to` (radians, 0 = +z, π/2 = +x), at camera
	* height `height` (world y), or rising / sinking with `height: [from, to]`.
	*/
	function orbit(o) {
		const progress = spanProgress(o);
		const height = o.height ?? o.target[1];
		return fromSampler((time) => {
			const u = progress(time);
			const a = lerp(o.from, o.to, u);
			const y = Array.isArray(height) ? lerp(height[0], height[1], u) : height;
			return {
				position: [
					o.target[0] + o.radius * Math.sin(a),
					y,
					o.target[2] + o.radius * Math.cos(a)
				],
				target: [...o.target],
				fov: fovAt(o.fov, u)
			};
		}, spanCues(o, "orbit()"));
	}
	/** Slides the camera in a straight line from `from` to `to`, aimed at `target` the whole way. */
	function dolly(o) {
		const progress = spanProgress(o);
		return fromSampler((time) => {
			const u = progress(time);
			return {
				position: lerp3(o.from, o.to, u),
				target: [...o.target],
				fov: fovAt(o.fov, u)
			};
		}, spanCues(o, "dolly()"));
	}
	/** Moves the camera `amount` (0–1) of the way from `from` towards `target`; pair with `fov: [a, b]` for a push-in zoom. */
	function pushIn(o) {
		return dolly({
			...o,
			to: lerp3(o.from, o.target, o.amount ?? .3)
		});
	}
	// ../../packages/runtime/src/audio/mix.ts
	const DEFAULT_MIX = Object.freeze({
		loudness: -14,
		ceiling: -1,
		duck: Object.freeze({
			amount: 12,
			attack: .15,
			release: .4
		})
	});
	/** Clips at least this long count as a music bed and duck by default. */
	const BED_MIN_SECONDS = 8;
	function resolveMix(mix) {
		const duck = mix?.duck === false ? false : {
			...DEFAULT_MIX.duck,
			...mix?.duck ?? {}
		};
		return {
			loudness: mix?.loudness === void 0 ? DEFAULT_MIX.loudness : mix.loudness,
			ceiling: mix?.ceiling ?? DEFAULT_MIX.ceiling,
			duck
		};
	}
	function isVoice(clip) {
		return clip.role === "vo" || /(^|\/)vo\//.test(clip.src);
	}
	/** A file named `sfx` (or in an `sfx/` folder) is an effects track. */
	function isSfxName(src) {
		return /(^|[\/._-])sfx([\/._-]|$)/i.test(src);
	}
	/** Whether a clip that plays for `playedSeconds` should dip under voice-over. */
	function shouldDuck(clip, playedSeconds) {
		if (isVoice(clip)) return false;
		if (clip.ducking === true || clip.role === "music") return true;
		if (clip.ducking === false || clip.role === "sfx" || !clip.role && isSfxName(clip.src)) return false;
		return playedSeconds >= 8;
	}
	/** Turns voice-over spans `[start, end]` (seconds) into a gain envelope. */
	function duckPlan(spans, duck) {
		if (!duck || !spans.length) return [];
		const low = 10 ** (-Math.abs(duck.amount) / 20);
		const sorted = spans.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
		const merged = [];
		for (const [s, e] of sorted) {
			const last = merged[merged.length - 1];
			if (last && s - last[1] < duck.attack + duck.release) last[1] = Math.max(last[1], e);
			else merged.push([s, e]);
		}
		const plan = [];
		for (const [s, e] of merged) plan.push([s - duck.attack, 1], [s, low], [e, low], [e + duck.release, 1]);
		return plan;
	}
	function duckGainAt(plan, t) {
		if (!plan.length || t <= plan[0][0] || t >= plan[plan.length - 1][0]) return 1;
		let lo = 0;
		let hi = plan.length - 1;
		while (hi - lo > 1) {
			const mid = lo + hi >> 1;
			if (plan[mid][0] <= t) lo = mid;
			else hi = mid;
		}
		const [t0, g0] = plan[lo];
		const [t1, g1] = plan[hi];
		return t1 === t0 ? g1 : g0 + (g1 - g0) * (t - t0) / (t1 - t0);
	}
	/**
	* Breakpoints [t, gain] (timeline seconds) of a clip's fade in from silence and out to silence,
	* for a clip that starts at `start` and plays `played` seconds; empty without fades.
	*/
	function fadePlan(start, played, fadeIn = 0, fadeOut = 0) {
		const plan = [];
		if (fadeIn > 0 && played > 0) plan.push([start, 0], [start + Math.min(fadeIn, played), 1]);
		if (fadeOut > 0 && played > 0) {
			const end = start + played;
			plan.push([Math.max(start, end - fadeOut), 1], [end, 0]);
		}
		return plan.sort((a, b) => a[0] - b[0]);
	}
	/** Gain of a fade plan at timeline time `t`: held at the first / last value outside it, 1 without fades. */
	function fadeGainAt(plan, t) {
		if (!plan.length) return 1;
		if (t <= plan[0][0]) return plan[0][1];
		const last = plan[plan.length - 1];
		if (t >= last[0]) return last[1];
		let i = 1;
		while (plan[i][0] < t) i++;
		const [t0, g0] = plan[i - 1];
		const [t1, g1] = plan[i];
		return t1 === t0 ? g1 : g0 + (g1 - g0) * (t - t0) / (t1 - t0);
	}
	/**
	* The duck envelope for a set of clips and which clips follow it. No voice-over
	* means no ducking at all, so beds stay at their written volume.
	*/
	function duckSchedule(clips, duck) {
		const plan = duckPlan(clips.filter(isVoice).map((c) => [c.start, c.start + c.played]), duck);
		return {
			plan,
			ducked: clips.map((c) => plan.length > 0 && shouldDuck(c, c.played))
		};
	}
	function kWeighting(sampleRate) {
		let f0 = 1681.974450955533;
		const G = 3.999843853973347;
		let Q = .7071752369554196;
		let K = Math.tan(Math.PI * f0 / sampleRate);
		const Vh = 10 ** (G / 20);
		const Vb = Vh ** .4996667741545416;
		let a0 = 1 + K / Q + K * K;
		const shelf = [
			(Vh + Vb * K / Q + K * K) / a0,
			2 * (K * K - Vh) / a0,
			(Vh - Vb * K / Q + K * K) / a0,
			2 * (K * K - 1) / a0,
			(1 - K / Q + K * K) / a0
		];
		f0 = 38.13547087602444;
		Q = .5003270373238773;
		K = Math.tan(Math.PI * f0 / sampleRate);
		a0 = 1 + K / Q + K * K;
		return [shelf, [
			1,
			-2,
			1,
			2 * (K * K - 1) / a0,
			(1 - K / Q + K * K) / a0
		]];
	}
	const ABSOLUTE_GATE = -70;
	const RELATIVE_GATE = -10;
	/** Integrated loudness (LUFS) of planar channels; -Infinity for silence. */
	function measureLoudness(channels, sampleRate) {
		const length = channels[0]?.length ?? 0;
		const step = Math.round(sampleRate * .1);
		const segments = Math.floor(length / step);
		if (segments < 4) return -Infinity;
		const energy = new Float64Array(segments);
		const [s, h] = kWeighting(sampleRate);
		for (const x of channels) {
			let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
			for (let seg = 0; seg < segments; seg++) {
				let acc = 0;
				const end = (seg + 1) * step;
				for (let i = seg * step; i < end; i++) {
					const xi = x[i];
					const y = s[0] * xi + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
					x2 = x1;
					x1 = xi;
					const z = h[0] * y + h[1] * y1 + h[2] * y2 - h[3] * z1 - h[4] * z2;
					y2 = y1;
					y1 = y;
					z2 = z1;
					z1 = z;
					acc += z * z;
				}
				energy[seg] += acc;
			}
		}
		return gatedLoudness(energy, step);
	}
	function gatedLoudness(energy, step) {
		const blocks = [];
		for (let j = 0; j + 4 <= energy.length; j++) blocks.push((energy[j] + energy[j + 1] + energy[j + 2] + energy[j + 3]) / (4 * step));
		const lufs = (z) => -.691 + 10 * Math.log10(z);
		const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const abs = blocks.filter((z) => z > 0 && lufs(z) > ABSOLUTE_GATE);
		if (!abs.length) return -Infinity;
		const relative = lufs(mean(abs)) + RELATIVE_GATE;
		return lufs(mean(abs.filter((z) => lufs(z) > relative)));
	}
	const LIMITER_LOOKAHEAD = .005;
	const LIMITER_RELEASE = .08;
	function peak(channels) {
		let p = 0;
		for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
		return p;
	}
	/**
	* Look-ahead peak limiter, in place. The gain needed at each sample is held
	* over the look-ahead window and averaged over it, so it eases down before a
	* peak; it then recovers linearly over the release time. No output sample
	* exceeds the ceiling.
	*/
	function limit(channels, sampleRate, ceilingDb) {
		const ceiling = 10 ** (ceilingDb / 20);
		if (peak(channels) <= ceiling) return;
		const n = channels[0].length;
		const L = Math.max(1, Math.round(sampleRate * LIMITER_LOOKAHEAD));
		const req = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			let m = 0;
			for (const c of channels) m = Math.max(m, Math.abs(c[i]));
			req[i] = m > ceiling ? ceiling / m : 1;
		}
		const held = new Float32Array(n);
		const dq = new Int32Array(n);
		let head = 0, tail = 0;
		for (let i = n - 1; i >= 0; i--) {
			while (tail > head && req[dq[tail - 1]] >= req[i]) tail--;
			dq[tail++] = i;
			while (dq[head] > i + L - 1) head++;
			held[i] = req[dq[head]];
		}
		const inc = 1 / Math.max(1, Math.round(sampleRate * LIMITER_RELEASE));
		let sum = 0;
		let g = 1;
		for (let i = 0; i < n; i++) {
			sum += held[i] - (i >= L ? held[i - L] : 1);
			const avg = (sum + L) / L;
			g = Math.min(avg, g + inc, req[i]);
			for (const c of channels) c[i] *= g;
		}
	}
	/** Normalises to the target loudness and limits, in place. */
	function master(channels, sampleRate, mix) {
		const measured = measureLoudness(channels, sampleRate);
		let gain = 0;
		if (mix.loudness !== false && Number.isFinite(measured)) {
			gain = mix.loudness - measured;
			const k = 10 ** (gain / 20);
			for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= k;
		}
		limit(channels, sampleRate, mix.ceiling);
		const p = peak(channels);
		return {
			measured,
			gain,
			final: measureLoudness(channels, sampleRate),
			peak: p > 0 ? 20 * Math.log10(p) : -Infinity
		};
	}
	// ../../packages/runtime/src/components/captions.ts
	const PRESETS = {
		short: {
			fontWeight: 800,
			maxWords: 6
		},
		long: {
			fontWeight: 700,
			maxWords: 9
		}
	};
	const ACTIVE_SCALE = 1.06;
	/**
	* Karaoke captions from VO word timings, placed in `layout().slot("caption")` (above the platform UI
	* in 9:16). Chunks break at sentence punctuation, at the measured line width and after two lines; the
	* spoken word lights up. Returns the caption layer (one child group per chunk).
	*/
	function captions(root, opts) {
		const { width, height } = root.propsAt(0);
		if (!(width > 0 && height > 0)) throw new Error("captions(): add them to the scene root (it needs a width and height)");
		const L = layout({
			width,
			height
		});
		const preset = PRESETS[opts.preset ?? (L.orientation === "portrait" ? "short" : "long")];
		const slot = L.slot("caption");
		const pad = opts.background ? L.gap(2) : 0;
		const lineHeight = 1.25;
		const fontFamily = opts.fontFamily ?? "SF Pro Text";
		const fontWeight = opts.fontWeight ?? preset.fontWeight;
		const color = opts.color ?? "#ffffff";
		const activeColor = opts.activeColor ?? "#ffd60a";
		const maxWords = opts.maxWords ?? preset.maxWords;
		const hold = opts.hold ?? .35;
		const maxLine = (slot.width - pad * 2) / ACTIVE_SCALE;
		const timed = resolveLines(opts);
		let fontSize = opts.fontSize ?? L.type.h2.fontSize;
		const measure = (text, size = fontSize) => measureText({
			text,
			fontSize: size,
			fontFamily,
			fontWeight,
			lineHeight
		}).width;
		const widest = Math.max(0, ...timed.flatMap((l) => l.words.map((w) => measure(w.word.trim()))));
		if (widest > maxLine) fontSize *= maxLine / widest;
		const space = Math.max(measure("a a") - measure("aa"), fontSize * .25);
		const chunks = [];
		for (const line of timed) {
			let chunk = null;
			let count = 0;
			const flush = () => {
				if (chunk && count) chunks.push(chunk);
				chunk = null;
				count = 0;
			};
			for (const w of line.words) {
				const text = w.word.trim();
				if (!text) continue;
				const word = {
					text,
					start: line.at + w.start,
					end: line.at + w.end,
					width: measure(text)
				};
				if (!chunk) chunk = {
					lines: [[]],
					start: word.start,
					end: word.end
				};
				const c = chunk;
				const row = c.lines[c.lines.length - 1];
				const rowWidth = row.reduce((s, x) => s + x.width, 0) + space * row.length;
				if (row.length && rowWidth + word.width > maxLine) {
					if (c.lines.length === 2) {
						flush();
						chunk = {
							lines: [[word]],
							start: word.start,
							end: word.end
						};
						count = 1;
						continue;
					}
					c.lines.push([word]);
				} else row.push(word);
				c.end = word.end;
				count++;
				if (/[.?!…]["')\]]?$/.test(text) || /[,;:]$/.test(text) && count >= 3 || count >= maxWords) flush();
			}
			flush();
		}
		chunks.sort((a, b) => a.start - b.start);
		const name = (opts.name ?? "captions").replaceAll("/", "-");
		const layer = root.add(new GroupNode({ name }));
		const rowH = fontSize * lineHeight;
		chunks.forEach((chunk, i) => {
			const show = Math.max(0, chunk.start - .04);
			const next = chunks[i + 1];
			const hide = Math.min(chunk.end + hold, next ? next.start - .04 : Infinity);
			const g = layer.add(new GroupNode({
				name: `chunk${i}`,
				opacity: 0
			}));
			g.set({ opacity: 1 }, show).set({ opacity: 0 }, hide);
			const blockH = chunk.lines.length * rowH;
			const top = slot.y + slot.height - blockH - pad / 2;
			const cx = slot.x + slot.width / 2;
			const rowWidths = chunk.lines.map((r) => r.reduce((s, x) => s + x.width, 0) + space * (r.length - 1));
			if (opts.background) {
				const w = Math.max(...rowWidths) * ACTIVE_SCALE + pad * 2;
				g.add(new RectNode({
					name: "pill",
					x: cx - w / 2,
					y: top - pad / 2,
					width: w,
					height: blockH + pad,
					radius: pad,
					fill: opts.background
				}));
			}
			chunk.lines.forEach((row, r) => {
				let x = cx - rowWidths[r] / 2;
				for (const word of row) {
					const t = g.add(new TextNode({
						name: `w${g.children.length}`,
						text: word.text,
						fontFamily,
						fontSize,
						fontWeight,
						lineHeight,
						color,
						x: x + word.width / 2,
						y: top + r * rowH + rowH / 2,
						width: word.width,
						height: rowH,
						anchorX: .5,
						anchorY: .5
					}));
					const grow = Math.min(ACTIVE_SCALE, 1 + space * .9 / Math.max(word.width, 1));
					t.set({ color: activeColor }, word.start).set({ color }, word.end);
					t.to({
						scaleX: grow,
						scaleY: grow
					}, {
						at: word.start,
						duration: .08,
						ease: "outCubic"
					});
					t.to({
						scaleX: 1,
						scaleY: 1
					}, {
						at: word.end,
						duration: .12,
						ease: "outCubic"
					});
					x += word.width + space;
				}
			});
		});
		return layer;
	}
	function resolveLines(opts) {
		let cursor = opts.start ?? 0;
		const gap = opts.gap ?? .3;
		return opts.lines.map((line) => {
			let words;
			let duration;
			let at;
			if (typeof line !== "string" && "words" in line) {
				words = line.words;
				duration = Math.max(0, ...words.map((w) => w.end));
				at = line.at;
			} else {
				const id = typeof line === "string" ? line : line.id;
				at = typeof line === "string" ? void 0 : line.at;
				const v = vo(id);
				if (!v.words.length) throw new Error(`captions(): no word timing for VO line "${id}". Generate it with tts_generate (or record it in the app) first.`);
				words = v.words;
				duration = v.duration || Math.max(...words.map((w) => w.end));
			}
			const start = at ?? cursor;
			cursor = start + duration + gap;
			return {
				at: start,
				words
			};
		});
	}
	// ../../packages/runtime/src/components/credit.ts
	const LABELS = {
		en: {
			source: "Source",
			photo: "Photo",
			music: "Music",
			sound: "Sound",
			ai: "AI illustration"
		},
		id: {
			source: "Sumber",
			photo: "Foto",
			music: "Musik",
			sound: "Suara",
			ai: "Ilustrasi AI"
		}
	};
	const AUDIO = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i;
	/** Which label an asset's credit takes, from its folder and extension. */
	function assetLabel(asset) {
		const path = asset.replace(/^\.\//, "");
		if (/(^|\/)audio\/music\//i.test(path)) return "music";
		if (/(^|\/)audio\//i.test(path) || AUDIO.test(path)) return "sound";
		return "photo";
	}
	/** "https://www.unsplash.com/photos/x" -> "unsplash.com"; anything else is returned as written. */
	function siteOf(source) {
		const host = /^https?:\/\/([^/]+)/i.exec(source.trim())?.[1];
		return host ? host.replace(/^www\./i, "") : source;
	}
	/** The credit line for these options, e.g. "Source: ANTARA • Photo: Jane Doe, CC BY-SA 4.0". */
	function creditText(opts) {
		if (opts.text) return opts.text;
		const L = LABELS[opts.lang ?? "en"];
		const parts = [];
		const sources = (Array.isArray(opts.source) ? opts.source : opts.source ? [opts.source] : []).filter(Boolean);
		if (sources.length) parts.push(`${L.source}: ${sources.join(" • ")}`);
		const assets = (Array.isArray(opts.asset) ? opts.asset : opts.asset ? [opts.asset] : []).filter(Boolean);
		let photo = opts.photo;
		let license = opts.license;
		const assetParts = [];
		for (const asset of assets) {
			const row = attribution(asset);
			if (!row) throw new Error(`credit(): "${asset}" has no row in assets/ATTRIBUTIONS.md; add one (Asset | Source | Author | License | Notes) first`);
			if (/ai-generated/i.test(row.author)) {
				const tool = /generated with ([^(]+)/i.exec(row.source)?.[1]?.trim();
				assetParts.push(tool ? `${L.ai} (${tool})` : L.ai);
				continue;
			}
			const label = assetLabel(asset);
			const who = row.author || siteOf(row.source);
			if (label === "photo" && assets.length === 1) {
				photo ??= who;
				license ??= row.license;
				continue;
			}
			if (who) assetParts.push(`${L[label]}: ${who}${row.license ? `, ${row.license}` : ""}`);
			else if (row.license) assetParts.push(row.license);
		}
		if (photo) parts.push(`${L.photo}: ${photo}${license ? `, ${license}` : ""}`);
		else if (license) parts.push(license);
		parts.push(...assetParts);
		return parts.join(" • ");
	}
	/**
	* A one-line source / photo credit in a fixed spot, right-aligned: in the bottom margin under the
	* caption slot in 16:9 and 1:1; at the top of the safe area in 9:16, where the bottom belongs to
	* captions and the platform UI. It never meets the caption slot; long credits shrink to fit.
	*/
	function credit(root, opts) {
		const { width, height } = root.propsAt(0);
		if (!(width > 0 && height > 0)) throw new Error("credit(): add it to the scene root (it needs a width and height)");
		const L = layout({
			width,
			height
		});
		const text = creditText(opts);
		const fontFamily = opts.fontFamily ?? "SF Mono";
		const { lineHeight, fontWeight } = L.type.label;
		const background = opts.background === void 0 ? "#0000008c" : opts.background;
		const padX = background ? L.u : 0;
		const padY = background ? L.u * .4 : 0;
		const room = L.safe.width - padX * 2;
		let fontSize = L.type.label.fontSize;
		const measured = measureText({
			text,
			fontSize,
			fontFamily,
			fontWeight,
			lineHeight
		});
		if (measured.width > room) fontSize *= room / measured.width;
		const textW = Math.min(measureText({
			text,
			fontSize,
			fontFamily,
			fontWeight,
			lineHeight
		}).width, room);
		const textH = fontSize * lineHeight;
		const portrait = L.orientation === "portrait";
		const right = L.safe.x + L.safe.width - padX;
		const cy = portrait ? L.safe.y + padY + textH / 2 : height - L.u * 6 / 2;
		const group = new GroupNode({ name: (opts.name ?? "credit").replaceAll("/", "-") });
		if (background) group.add(new RectNode({
			name: "backdrop",
			x: right + padX,
			y: cy,
			anchorX: 1,
			anchorY: .5,
			width: textW + padX * 2,
			height: textH + padY * 2,
			radius: L.u * .6,
			fill: background
		}));
		group.add(new TextNode({
			name: "text",
			text,
			fontFamily,
			fontSize,
			fontWeight,
			lineHeight,
			color: opts.color ?? "#ffffffd9",
			align: "right",
			x: right,
			y: cy,
			anchorX: 1,
			anchorY: .5,
			width: textW,
			height: textH
		}));
		if (opts.at !== void 0 && opts.at > 0) {
			group.assign({ opacity: 0 });
			group.to({ opacity: 1 }, {
				at: opts.at,
				duration: .4,
				ease: "outCubic"
			});
		}
		if (opts.until !== void 0) group.to({ opacity: 0 }, {
			at: opts.until,
			duration: .3,
			ease: "inOutCubic"
		});
		return root.add(group);
	}
	// ../../packages/runtime/src/components/callout.ts
	/**
	* A dot, leader line and label pinned to a 3D point of a `three()` node; it follows the point as the
	* camera moves (the node needs a `cameraPath`). Added next to the three node, on top of it.
	*/
	function callout(stage, o) {
		const parent = stage.parent;
		if (!parent) throw new Error(`callout("${o.label}"): add the three() node to the scene before its callouts`);
		const u = Math.min(stage.width, stage.height) / 100;
		const [dx, dy] = o.offset ?? [u * 10, -u * 8];
		const color = o.color ?? "#ffffff";
		const accent = o.accent ?? color;
		const fontSize = o.fontSize ?? Math.max(12, u * 3.4);
		const box = new GroupNode({
			name: o.name ?? "callout",
			opacity: o.at === void 0 ? 1 : 0
		});
		box.add(new CircleNode({
			name: "dot",
			radius: u * .9,
			anchorX: .5,
			anchorY: .5,
			fill: accent
		}));
		box.add(new RectNode({
			name: "leader",
			width: Math.hypot(dx, dy),
			height: Math.max(1, u * .25),
			anchorY: .5,
			rotation: Math.atan2(dy, dx) * 180 / Math.PI,
			fill: accent
		}));
		box.add(new TextNode({
			name: "label",
			text: o.label,
			x: dx + Math.sign(dx || 1) * u * 1.5,
			y: dy,
			anchorX: dx < 0 ? 1 : 0,
			anchorY: .5,
			fontSize,
			fontWeight: o.fontWeight ?? 600,
			...o.fontFamily ? { fontFamily: o.fontFamily } : {},
			color
		}));
		parent.add(box);
		if (o.at !== void 0) box.to({ opacity: 1 }, {
			at: o.at,
			duration: .3,
			ease: "outCubic"
		});
		if (o.until !== void 0) box.to({ opacity: 0 }, {
			at: o.until,
			duration: .3,
			ease: "inCubic"
		});
		box.drive((t) => {
			const p = stage.project(o.target, t);
			return p.visible ? {
				x: p.x,
				y: p.y
			} : {
				x: p.x,
				y: p.y,
				opacity: 0
			};
		});
		return box;
	}
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
			super({
				...rest,
				width,
				height
			});
			const isDark = theme === "dark";
			const bgFill = isDark ? "#1e1e1e" : "#f6f6f6";
			const barFill = isDark ? "#2d2d2d" : "#e8e8e8";
			const barBorder = isDark ? "#1f1f1f" : "#d8d8d8";
			const titleColor = isDark ? "#d0d0d0" : "#4a4a4a";
			this.frame = this.add(rect({
				name: "frame",
				width,
				height,
				radius: 10,
				fill: bgFill,
				stroke: isDark ? "#383838" : "#d0d0d0",
				strokeWidth: 1
			}));
			this.titleBar = this.add(rect({
				name: "titleBar",
				width,
				height: 38,
				radius: 10,
				fill: barFill
			}));
			this.titleBorder = this.add(rect({
				name: "titleBorder",
				y: 37,
				width,
				height: 1,
				fill: barBorder
			}));
			this.trafficLights = this.add(group({
				name: "trafficLights",
				x: 14,
				y: 13,
				width: 52,
				height: 12
			}));
			this.closeBtn = this.trafficLights.add(rect({
				name: "close",
				x: 0,
				width: 12,
				height: 12,
				radius: 6,
				fill: "#ff5f56"
			}));
			this.minBtn = this.trafficLights.add(rect({
				name: "minimize",
				x: 20,
				width: 12,
				height: 12,
				radius: 6,
				fill: "#ffbd2e"
			}));
			this.maxBtn = this.trafficLights.add(rect({
				name: "maximize",
				x: 40,
				width: 12,
				height: 12,
				radius: 6,
				fill: "#27c93f"
			}));
			this.titleText = this.add(text({
				name: "titleText",
				text: title,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				fontSize: 13,
				fontWeight: 500,
				color: titleColor,
				anchorX: .5,
				anchorY: .5,
				x: width / 2,
				y: 19
			}));
			this.contentArea = this.add(group({
				name: "content",
				y: 38,
				width,
				height: Math.max(0, height - 38),
				clip: true,
				radius: 10
			}));
		}
		get width() {
			return this.propsAt(0).width;
		}
		get height() {
			return this.propsAt(0).height;
		}
	};
	const windowNode = (init) => new WindowNode(init);
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
			super({
				...rest,
				width,
				height
			});
			const isDark = theme === "dark";
			const barBg = isDark ? "#18181fb3" : "#f5f5f7cc";
			const textCol = isDark ? "#f0f0f5" : "#1d1d1f";
			if (wallSrc) this.wallpaper = this.add(image({
				name: "wallpaper",
				src: wallSrc,
				width,
				height,
				fit: "cover"
			}));
			else this.wallpaper = this.add(rect({
				name: "wallpaper",
				width,
				height,
				fill: isDark ? "#1b192e" : "#8ab4f8"
			}));
			this.menuBar = this.add(rect({
				name: "menuBar",
				width,
				height: 28,
				fill: barBg
			}));
			this.appleIcon = this.add(text({
				name: "appleIcon",
				text: "",
				x: 16,
				y: 6,
				fontSize: 14,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: textCol
			}));
			this.appTitle = this.add(text({
				name: "appTitle",
				text: appName,
				x: 38,
				y: 7,
				fontSize: 13,
				fontWeight: 600,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: textCol
			}));
			this.menuItems = this.add(text({
				name: "menuItems",
				text: "File   Edit   View   Go   Window   Help",
				x: 104,
				y: 7,
				fontSize: 13,
				fontWeight: 400,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: isDark ? "#b0b0b8" : "#55555c"
			}));
			this.clock = this.add(text({
				name: "clock",
				text: "Sun 10:24 AM",
				x: width - 16,
				y: 7,
				anchorX: 1,
				fontSize: 13,
				fontWeight: 400,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: textCol
			}));
		}
		get width() {
			return this.propsAt(0).width;
		}
		get height() {
			return this.propsAt(0).height;
		}
	};
	const desktop = (init) => new DesktopNode(init);
	// ../../packages/runtime/src/mockups/terminal.ts
	var TerminalNode = class extends WindowNode {
		prompt;
		actions = [];
		bufferNode;
		constructor(init = {}) {
			const { cwd = "~", user = "user", host = "macbook", title = `Terminal — ${cwd}`, ...rest } = init;
			super({
				...rest,
				title,
				theme: "dark"
			});
			this.prompt = `${user}@${host} ${cwd} % `;
			const term = this;
			class DynamicBufferNode extends TextNode {
				propsAt(t) {
					const p = super.propsAt(t);
					p.text = term.textAt(t);
					return p;
				}
			}
			this.bufferNode = this.contentArea.add(new DynamicBufferNode({
				name: "buffer",
				x: 16,
				y: 16,
				text: this.prompt,
				fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
				fontSize: 13,
				lineHeight: 1.45,
				color: "#f0f0f0"
			}));
		}
		type(command, opts) {
			this.actions.push({
				kind: "type",
				prompt: this.prompt,
				command,
				at: opts.at,
				duration: Math.max(.01, opts.duration)
			});
			this.actions.sort((a, b) => a.at - b.at);
			return this;
		}
		writeln(text, at) {
			this.actions.push({
				kind: "line",
				text,
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
			if (currentLine) lines.push(currentLine);
			return lines.join("\n");
		}
	};
	const terminal = (init) => new TerminalNode(init);
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
				duration: Math.max(.01, opts.duration)
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
			super({
				...rest,
				title: "",
				width,
				height,
				theme: "dark"
			});
			const chrome = this;
			this.urlbar = new ChromeOmnibox(url);
			this.titleText.set({ opacity: 0 }, 0);
			this.tabRect = this.add(rect({
				name: "activeTab",
				x: 80,
				y: 6,
				width: 190,
				height: 32,
				radius: 8,
				fill: "#35363a"
			}));
			this.tabTitle = this.add(text({
				name: "tabTitle",
				text: tabTitle,
				x: 96,
				y: 14,
				fontSize: 12,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: "#e8eaed"
			}));
			this.navBar = this.add(rect({
				name: "navBar",
				y: 38,
				width,
				height: 42,
				fill: "#35363a"
			}));
			this.add(text({
				name: "navIcons",
				text: "‹   ›   ↻",
				x: 16,
				y: 48,
				fontSize: 16,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: "#9aa0a6"
			}));
			const omniboxWidth = Math.max(200, width - 120);
			this.urlbarRect = this.add(rect({
				name: "urlbarRect",
				x: 96,
				y: 45,
				width: omniboxWidth,
				height: 28,
				radius: 14,
				fill: "#202124"
			}));
			class DynamicUrlTextNode extends TextNode {
				propsAt(t) {
					const p = super.propsAt(t);
					p.text = `🔒  ${chrome.urlbar.textAt(t)}`;
					return p;
				}
			}
			this.urlbarText = this.add(new DynamicUrlTextNode({
				name: "urlbarText",
				text: `🔒  ${url}`,
				x: 112,
				y: 51,
				fontSize: 12,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: "#e8eaed"
			}));
			this.pageArea = this.contentArea.add(group({
				name: "pageArea",
				y: 42,
				width,
				height: Math.max(0, height - 80),
				clip: true
			}));
		}
	};
	const chrome = (init) => new ChromeNode(init);
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
			super({
				...rest,
				title: `Visual Studio Code — ${filename}`,
				width,
				height,
				theme: "dark"
			});
			this.initialCode = code;
			const ed = this;
			this.tabRect = this.add(rect({
				name: "tabRect",
				x: 80,
				y: 6,
				width: 160,
				height: 32,
				radius: 4,
				fill: "#1e1e1e"
			}));
			this.tabTitle = this.add(text({
				name: "tabTitle",
				text: filename,
				x: 104,
				y: 14,
				fontSize: 12,
				fontFamily: "SF Pro Text, -apple-system, sans-serif",
				color: "#ffffff"
			}));
			this.gutter = this.contentArea.add(rect({
				name: "gutter",
				width: 48,
				height: Math.max(0, height - 38),
				fill: "#181818"
			}));
			class DynamicGutterTextNode extends TextNode {
				propsAt(t) {
					const p = super.propsAt(t);
					const codeLines = ed.codeAt(t).split("\n").length;
					p.text = Array.from({ length: Math.max(1, codeLines) }, (_, i) => String(i + 1)).join("\n");
					return p;
				}
			}
			this.gutterText = this.contentArea.add(new DynamicGutterTextNode({
				name: "gutterText",
				x: 36,
				y: 12,
				anchorX: 1,
				fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
				fontSize: 13,
				lineHeight: 1.5,
				color: "#6e7681"
			}));
			class DynamicCodeTextNode extends TextNode {
				propsAt(t) {
					const p = super.propsAt(t);
					p.text = ed.codeAt(t);
					return p;
				}
			}
			this.codeNode = this.contentArea.add(new DynamicCodeTextNode({
				name: "codeText",
				x: 60,
				y: 12,
				text: code,
				fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
				fontSize: 13,
				lineHeight: 1.5,
				color: "#e6edf3"
			}));
		}
		typeCode(code, opts) {
			this.typeActions.push({
				code,
				at: opts.at,
				duration: Math.max(.01, opts.duration)
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
	const editor = (init) => new EditorNode(init);
	// ../../packages/runtime/src/mockups/cursor.ts
	var CursorNode = class extends GroupNode {
		icon;
		constructor(init = {}) {
			const { pointer = false, x = 0, y = 0, ...rest } = init;
			super({
				...rest,
				x,
				y,
				z: 999
			});
			this.icon = this.add(text({
				name: "icon",
				text: pointer ? "👆" : "↖",
				fontSize: 24,
				fontFamily: "-apple-system, sans-serif",
				color: "#ffffff"
			}));
		}
		moveTo(x, y, opts) {
			return this.to({
				x,
				y
			}, opts);
		}
		click(opts) {
			const half = (opts.duration ?? .15) / 2;
			this.to({
				scaleX: .8,
				scaleY: .8
			}, {
				at: opts.at,
				duration: half
			});
			this.to({
				scaleX: 1,
				scaleY: 1
			}, {
				at: opts.at + half,
				duration: half
			});
			return this;
		}
	};
	const cursor = (init) => new CursorNode(init);
	// ../../packages/runtime/src/mockups/focus.ts
	/**
	* Cinematographic focus helper: brings `target` window to front, slightly scales it up,
	* and dims & blurs other sibling windows in the desktop.
	*/
	function focus(target, opts) {
		const duration = opts.duration ?? .5;
		const scale = opts.scale ?? 1.02;
		const dimOthers = opts.dimOthers ?? .4;
		const blurOthers = opts.blurOthers ?? 6;
		target.to({
			z: 10,
			scaleX: scale,
			scaleY: scale,
			opacity: 1,
			blur: 0
		}, {
			at: opts.at,
			duration
		});
		if (target.parent) for (const sibling of target.parent.children) {
			if (sibling === target || sibling instanceof CursorNode) continue;
			sibling.to({
				z: 0,
				scaleX: 1,
				scaleY: 1,
				opacity: dimOthers,
				blur: blurOthers
			}, {
				at: opts.at,
				duration
			});
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
			const { theme = "dark", time = "9:41", showIsland = true, showHomeIndicator = true, width = 400, height = 820, ...rest } = init;
			super({
				...rest,
				width,
				height
			});
			const isDark = theme === "dark";
			const bezelColor = isDark ? "#1a1a1e" : "#e2e2e8";
			const bezelBorder = isDark ? "#2e2e36" : "#c4c4cc";
			const screenBg = isDark ? "#000000" : "#ffffff";
			const textColor = isDark ? "#ffffff" : "#000000";
			const outerRadius = 50;
			const innerRadius = 42;
			const bezelWidth = 8;
			this.bezel = this.add(rect({
				name: "bezel",
				width,
				height,
				radius: outerRadius,
				fill: bezelColor,
				stroke: bezelBorder,
				strokeWidth: 2
			}));
			const screenW = width - 16;
			const screenH = height - 16;
			this.screen = this.add(rect({
				name: "screen",
				x: bezelWidth,
				y: bezelWidth,
				width: screenW,
				height: screenH,
				radius: innerRadius,
				fill: screenBg,
				clip: true
			}));
			this.contentArea = this.screen.add(group({
				name: "contentArea",
				width: screenW,
				height: screenH
			}));
			this.timeText = this.screen.add(text({
				name: "timeText",
				text: time,
				fontSize: 14,
				fontWeight: 600,
				fontFamily: "SF Pro Text",
				color: textColor,
				x: 32,
				y: 14,
				z: 99
			}));
			const islandWidth = Math.min(screenW * .32, 126);
			const islandHeight = 32;
			this.dynamicIsland = this.screen.add(rect({
				name: "dynamicIsland",
				width: islandWidth,
				height: islandHeight,
				x: (screenW - islandWidth) / 2,
				y: 11,
				radius: 16,
				fill: "#000000",
				opacity: showIsland ? 1 : 0,
				z: 100
			}));
			const homeW = Math.min(screenW * .36, 140);
			const homeH = 5;
			this.homeIndicator = this.screen.add(rect({
				name: "homeIndicator",
				width: homeW,
				height: homeH,
				x: (screenW - homeW) / 2,
				y: screenH - 12,
				radius: 2.5,
				fill: isDark ? "#ffffff" : "#000000",
				opacity: showHomeIndicator ? .8 : 0,
				z: 100
			}));
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
	const tokyoNightColors = {
		window: "#16161e",
		sky: "#7aa2f7",
		green: "#9ece6a"
	};
	/** Icon mark: rounded plate with a play glyph, flat Tokyo Night colors. */
	function logoMark(name, size, x, y) {
		const colors = tokyoNightColors;
		const mark = group({
			name,
			width: size,
			height: size,
			x,
			y,
			anchorX: .5,
			anchorY: .5
		});
		mark.add(rect({
			name: "plate",
			width: size,
			height: size,
			radius: size * .26,
			fill: colors.window,
			stroke: colors.sky,
			strokeWidth: Math.max(2, size * .03)
		}));
		mark.add(path({
			name: "playGlyph",
			d: `M ${size * .4} ${size * .3} L ${size * .72} ${size * .5} L ${size * .4} ${size * .7} Z`,
			fill: colors.sky
		}));
		mark.add(circle({
			name: "sparkDot",
			radius: size * .05,
			x: size * .8,
			y: size * .2,
			anchorX: .5,
			anchorY: .5,
			fill: colors.green
		}));
		return mark;
	}
	// ../../packages/runtime/src/mockups/ui_kit.ts
	const UI_FONT = "SF Pro Text";
	function palette(theme = "dark") {
		return theme === "light" ? {
			window: "#ffffff",
			chrome: "#eef0f3",
			chromeBorder: "#d5d8de",
			tab: "#e2e5ea",
			tabActive: "#ffffff",
			field: "#ffffff",
			text: "#1d2129",
			muted: "#6b7280",
			accent: "#2563eb",
			selection: "#dbe7ff",
			bubbleUser: "#2563eb",
			bubbleUserText: "#ffffff",
			bubbleOther: "#eef0f3",
			bubbleOtherText: "#1d2129",
			card: "#ffffffee",
			cardBorder: "#d5d8de",
			shadow: "#0000001f"
		} : {
			window: "#16181d",
			chrome: "#22252b",
			chromeBorder: "#30343c",
			tab: "#1b1e23",
			tabActive: "#2c3038",
			field: "#121418",
			text: "#e8eaed",
			muted: "#9aa0a6",
			accent: "#60a5fa",
			selection: "#2a3b57",
			bubbleUser: "#2563eb",
			bubbleUserText: "#ffffff",
			bubbleOther: "#2a2d34",
			bubbleOtherText: "#e8eaed",
			card: "#2a2d34f2",
			cardBorder: "#3a3e46",
			shadow: "#00000066"
		};
	}
	/** Size unit for a component box: 1 at about 1000 px wide, so its parts scale with the box. */
	function unit(width, height) {
		return Math.max(.45, Math.min(width / 1e3, height / 640, 2.4));
	}
	/**
	* Word-wraps `text` to `maxWidth` with the installed text measurer (an estimate in tests), so the
	* node can be given its final size. Long words are cut into pieces that fit.
	*/
	function wrapText(text, opts) {
		const style = {
			fontSize: opts.fontSize,
			fontWeight: opts.fontWeight ?? 400,
			lineHeight: opts.lineHeight ?? 1.3,
			fontFamily: opts.fontFamily ?? "SF Pro Text"
		};
		const widthOf = (s) => measureText({
			...style,
			text: s
		}).width;
		const maxWidth = Math.max(opts.fontSize, opts.maxWidth);
		const out = [];
		for (const hard of text.split("\n")) {
			let line = "";
			for (let word of hard.split(" ").filter((w) => w !== "")) {
				while (widthOf(word) > maxWidth && word.length > 1) {
					let n = word.length - 1;
					while (n > 1 && widthOf(word.slice(0, n)) > maxWidth) n--;
					if (line) {
						out.push(line);
						line = "";
					}
					out.push(word.slice(0, n));
					word = word.slice(n);
				}
				const next = line ? `${line} ${word}` : word;
				if (line && widthOf(next) > maxWidth) {
					out.push(line);
					line = word;
				} else line = next;
			}
			out.push(line);
		}
		return {
			text: out.join("\n"),
			width: Math.min(maxWidth, Math.max(0, ...out.map(widthOf))),
			height: out.length * opts.fontSize * style.lineHeight,
			lines: out.length
		};
	}
	/** Cuts `text` to fit `maxWidth` on one line, with an ellipsis. */
	function ellipsize(text, opts) {
		const style = {
			fontSize: opts.fontSize,
			fontWeight: opts.fontWeight ?? 400,
			fontFamily: opts.fontFamily ?? "SF Pro Text"
		};
		const fits = (s) => measureText({
			...style,
			text: s
		}).width <= opts.maxWidth;
		if (fits(text)) return text;
		let n = text.length;
		while (n > 0 && !fits(`${text.slice(0, n)}…`)) n--;
		return n > 0 ? `${text.slice(0, n)}…` : "";
	}
	/** Width of one line of text. */
	function textWidth(text, opts) {
		return measureText({
			fontSize: opts.fontSize,
			fontWeight: opts.fontWeight ?? 400,
			fontFamily: opts.fontFamily ?? "SF Pro Text",
			text
		}).width;
	}
	// ../../packages/runtime/src/mockups/browser.ts
	var BrowserWindowNode = class extends GroupNode {
		frame;
		tabs;
		urlField;
		urlText;
		/** The web page: add your content here (clipped to the page) */
		page;
		typing = [];
		colors;
		constructor(init = {}) {
			const { url = "https://example.com", tabs = ["New Tab"], activeTab = 0, theme = "dark", content, width = 1200, height = 760, name = "browser", ...rest } = init;
			super({
				...rest,
				name,
				width,
				height
			});
			const c = this.colors = palette(theme);
			const k = unit(width, height);
			const tabBarH = 40 * k;
			const toolbarH = 44 * k;
			const font = 13 * k;
			this.frame = this.add(rect({
				name: "frame",
				width,
				height,
				radius: 12 * k,
				fill: c.window,
				stroke: c.chromeBorder,
				strokeWidth: Math.max(1, k)
			}));
			this.add(rect({
				name: "tabStrip",
				width,
				height: tabBarH + 12 * k,
				radius: 12 * k,
				fill: c.chrome
			}));
			this.add(rect({
				name: "toolbar",
				y: tabBarH,
				width,
				height: toolbarH,
				fill: c.tabActive
			}));
			this.add(rect({
				name: "toolbarBorder",
				y: tabBarH + toolbarH - Math.max(1, k),
				width,
				height: Math.max(1, k),
				fill: c.chromeBorder
			}));
			const lights = this.add(group({
				name: "trafficLights",
				x: 16 * k,
				y: tabBarH / 2 - 6 * k,
				width: 52 * k,
				height: 12 * k
			}));
			[
				"#ff5f57",
				"#febc2e",
				"#28c840"
			].forEach((fill, i) => lights.add(circle({
				name: `light${i}`,
				x: i * 20 * k,
				radius: 6 * k,
				fill
			})));
			const tabsX = 84 * k;
			const tabW = Math.min(220 * k, (width - tabsX - 16 * k) / Math.max(1, tabs.length));
			this.tabs = tabs.map((title, i) => {
				const g = this.add(group({
					name: `tab${i}`,
					x: tabsX + i * tabW,
					y: 6 * k,
					width: tabW - 4 * k,
					height: tabBarH - 6 * k
				}));
				return {
					group: g,
					background: g.add(rect({
						name: "background",
						width: tabW - 4 * k,
						height: tabBarH - 6 * k,
						radius: 8 * k,
						fill: i === activeTab ? c.tabActive : c.tab
					})),
					label: g.add(new TextNode({
						name: "labelText",
						text: ellipsize(title, {
							fontSize: font,
							maxWidth: tabW - 28 * k
						}),
						x: 12 * k,
						y: (tabBarH - 6 * k - font * 1.2) / 2,
						width: tabW - 28 * k,
						height: font * 1.2,
						fontSize: font,
						fontFamily: UI_FONT,
						color: i === activeTab ? c.text : c.muted
					}))
				};
			});
			this.add(new TextNode({
				name: "navText",
				text: "‹  ›  ↻",
				x: 16 * k,
				y: tabBarH + (toolbarH - 16 * k * 1.2) / 2,
				width: 80 * k,
				height: 16 * k * 1.2,
				fontSize: 16 * k,
				fontFamily: UI_FONT,
				color: c.muted
			}));
			const fieldX = 100 * k;
			const fieldW = Math.max(40 * k, width - fieldX - 16 * k);
			const fieldH = 28 * k;
			this.urlField = this.add(rect({
				name: "urlField",
				x: fieldX,
				y: tabBarH + (toolbarH - fieldH) / 2,
				width: fieldW,
				height: fieldH,
				radius: fieldH / 2,
				fill: c.field
			}));
			const typing = this.typing;
			const urlFont = font;
			const urlMax = fieldW - 28 * k;
			class UrlText extends TextNode {
				propsAt(t) {
					const p = super.propsAt(t);
					let shown = url;
					for (const a of typing) {
						if (a.at > t) break;
						const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
						shown = a.url.slice(0, Math.floor(progress * a.url.length));
					}
					p.text = ellipsize(shown, {
						fontSize: urlFont,
						maxWidth: urlMax
					});
					return p;
				}
			}
			this.urlText = this.add(new UrlText({
				name: "urlText",
				text: url,
				x: fieldX + 14 * k,
				y: tabBarH + (toolbarH - urlFont * 1.2) / 2,
				width: urlMax,
				height: urlFont * 1.2,
				fontSize: urlFont,
				fontFamily: UI_FONT,
				color: c.text
			}));
			const pageY = tabBarH + toolbarH;
			this.page = this.add(group({
				name: "page",
				y: pageY,
				width,
				height: Math.max(0, height - pageY),
				clip: true,
				radius: 12 * k
			}));
			this.page.add(rect({
				name: "pageBackground",
				width,
				height: Math.max(0, height - pageY),
				fill: c.window
			}));
			for (const node of content === void 0 ? [] : Array.isArray(content) ? content : [content]) this.page.add(node);
		}
		/** Types `url` into the address bar, a character at a time over `duration` seconds. */
		typeUrl(url, opts) {
			this.typing.push({
				url,
				at: opts.at,
				duration: Math.max(.01, opts.duration ?? Math.min(1.5, url.length * .05))
			});
			this.typing.sort((a, b) => a.at - b.at);
			return this;
		}
		/** Makes tab `index` the active one at `at`. */
		switchTab(index, opts) {
			if (!this.tabs[index]) throw new Error(`browserWindow: no tab ${index} (it has ${this.tabs.length})`);
			this.tabs.forEach((tab, i) => {
				tab.background.set({ fill: i === index ? this.colors.tabActive : this.colors.tab }, opts.at);
				tab.label.set({ color: i === index ? this.colors.text : this.colors.muted }, opts.at);
			});
			return this;
		}
	};
	const browserWindow = (init) => new BrowserWindowNode(init);
	// ../../packages/runtime/src/mockups/explorer.ts
	const FOLDER = "#e8a33d";
	const FILE_COLORS = {
		ts: "#3178c6",
		js: "#f1c232",
		json: "#cbcb41",
		md: "#7d8590",
		png: "#a074c4",
		jpg: "#a074c4",
		mp4: "#e05d44",
		mp3: "#3fb950",
		rs: "#dea584",
		css: "#563d7c",
		html: "#e34c26"
	};
	function flatten(items, depth, out) {
		for (const item of items) {
			if (typeof item === "string") {
				out.push({
					name: item,
					depth,
					folder: false,
					open: false
				});
				continue;
			}
			const folder = item.folder ?? item.children !== void 0;
			const open = folder && item.open !== false;
			out.push({
				name: item.name,
				depth,
				folder,
				open
			});
			if (open && item.children) flatten(item.children, depth + 1, out);
		}
		return out;
	}
	var FileExplorerNode = class extends GroupNode {
		panel;
		rows;
		/** The selection bar; `select()` moves it */
		highlight;
		constructor(init) {
			const { items, selected, title = "EXPLORER", theme = "dark", width = 360, height = 560, name = "explorer", ...rest } = init;
			super({
				...rest,
				name,
				width,
				height
			});
			const c = palette(theme);
			const k = unit(width * 2.2, height);
			const font = 14 * k;
			const rowH = 28 * k;
			const pad = 12 * k;
			const indent = 16 * k;
			const headerH = 36 * k;
			this.panel = this.add(rect({
				name: "panel",
				width,
				height,
				radius: 10 * k,
				fill: c.chrome,
				stroke: c.chromeBorder,
				strokeWidth: Math.max(1, k)
			}));
			this.add(new TextNode({
				name: "headerText",
				text: ellipsize(title, {
					fontSize: 11 * k,
					maxWidth: width - 2 * pad,
					fontWeight: 600
				}),
				x: pad,
				y: (headerH - 11 * k * 1.2) / 2,
				width: width - 2 * pad,
				height: 11 * k * 1.2,
				fontSize: 11 * k,
				fontWeight: 600,
				fontFamily: UI_FONT,
				color: c.muted
			}));
			const list = this.add(group({
				name: "list",
				y: headerH,
				width,
				height: Math.max(0, height - headerH - 6 * k),
				clip: true
			}));
			const flat = flatten(items, 0, []);
			const first = flat.findIndex((r) => r.name === selected);
			this.highlight = list.add(rect({
				name: "highlight",
				x: 4 * k,
				y: Math.max(0, first) * rowH,
				width: width - 8 * k,
				height: rowH,
				radius: 6 * k,
				fill: c.selection,
				opacity: first >= 0 ? 1 : 0
			}));
			this.rows = flat.map((r, i) => {
				const x = pad + r.depth * indent;
				const g = list.add(group({
					name: `row${i}`,
					x,
					y: i * rowH,
					width: Math.max(0, width - x - 4 * k),
					height: rowH
				}));
				const iconW = 12 * k;
				const ext = r.name.includes(".") ? r.name.split(".").pop().toLowerCase() : "";
				if (r.folder) {
					g.add(new TextNode({
						name: "chevronText",
						text: r.open ? "▾" : "▸",
						y: (rowH - font * 1.2) / 2,
						width: 10 * k,
						height: font * 1.2,
						fontSize: font,
						fontFamily: UI_FONT,
						color: c.muted
					}));
					g.add(rect({
						name: "icon",
						x: 12 * k,
						y: (rowH - 10 * k) / 2,
						width: iconW + 2 * k,
						height: 10 * k,
						radius: 2 * k,
						fill: FOLDER
					}));
				} else g.add(rect({
					name: "icon",
					x: 12 * k,
					y: (rowH - 13 * k) / 2,
					width: 10 * k,
					height: 13 * k,
					radius: 2 * k,
					fill: FILE_COLORS[ext] ?? c.muted
				}));
				const labelX = 32 * k;
				const maxW = Math.max(0, width - x - labelX - 8 * k);
				const label = g.add(new TextNode({
					name: "labelText",
					text: ellipsize(r.name, {
						fontSize: font,
						maxWidth: maxW
					}),
					x: labelX,
					y: (rowH - font * 1.2) / 2,
					width: maxW,
					height: font * 1.2,
					fontSize: font,
					fontFamily: UI_FONT,
					color: c.text
				}));
				return {
					name: r.name,
					depth: r.depth,
					folder: r.folder,
					group: g,
					label
				};
			});
		}
		/** The row called `name` (exact, then case-insensitive). */
		row(name) {
			const found = this.rows.find((r) => r.name === name) ?? this.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
			if (!found) throw new Error(`fileExplorer: no row "${name}" (rows: ${this.rows.map((r) => r.name).join(", ")})`);
			return found;
		}
		/** Moves the selection to the row called `name`. */
		select(name, opts) {
			const y = this.row(name).group.propsAt(0).y;
			this.highlight.set({ opacity: 1 }, opts.at);
			this.highlight.to({ y }, {
				at: opts.at,
				duration: Math.max(.01, opts.duration ?? .25),
				ease: opts.ease ?? "outCubic"
			});
			return this;
		}
	};
	const fileExplorer = (init) => new FileExplorerNode(init);
	// ../../packages/runtime/src/mockups/chat.ts
	var ChatThreadNode = class extends GroupNode {
		panel;
		/** The scrolling column of bubbles */
		thread;
		bubbles;
		/** When each message appears (scene seconds), e.g. to time narration or a cursor */
		times;
		typingDots;
		constructor(init) {
			const { messages, title = "Assistant", theme = "dark", reveal = {}, typing = .6, placeholder = "Message…", width = 720, height = 900, name = "chat", ...rest } = init;
			super({
				...rest,
				name,
				width,
				height
			});
			const c = palette(theme);
			const k = unit(width * 1.5, height);
			const pad = 16 * k;
			const headerH = 52 * k;
			const inputH = 60 * k;
			const font = 16 * k;
			const lineHeight = 1.35;
			this.panel = this.add(rect({
				name: "panel",
				width,
				height,
				radius: 16 * k,
				fill: c.window,
				stroke: c.chromeBorder,
				strokeWidth: Math.max(1, k)
			}));
			this.add(rect({
				name: "header",
				width,
				height: headerH,
				radius: 16 * k,
				fill: c.chrome
			}));
			this.add(rect({
				name: "headerBorder",
				y: headerH - Math.max(1, k),
				width,
				height: Math.max(1, k),
				fill: c.chromeBorder
			}));
			this.add(new TextNode({
				name: "titleText",
				text: ellipsize(title, {
					fontSize: 17 * k,
					maxWidth: width - 2 * pad,
					fontWeight: 600
				}),
				x: pad,
				y: (headerH - 17 * k * 1.2) / 2,
				width: width - 2 * pad,
				height: 17 * k * 1.2,
				fontSize: 17 * k,
				fontWeight: 600,
				fontFamily: UI_FONT,
				color: c.text
			}));
			const viewportH = Math.max(0, height - headerH - inputH);
			const viewport = this.add(group({
				name: "viewport",
				y: headerH,
				width,
				height: viewportH,
				clip: true
			}));
			this.thread = viewport.add(group({
				name: "thread",
				width,
				height: viewportH
			}));
			const fieldH = 40 * k;
			this.add(rect({
				name: "inputField",
				x: pad,
				y: height - inputH + (inputH - fieldH) / 2,
				width: width - 2 * pad,
				height: fieldH,
				radius: fieldH / 2,
				fill: c.field,
				stroke: c.chromeBorder,
				strokeWidth: Math.max(1, k)
			}));
			this.add(new TextNode({
				name: "placeholderText",
				text: ellipsize(placeholder, {
					fontSize: 15 * k,
					maxWidth: width - 4 * pad
				}),
				x: pad + 16 * k,
				y: height - inputH + (inputH - 15 * k * 1.2) / 2,
				width: width - 4 * pad,
				height: 15 * k * 1.2,
				fontSize: 15 * k,
				fontFamily: UI_FONT,
				color: c.muted
			}));
			const start = reveal === false ? 0 : reveal.start ?? .3;
			const gap = reveal === false ? 0 : reveal.gap ?? 1;
			const isReply = (m) => m.from !== "user";
			const times = [];
			messages.forEach((m, i) => {
				const lead = reveal !== false && isReply(m) ? typing : 0;
				const auto = i === 0 ? start + lead : times[i - 1] + gap + lead;
				times.push(m.at ?? auto);
			});
			this.times = times;
			const maxBubble = width * .78;
			const bubblePadX = 14 * k;
			const bubblePadY = 10 * k;
			let y = pad;
			this.bubbles = messages.map((m, i) => {
				const wrapped = wrapText(m.text, {
					fontSize: font,
					maxWidth: maxBubble - 2 * bubblePadX,
					lineHeight
				});
				const w = wrapped.width + 2 * bubblePadX;
				const h = wrapped.height + 2 * bubblePadY;
				const mine = !isReply(m);
				const x = mine ? width - pad - w : pad;
				const g = this.thread.add(group({
					name: `message${i}`,
					x,
					y,
					width: w,
					height: h,
					opacity: reveal === false ? 1 : 0
				}));
				const background = g.add(rect({
					name: "background",
					width: w,
					height: h,
					radius: 18 * k,
					fill: mine ? c.bubbleUser : c.bubbleOther
				}));
				const label = g.add(new TextNode({
					name: "labelText",
					text: wrapped.text,
					x: bubblePadX,
					y: bubblePadY,
					width: wrapped.width,
					height: wrapped.height,
					fontSize: font,
					lineHeight,
					fontFamily: UI_FONT,
					color: mine ? c.bubbleUserText : c.bubbleOtherText
				}));
				if (reveal !== false) {
					g.assign({ y: y + 12 * k });
					g.to({
						opacity: 1,
						y
					}, {
						at: times[i],
						duration: .3,
						ease: "outCubic"
					});
				}
				y += h + 10 * k;
				return {
					message: m,
					group: g,
					background,
					label
				};
			});
			const dotsW = 64 * k;
			const dotsH = 38 * k;
			this.typingDots = this.thread.add(group({
				name: "typingDots",
				x: pad,
				y: pad,
				width: dotsW,
				height: dotsH,
				opacity: 0
			}));
			this.typingDots.add(rect({
				name: "background",
				width: dotsW,
				height: dotsH,
				radius: 18 * k,
				fill: c.bubbleOther
			}));
			for (let d = 0; d < 3; d++) {
				const dot = this.typingDots.add(circle({
					name: `dot${d}`,
					x: 14 * k + d * 13 * k,
					y: dotsH / 2 - 4 * k,
					radius: 4 * k,
					fill: c.muted
				}));
				for (let t = 0; t < (times[times.length - 1] ?? 0) + 1; t += .6) dot.to({ opacity: .35 }, {
					at: t + d * .15,
					duration: .3
				}).to({ opacity: 1 }, {
					at: t + d * .15 + .3,
					duration: .3
				});
			}
			let scrolled = 0;
			this.bubbles.forEach((b, i) => {
				const p = b.group.propsAt(times[i] + 10);
				const bottom = p.y + p.height + pad;
				const showAt = reveal !== false && isReply(b.message) && typing > 0 ? times[i] - typing : times[i];
				if (reveal !== false && isReply(b.message) && typing > 0) {
					this.typingDots.set({
						y: p.y,
						opacity: 1
					}, showAt);
					this.typingDots.set({ opacity: 0 }, times[i]);
				}
				const need = Math.max(0, bottom - viewportH);
				if (need > scrolled) {
					this.thread.to({ y: -need }, {
						at: Math.max(0, showAt - .05),
						duration: .3,
						ease: "outCubic"
					});
					scrolled = need;
				}
			});
		}
	};
	const chatThread = (init) => new ChatThreadNode(init);
	// ../../packages/runtime/src/mockups/notification.ts
	var NotificationNode = class extends GroupNode {
		card;
		titleText;
		bodyText;
		variant;
		constructor(init) {
			const { app, title, body = "", time = "now", color = "#2563eb", theme = "dark", variant = "phone", maxLines = 3, width = 720, name = "notification", ...rest } = init;
			const c = palette(theme);
			const k = unit(width * 2.8, 2e3);
			const pad = 16 * k;
			const icon = 40 * k;
			const textX = pad + icon + 12 * k;
			const textW = Math.max(20 * k, width - textX - pad);
			const small = 13 * k;
			const titleFont = 16 * k;
			const bodyFont = 15 * k;
			let lines = wrapText(body, {
				fontSize: bodyFont,
				maxWidth: textW,
				lineHeight: 1.3
			}).text.split("\n");
			if (lines.length > maxLines) {
				lines = lines.slice(0, maxLines);
				lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]}…`, {
					fontSize: bodyFont,
					maxWidth: textW
				});
				if (!lines[maxLines - 1].endsWith("…")) lines[maxLines - 1] += "…";
			}
			const bodyH = body ? lines.length * bodyFont * 1.3 : 0;
			const headH = small * 1.3;
			const height = pad + headH + 4 * k + titleFont * 1.25 + (body ? 2 * k + bodyH : 0) + pad;
			super({
				...rest,
				name,
				width,
				height,
				opacity: 0
			});
			this.variant = variant;
			this.add(rect({
				name: "shadow",
				x: 0,
				y: 4 * k,
				width,
				height: height - 4 * k,
				radius: (variant === "phone" ? 22 : 12) * k,
				fill: c.shadow,
				blur: 12 * k
			}));
			this.card = this.add(rect({
				name: "card",
				width,
				height,
				radius: (variant === "phone" ? 22 : 12) * k,
				fill: c.card,
				stroke: c.cardBorder,
				strokeWidth: Math.max(1, k)
			}));
			const iconG = this.add(group({
				name: "icon",
				x: pad,
				y: pad,
				width: icon,
				height: icon
			}));
			iconG.add(rect({
				name: "background",
				width: icon,
				height: icon,
				radius: 10 * k,
				fill: color
			}));
			const letter = (app.trim()[0] ?? "?").toUpperCase();
			iconG.add(new TextNode({
				name: "letterText",
				text: letter,
				x: (icon - textWidth(letter, {
					fontSize: 20 * k,
					fontWeight: 700
				})) / 2,
				y: (icon - 20 * k * 1.2) / 2,
				width: Math.min(icon, textWidth(letter, {
					fontSize: 20 * k,
					fontWeight: 700
				})),
				height: 20 * k * 1.2,
				fontSize: 20 * k,
				fontWeight: 700,
				fontFamily: UI_FONT,
				color: "#ffffff"
			}));
			const timeW = Math.min(textW * .4, textWidth(time, { fontSize: small }));
			this.add(new TextNode({
				name: "appText",
				text: ellipsize(app.toUpperCase(), {
					fontSize: small,
					maxWidth: textW - timeW - 8 * k,
					fontWeight: 600
				}),
				x: textX,
				y: pad,
				width: Math.max(0, textW - timeW - 8 * k),
				height: headH,
				fontSize: small,
				fontWeight: 600,
				fontFamily: UI_FONT,
				color: c.muted
			}));
			this.add(new TextNode({
				name: "timeText",
				text: ellipsize(time, {
					fontSize: small,
					maxWidth: timeW
				}),
				x: textX + textW - timeW,
				y: pad,
				width: timeW,
				height: headH,
				fontSize: small,
				fontFamily: UI_FONT,
				color: c.muted
			}));
			const titleY = pad + headH + 4 * k;
			this.titleText = this.add(new TextNode({
				name: "titleText",
				text: ellipsize(title, {
					fontSize: titleFont,
					maxWidth: textW,
					fontWeight: 600
				}),
				x: textX,
				y: titleY,
				width: textW,
				height: titleFont * 1.25,
				fontSize: titleFont,
				fontWeight: 600,
				lineHeight: 1.25,
				fontFamily: UI_FONT,
				color: c.text
			}));
			this.bodyText = this.add(new TextNode({
				name: "bodyText",
				text: lines.join("\n"),
				x: textX,
				y: titleY + titleFont * 1.25 + 2 * k,
				width: textW,
				height: bodyH,
				fontSize: bodyFont,
				lineHeight: 1.3,
				fontFamily: UI_FONT,
				color: c.text,
				opacity: body ? .85 : 0
			}));
		}
		/**
		* Slides the card in at `at` (from the top on a phone, from the right on a desktop), keeps it for
		* `hold` seconds and fades it out. The card ends where you placed it.
		*/
		show(opts) {
			const { at, hold = 3, duration = .4 } = opts;
			const p = this.propsAt(at);
			const from = this.variant === "phone" ? { y: p.y - p.height * .6 } : { x: p.x + p.width * .3 };
			this.set({
				...from,
				opacity: 0
			}, at);
			this.to({
				x: p.x,
				y: p.y,
				opacity: 1
			}, {
				at,
				duration,
				ease: "outCubic"
			});
			this.to({ opacity: 0 }, {
				at: at + duration + hold,
				duration: .3,
				ease: "inCubic"
			});
			return this;
		}
	};
	const notification = (init) => new NotificationNode(init);
	exports.BASE_DEFAULTS = BASE_DEFAULTS;
	exports.BED_MIN_SECONDS = BED_MIN_SECONDS;
	exports.BrowserWindowNode = BrowserWindowNode;
	exports.ChatThreadNode = ChatThreadNode;
	exports.ChromeNode = ChromeNode;
	exports.ChromeOmnibox = ChromeOmnibox;
	exports.CircleNode = CircleNode;
	exports.CursorNode = CursorNode;
	exports.DEFAULT_MIX = DEFAULT_MIX;
	exports.DesktopNode = DesktopNode;
	exports.EditorNode = EditorNode;
	exports.FileExplorerNode = FileExplorerNode;
	exports.GroupNode = GroupNode;
	exports.IDENTITY = IDENTITY;
	exports.ImageNode = ImageNode;
	exports.LIMITER_LOOKAHEAD = LIMITER_LOOKAHEAD;
	exports.LIMITER_RELEASE = LIMITER_RELEASE;
	exports.Node = Node;
	exports.NotificationNode = NotificationNode;
	exports.PathNode = PathNode;
	exports.PhoneNode = PhoneNode;
	exports.RectNode = RectNode;
	exports.ShaderNode = ShaderNode;
	exports.TerminalNode = TerminalNode;
	exports.TextNode = TextNode;
	exports.ThreeNode = ThreeNode;
	exports.Track = Track;
	exports.VO_GAP = VO_GAP;
	exports.VO_PAD = VO_PAD;
	exports.VO_PLACEHOLDER = VO_PLACEHOLDER;
	exports.VideoNode = VideoNode;
	exports.VoHelper = VoHelper;
	exports.WindowNode = WindowNode;
	exports.apply = apply;
	exports.applyTransition = applyTransition;
	exports.attributedFile = attributedFile;
	exports.attribution = attribution;
	exports.browserWindow = browserWindow;
	exports.buildManifest = buildManifest;
	exports.callout = callout;
	exports.cameraPath = cameraPath;
	exports.captions = captions;
	exports.chatThread = chatThread;
	exports.chrome = chrome;
	exports.circle = circle;
	exports.clampFrame = clampFrame;
	exports.collectAssets = collectAssets;
	exports.composition = composition;
	exports.contactShadow = contactShadow;
	exports.credit = credit;
	exports.creditText = creditText;
	exports.cursor = cursor;
	exports.desktop = desktop;
	exports.dofOffsets = dofOffsets;
	exports.dolly = dolly;
	exports.duckGainAt = duckGainAt;
	exports.duckPlan = duckPlan;
	exports.duckSchedule = duckSchedule;
	exports.ease = ease;
	exports.editor = editor;
	exports.evaluateFrame = evaluateFrame;
	exports.fadeGainAt = fadeGainAt;
	exports.fadePlan = fadePlan;
	exports.fileExplorer = fileExplorer;
	exports.focus = focus;
	exports.formatColor = formatColor;
	exports.gltf = gltf;
	exports.group = group;
	exports.hdr = hdr;
	exports.image = image;
	exports.instantiateScene = instantiateScene;
	exports.isSfxName = isSfxName;
	exports.isVoice = isVoice;
	exports.layout = layout;
	exports.layoutComposition = layoutComposition;
	exports.lerpColor = lerpColor;
	exports.limit = limit;
	exports.logoMark = logoMark;
	exports.master = master;
	exports.mattePath = mattePath;
	exports.measureLoudness = measureLoudness;
	exports.measureText = measureText;
	exports.multiply = multiply;
	exports.notification = notification;
	exports.orbit = orbit;
	exports.parseColor = parseColor;
	exports.particles = particles;
	exports.path = path;
	exports.peak = peak;
	exports.phone = phone;
	exports.pixelAverage = pixelAverage;
	exports.planVo = planVo;
	exports.pushIn = pushIn;
	exports.rect = rect;
	exports.registerAttributions = registerAttributions;
	exports.registerThreeLoaders = registerThreeLoaders;
	exports.registerVoTiming = registerVoTiming;
	exports.registerVoTimings = registerVoTimings;
	exports.resolveMix = resolveMix;
	exports.resolveSfx = resolveSfx;
	exports.scene = scene;
	exports.sceneCues = sceneCues;
	exports.seededRandom = seededRandom;
	exports.setTextMeasurer = setTextMeasurer;
	exports.sfxCue = sfxCue;
	exports.shader = shader;
	exports.shouldDuck = shouldDuck;
	exports.stack = stack;
	exports.terminal = terminal;
	exports.text = text;
	exports.texture = texture;
	exports.three = three;
	exports.tokyoNightColors = tokyoNightColors;
	exports.transition = transition;
	exports.video = video;
	exports.videoFile = videoFile;
	exports.vo = vo;
	exports.windowNode = windowNode;
	return exports;
})({});
globalThis.__liosvideo = __liosvideo;
