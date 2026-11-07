var __liosvideo = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	// packages/runtime/src/anim/easing.ts
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
		inOutExpo: (t) => t === 0 ? 0 : t === 1 ? 1 : t < .5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
	};
	function ease(e, t) {
		const c = Math.min(1, Math.max(0, t));
		if (c === 0) return 0;
		if (c === 1) return 1;
		return (typeof e === "function" ? e : EASINGS[e])(c);
	}
	// packages/runtime/src/math/color.ts
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
	// packages/runtime/src/anim/track.ts
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
	// packages/runtime/src/anim/transition.ts
	function transition(typeOrFn, optsOrDuration = .5) {
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
	// packages/runtime/src/math/affine.ts
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
	// packages/runtime/src/math/random.ts
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
	// packages/runtime/src/graph/node.ts
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
		glowIntensity: 1
	};
	var Node = class {
		kind;
		parent;
		children = [];
		_name;
		requestedName;
		base;
		tracks = /* @__PURE__ */ new Map();
		constructor(kind, defaults, init = {}) {
			this.kind = kind;
			const { name, ...props } = init;
			if (name?.includes("/")) throw new Error(`Node name "${name}" must not contain "/"`);
			this.requestedName = name;
			this._name = name ?? `${kind}0`;
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
		to(props, opts) {
			for (const key of Object.keys(props)) this.track(key).add({
				start: opts.at,
				end: opts.at + opts.duration,
				from: void 0,
				to: props[key],
				ease: opts.ease ?? "inOutCubic"
			});
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
			return p;
		}
		localMatrix(t) {
			const p = this.propsAt(t);
			return multiply(multiply(multiply(translate(p.x, p.y), rotate(p.rotation)), scale(p.scaleX, p.scaleY)), translate(-p.anchorX * p.width, -p.anchorY * p.height));
		}
	};
	// packages/runtime/src/math/svgpath.ts
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
	// packages/runtime/src/graph/three.ts
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
	// packages/runtime/src/graph/kinds.ts
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
	/** Greedy word wrap: each `\n` line is broken at spaces so no line is wider than `maxWidth`; a lone long word keeps its own line. */
	function wrapText(p, m) {
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
			if (p.maxWidth > 0) p.text = wrapText(p, measurer);
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
				loop: false
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
	// packages/runtime/src/composition.ts
	function scene(id, opts, build) {
		return {
			id,
			duration: opts.duration,
			background: opts.background,
			transition: opts.transition,
			build,
			site: (/* @__PURE__ */ new Error()).stack
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
			def.build({
				root,
				width: c.width,
				height: c.height,
				duration: def.duration,
				random: seededRandom(def.id)
			});
			byDef.set(def, root);
		}
		return root;
	}
	// packages/runtime/src/layout/grid.ts
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
	// packages/runtime/src/layout/stack.ts
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
	// packages/runtime/src/evaluate.ts
	/** The node's filters, or undefined when none is on. */
	function activeFilters(p) {
		if (!(p.pixelate > 0 || p.posterize > 0 || p.halftone > 0 || p.outline > 0 || p.chalk > 0 || p.glow > 0)) return void 0;
		const { pixelate, posterize, halftone, outline, outlineColor, chalk, glow, glowIntensity } = p;
		return {
			pixelate,
			posterize,
			halftone,
			outline,
			outlineColor,
			chalk,
			glow,
			glowIntensity
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
			return {
				kind: "video",
				path,
				matrix,
				src: p.src,
				time,
				width: p.width,
				height: p.height,
				fit: p.fit,
				opacity
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
		const filters = activeFilters(p);
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
			if (node instanceof ImageNode || node instanceof VideoNode) srcs.add(node.propsAt(0).src);
			node.children.forEach(walk);
		};
		for (const def of c.scenes) walk(instantiateScene(c, def));
		return [...srcs].sort();
	}
	// packages/runtime/src/manifest.ts
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
				ducking: track.ducking
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
			scenes: scenes.map((span, i) => ({
				...span,
				tree: describe(instantiateScene(c, c.scenes[i]), span, c.fps),
				site: c.scenes[i].site
			})),
			...audioTracks ? { audioTracks } : {}
		};
	}
	// packages/runtime/src/audio/timing.ts
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
	// packages/runtime/src/mockups/window.ts
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
	// packages/runtime/src/mockups/desktop.ts
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
	// packages/runtime/src/mockups/terminal.ts
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
	// packages/runtime/src/mockups/chrome.ts
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
	// packages/runtime/src/mockups/editor.ts
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
	// packages/runtime/src/mockups/cursor.ts
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
	// packages/runtime/src/mockups/focus.ts
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
	// packages/runtime/src/mockups/phone.ts
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
	// packages/runtime/src/mockups/logo.ts
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
	exports.BASE_DEFAULTS = BASE_DEFAULTS;
	exports.ChromeNode = ChromeNode;
	exports.ChromeOmnibox = ChromeOmnibox;
	exports.CircleNode = CircleNode;
	exports.CursorNode = CursorNode;
	exports.DesktopNode = DesktopNode;
	exports.EditorNode = EditorNode;
	exports.GroupNode = GroupNode;
	exports.IDENTITY = IDENTITY;
	exports.ImageNode = ImageNode;
	exports.Node = Node;
	exports.PathNode = PathNode;
	exports.PhoneNode = PhoneNode;
	exports.RectNode = RectNode;
	exports.ShaderNode = ShaderNode;
	exports.TerminalNode = TerminalNode;
	exports.TextNode = TextNode;
	exports.ThreeNode = ThreeNode;
	exports.Track = Track;
	exports.VideoNode = VideoNode;
	exports.VoHelper = VoHelper;
	exports.WindowNode = WindowNode;
	exports.apply = apply;
	exports.applyTransition = applyTransition;
	exports.buildManifest = buildManifest;
	exports.chrome = chrome;
	exports.circle = circle;
	exports.clampFrame = clampFrame;
	exports.collectAssets = collectAssets;
	exports.composition = composition;
	exports.cursor = cursor;
	exports.desktop = desktop;
	exports.ease = ease;
	exports.editor = editor;
	exports.evaluateFrame = evaluateFrame;
	exports.focus = focus;
	exports.formatColor = formatColor;
	exports.group = group;
	exports.image = image;
	exports.instantiateScene = instantiateScene;
	exports.layout = layout;
	exports.layoutComposition = layoutComposition;
	exports.lerpColor = lerpColor;
	exports.logoMark = logoMark;
	exports.multiply = multiply;
	exports.parseColor = parseColor;
	exports.path = path;
	exports.phone = phone;
	exports.rect = rect;
	exports.registerVoTiming = registerVoTiming;
	exports.registerVoTimings = registerVoTimings;
	exports.scene = scene;
	exports.seededRandom = seededRandom;
	exports.setTextMeasurer = setTextMeasurer;
	exports.shader = shader;
	exports.stack = stack;
	exports.terminal = terminal;
	exports.text = text;
	exports.three = three;
	exports.tokyoNightColors = tokyoNightColors;
	exports.transition = transition;
	exports.video = video;
	exports.vo = vo;
	exports.windowNode = windowNode;
	return exports;
})({});
globalThis.__liosvideo = __liosvideo;
