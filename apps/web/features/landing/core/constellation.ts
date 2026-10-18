/**
 * constellation.ts — the B1 constellation's world, as pure numbers (`flows/LANDING.md` §2.7, §3.6).
 *
 * Faint nodes (freelancers) sit on a seeded, stratified layout; a few have gathered into resting
 * teams joined by lines. Near the pointer, nodes drift into a glowing cluster of their own (a team).
 * One reference layout — {@link NODE_COUNT} nodes in the {@link LAYOUT_WIDTH} × {@link LAYOUT_HEIGHT}
 * box, stretched to fit — draws the static SVG on the server and is the live canvas's resting
 * picture, so the crossfade from one to the other changes nothing until the world moves.
 *
 * Nothing here touches the DOM or a GPU: `constellation-gl.ts` feeds {@link stepConstellation} the
 * frame time and the pointer and uploads the buffers it fills; `BackgroundFallback.tsx` renders
 * {@link staticConstellation}. The quiet zones (copy and the search halo) and the luminance clamp
 * that keep text legible over the live background are solved here too, so every rule is a unit test.
 *
 * WCAG 2.2.2: motion has an energy that rises on load and on pointer input and falls to zero
 * {@link SETTLE_SECONDS} after the last one, measured in wall-clock time; with no energy the drift
 * stops, every node eases onto its resting target and {@link stepConstellation} reports the world
 * settled, so the renderer stops drawing until the pointer moves again. Whatever the frame rate, the
 * run ends {@link SETTLE_DEADLINE_SECONDS} after the last input.
 */

// #region Constants
/** The seed every layout grows from; one seed, so SSR, hydration and the canvas agree. */
export const CONSTELLATION_SEED = 0x2840_1b07;

/** The reference box (CSS px) the layout is computed in, then stretched to fit the background. */
export const LAYOUT_WIDTH = 1600;
export const LAYOUT_HEIGHT = 900;

/**
 * The node count, the same for the static SVG and the live canvas: the server cannot know the
 * viewport, and the canvas starts from the server's picture.
 */
export const NODE_COUNT = 64;

/** The most link segments one frame draws. */
export const MAX_LINKS = 96;

/** Links each lit node may start, to its nearest lit neighbours. */
export const LINKS_PER_NODE = 3;

/** The longest frame step the world integrates (s); a jank frame never jumps the picture. */
export const DT_MAX = 1 / 20;

/** Seconds after the last input (load or pointer) that motion holds at full energy. */
export const ENERGY_HOLD_SECONDS = 1.5;

/** Seconds over which energy then falls to zero. */
export const ENERGY_FADE_SECONDS = 2;

/** Energy is zero this long after the last input. */
export const SETTLE_SECONDS = ENERGY_HOLD_SECONDS + ENERGY_FADE_SECONDS;

/**
 * The hard stop, in wall-clock seconds after the last input: every node is placed on its target and
 * its glow on its weight, whatever is left of the ease, so the world is still within five seconds
 * even on a device too slow to finish the ease in time.
 */
export const SETTLE_DEADLINE_SECONDS = 4.6;

/** Seconds energy takes to rise from zero to full, so a resumed drift never jumps. */
export const ENERGY_RISE_SECONDS = 0.5;

/** Exponential follow rate of a node onto its target (1/s). */
export const FOLLOW_RATE = 7;

/** Exponential rate of a node's glow onto its gather weight (1/s). */
export const LIT_RATE = 5;

/** Below this distance (px) from its target, with no energy left, a node is still. */
export const SETTLED_EPSILON = 0.05;

/** The pointer's reach (px): a node this far away does not gather. */
export const GATHER_RADIUS = 220;

/** The share of the way to its team's centre a fully gathered node travels. */
export const GATHER_PULL = 0.62;

/** The longest link, in reference-box px. */
export const LINK_DISTANCE = 150;

/** A node joins the team's lines once its glow passes this. */
export const LINK_MIN_LIT = 0.12;

/** A link fainter than this is not drawn. */
export const LINK_MIN_ALPHA = 0.01;

/** Padding (px) around every run of copy: the quiet zone is the copy column's box + 24px. */
export const COPY_PAD = 24;

/** The search halo box is the field's rect plus this many halo blurs on every side. */
export const HALO_BLUR_FACTOR = 1.5;

/** The most quiet zones the shader takes, and the most of them that may be halo boxes. */
export const MAX_ZONES = 16;
export const MAX_HALO_ZONES = 4;

/** The resting teams' reach (reference-box px): wider than the live pointer's, so each reads. */
export const TEAM_REACH = 320;

/** Where the resting teams have gathered, in the reference box's unit square. */
export const TEAMS: readonly { u: number; v: number }[] = [
	{ u: 0.86, v: 0.3 },
	{ u: 0.11, v: 0.56 },
];
// #endregion

// #region Random
/** A seeded, deterministic PRNG (mulberry32): the same seed yields the same stream on every engine. */
export function createRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function between(rand: () => number, lo: number, hi: number): number {
	return lo + (hi - lo) * rand();
}

/**
 * Euclidean length through `Math.sqrt`, which every engine rounds exactly (`Math.hypot` is only
 * approximated), so the static layout is bit-identical on the server and in every browser.
 */
function distance(dx: number, dy: number): number {
	return Math.sqrt(dx * dx + dy * dy);
}
// #endregion

// #region Layout
/** One node's fixed traits. Homes are in the unit square; sizes and amplitudes in CSS px. */
export interface NodeSeed {
	u: number;
	v: number;
	/** Core radius (px). */
	radius: number;
	/** Brightness multiplier of the node's alpha, 0.35–1. */
	tone: number;
	/** Drift amplitude (px). */
	amp: number;
	/** Drift angular frequencies (rad/s) and phases. */
	fx: number;
	fy: number;
	px: number;
	py: number;
}

/**
 * Lay `count` nodes on a jittered grid shaped to `aspect` (width / height), cells shuffled by the
 * seed, so nodes spread evenly without clumping and the same inputs give the same layout everywhere.
 */
export function layoutNodes(seed: number, count: number, aspect: number): NodeSeed[] {
	const rand = createRandom(seed);
	const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
	const cols = Math.max(1, Math.ceil(Math.sqrt(count * ratio)));
	const rows = Math.max(1, Math.ceil(count / cols));
	const cells: number[] = [];
	for (let i = 0; i < cols * rows; i++) cells.push(i);
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const swap = cells[i];
		cells[i] = cells[j];
		cells[j] = swap;
	}
	const nodes: NodeSeed[] = [];
	for (let i = 0; i < count; i++) {
		const cell = cells[i];
		const col = cell % cols;
		const row = Math.floor(cell / cols);
		const size = rand();
		nodes.push({
			u: (col + between(rand, 0.15, 0.85)) / cols,
			v: (row + between(rand, 0.15, 0.85)) / rows,
			radius: 0.9 + 1.1 * size * size,
			tone: between(rand, 0.35, 1),
			amp: between(rand, 4, 14),
			fx: between(rand, 0.18, 0.46),
			fy: between(rand, 0.18, 0.46),
			px: between(rand, 0, Math.PI * 2),
			py: between(rand, 0, Math.PI * 2),
		});
	}
	return nodes;
}

/** Hermite smoothstep between `edge0` and `edge1` (either order). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge0 === edge1) return x < edge0 ? 0 : 1;
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** How strongly a node `distance` px from the pointer gathers: 1 near it, 0 at `reach`. */
export function gatherWeight(distance: number, reach: number = GATHER_RADIUS): number {
	return smoothstep(reach, reach * 0.25, distance);
}

/** The reference layout: every node's seed and the resting team it has gathered into, if any. */
export interface RestingLayout {
	readonly seeds: readonly NodeSeed[];
	/** Resting position in the unit square: the home pulled towards its team's centre. */
	readonly u: Float64Array;
	readonly v: Float64Array;
	/** The resting team's centre in the unit square; a node with no team carries its own home. */
	readonly teamU: Float64Array;
	readonly teamV: Float64Array;
	/** Resting glow, 0–1: the node's gather weight towards its team. */
	readonly lit: Float64Array;
}

/**
 * The {@link NODE_COUNT} nodes laid out in the reference box, each gathered towards the nearest of
 * the {@link TEAMS} within {@link TEAM_REACH} as the live world would under a resting pointer.
 * Arithmetic and the integer PRNG only — no `Math.sin` — so every engine agrees exactly.
 */
export function restingLayout(seed: number = CONSTELLATION_SEED): RestingLayout {
	const seeds = layoutNodes(seed, NODE_COUNT, LAYOUT_WIDTH / LAYOUT_HEIGHT);
	const u = new Float64Array(seeds.length);
	const v = new Float64Array(seeds.length);
	const teamU = new Float64Array(seeds.length);
	const teamV = new Float64Array(seeds.length);
	const lit = new Float64Array(seeds.length);
	seeds.forEach((s, i) => {
		const hx = s.u * LAYOUT_WIDTH;
		const hy = s.v * LAYOUT_HEIGHT;
		let best = 0;
		let tu = s.u;
		let tv = s.v;
		for (const t of TEAMS) {
			const w = gatherWeight(
				distance(t.u * LAYOUT_WIDTH - hx, t.v * LAYOUT_HEIGHT - hy),
				TEAM_REACH,
			);
			if (w > best) {
				best = w;
				tu = t.u;
				tv = t.v;
			}
		}
		u[i] = s.u + (tu - s.u) * GATHER_PULL * best;
		v[i] = s.v + (tv - s.v) * GATHER_PULL * best;
		teamU[i] = tu;
		teamV[i] = tv;
		lit[i] = best;
	});
	return { seeds, u, v, teamU, teamV, lit };
}
// #endregion

// #region Links
/** Scratch storage {@link buildLinks} reuses, so a frame allocates nothing. */
export interface LinkScratch {
	/** Indices of the nodes lit enough to link. */
	readonly lits: Int32Array;
	/** The current node's nearest lit neighbours, nearest first, and their distances. */
	readonly nearJ: Int32Array;
	readonly nearD: Float64Array;
	/** One flag per node pair already joined this pass, cleared again before returning. */
	readonly seen: Uint8Array;
	/** The pair key of every segment written, so `seen` is cleared without a sweep. */
	readonly pairs: Int32Array;
}

/** Scratch for {@link buildLinks} over up to `count` nodes. */
export function createLinkScratch(count: number): LinkScratch {
	const n = Math.max(1, Math.floor(count));
	return {
		lits: new Int32Array(n),
		nearJ: new Int32Array(LINKS_PER_NODE),
		nearD: new Float64Array(LINKS_PER_NODE),
		seen: new Uint8Array(n * n),
		pairs: new Int32Array(MAX_LINKS),
	};
}

/**
 * Join each lit node to up to {@link LINKS_PER_NODE} nearest lit neighbours within
 * {@link LINK_DISTANCE}, at most {@link MAX_LINKS} segments. Distances are measured in the reference
 * box: `scaleX` / `scaleY` convert a position's CSS px to it (`LAYOUT_WIDTH / width`), so a stretched
 * world keeps the static picture's lines. Writes `x1, y1, x2, y2, alpha` per segment into `out` and
 * returns the count. `scratch` must have been made for at least `count` nodes.
 */
export function buildLinks(
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	lit: ArrayLike<number>,
	count: number,
	out: Float32Array,
	scratch: LinkScratch = createLinkScratch(count),
	scaleX = 1,
	scaleY = 1,
): number {
	const { lits, nearJ, nearD, seen, pairs } = scratch;
	let litCount = 0;
	for (let i = 0; i < count; i++) if (lit[i] > LINK_MIN_LIT) lits[litCount++] = i;
	let n = 0;
	outer: for (let a = 0; a < litCount; a++) {
		const i = lits[a];
		let near = 0;
		for (let b = 0; b < litCount; b++) {
			const j = lits[b];
			if (j === i) continue;
			const d = distance((xs[j] - xs[i]) * scaleX, (ys[j] - ys[i]) * scaleY);
			if (d >= LINK_DISTANCE) continue;
			if (near === LINKS_PER_NODE && !(d < nearD[near - 1])) continue;
			if (near < LINKS_PER_NODE) near += 1;
			let p = near - 1;
			while (p > 0 && d < nearD[p - 1]) {
				nearD[p] = nearD[p - 1];
				nearJ[p] = nearJ[p - 1];
				p -= 1;
			}
			nearD[p] = d;
			nearJ[p] = j;
		}
		for (let k = 0; k < near; k++) {
			const j = nearJ[k];
			const d = nearD[k];
			const key = i < j ? i * count + j : j * count + i;
			if (seen[key]) continue;
			const fade = 1 - d / LINK_DISTANCE;
			const alpha = Math.min(lit[i], lit[j]) * fade * Math.sqrt(fade);
			if (alpha < LINK_MIN_ALPHA) continue;
			if (n >= MAX_LINKS) break outer;
			seen[key] = 1;
			pairs[n] = key;
			const o = n * 5;
			out[o] = xs[i];
			out[o + 1] = ys[i];
			out[o + 2] = xs[j];
			out[o + 3] = ys[j];
			out[o + 4] = alpha;
			n += 1;
		}
	}
	for (let k = 0; k < n; k++) seen[pairs[k]] = 0;
	return n;
}
// #endregion

// #region Static fallback
/** One node of the static SVG, positioned in percent of the background box. */
export interface StaticNode {
	cx: string;
	cy: string;
	r: string;
	opacity: string;
}

/** One line of the static SVG, positioned in percent of the background box. */
export interface StaticLink {
	x1: string;
	y1: string;
	x2: string;
	y2: string;
	opacity: string;
}

/** The static constellation: every node, with each team already gathered and joined. */
export interface StaticConstellation {
	nodes: StaticNode[];
	links: StaticLink[];
}

const pct = (value: number, of: number) => `${(value / of * 100).toFixed(2)}%`;
const fixed = (value: number) => value.toFixed(2);

/**
 * The B1 fallback: the {@link restingLayout} drawn as the live canvas draws it at rest. Strings,
 * rounded, from arithmetic and the integer PRNG only — no `Math.sin` — so the server and every
 * client engine agree exactly.
 */
export function staticConstellation(seed: number = CONSTELLATION_SEED): StaticConstellation {
	const rest = restingLayout(seed);
	const count = rest.seeds.length;
	const xs = new Float64Array(count);
	const ys = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		xs[i] = rest.u[i] * LAYOUT_WIDTH;
		ys[i] = rest.v[i] * LAYOUT_HEIGHT;
	}
	const buffer = new Float32Array(MAX_LINKS * 5);
	const linkCount = buildLinks(xs, ys, rest.lit, count, buffer);
	const nodes = rest.seeds.map((s, i) => ({
		cx: pct(xs[i], LAYOUT_WIDTH),
		cy: pct(ys[i], LAYOUT_HEIGHT),
		r: fixed(s.radius * (1 + 0.6 * rest.lit[i])),
		opacity: fixed(s.tone * 0.7 + (1 - s.tone * 0.7) * rest.lit[i]),
	}));
	const links: StaticLink[] = [];
	for (let k = 0; k < linkCount; k++) {
		const o = k * 5;
		links.push({
			x1: pct(buffer[o], LAYOUT_WIDTH),
			y1: pct(buffer[o + 1], LAYOUT_HEIGHT),
			x2: pct(buffer[o + 2], LAYOUT_WIDTH),
			y2: pct(buffer[o + 3], LAYOUT_HEIGHT),
			opacity: fixed(buffer[o + 4]),
		});
	}
	return { nodes, links };
}
// #endregion

// #region Live world
/** A pointer position in the background's CSS px, or `null` when the pointer is not over it. */
export interface Pointer {
	x: number;
	y: number;
}

/**
 * The seconds a frame at `now` (ms) advances the world, given the previous frame's timestamp, or
 * `null` when the loop has just (re)started — that first frame advances nothing.
 */
export function frameSeconds(last: number | null, now: number): number {
	return last === null ? 0 : (now - last) / 1000;
}

/** The live constellation's mutable world. Buffers are allocated once and reused every frame. */
export interface ConstellationState {
	readonly seeds: readonly NodeSeed[];
	readonly count: number;
	width: number;
	height: number;
	/** The resting picture: positions in the unit square, team centres, and glow. */
	readonly restU: Float64Array;
	readonly restV: Float64Array;
	readonly teamU: Float64Array;
	readonly teamV: Float64Array;
	readonly restLit: Float64Array;
	/** Current positions (px). */
	readonly x: Float32Array;
	readonly y: Float32Array;
	/** Current glow, 0–1. */
	readonly lit: Float32Array;
	/** Seconds of drift time elapsed (advances only with energy). */
	clock: number;
	/** Motion energy, 0–1. */
	energy: number;
	/** Wall-clock seconds since the last input (load or pointer). */
	idle: number;
	/** No energy left and every node on its target: nothing to draw until the next input. */
	settled: boolean;
	/** Per node: `x, y, radius, alpha, lit` — the instance buffer the renderer uploads. */
	readonly nodeData: Float32Array;
	/** Per link: `x1, y1, x2, y2, alpha`. */
	readonly linkData: Float32Array;
	linkCount: number;
	/** {@link buildLinks}'s scratch. */
	readonly linkScratch: LinkScratch;
}

/**
 * Build the world for a `width` × `height` background, at rest on the static picture (every resting
 * team gathered and joined), with the load's idle drift ahead of it.
 */
export function createConstellation(
	width: number,
	height: number,
	seed: number = CONSTELLATION_SEED,
): ConstellationState {
	const rest = restingLayout(seed);
	const count = rest.seeds.length;
	const state: ConstellationState = {
		seeds: rest.seeds,
		count,
		width: Math.max(1, width),
		height: Math.max(1, height),
		restU: rest.u,
		restV: rest.v,
		teamU: rest.teamU,
		teamV: rest.teamV,
		restLit: rest.lit,
		x: new Float32Array(count),
		y: new Float32Array(count),
		lit: new Float32Array(count),
		clock: 0,
		energy: 0,
		idle: 0,
		settled: false,
		nodeData: new Float32Array(count * 5),
		linkData: new Float32Array(MAX_LINKS * 5),
		linkCount: 0,
		linkScratch: createLinkScratch(count),
	};
	for (let i = 0; i < count; i++) {
		state.x[i] = rest.u[i] * state.width;
		state.y[i] = rest.v[i] * state.height;
		state.lit[i] = rest.lit[i];
	}
	writeNodeData(state);
	writeLinks(state);
	return state;
}

/** Fit the world to a new box: positions scale with it, the node count stays. */
export function resizeConstellation(
	state: ConstellationState,
	width: number,
	height: number,
): void {
	if (width <= 0 || height <= 0) return;
	const sx = width / Math.max(1, state.width);
	const sy = height / Math.max(1, state.height);
	for (let i = 0; i < state.count; i++) {
		state.x[i] *= sx;
		state.y[i] *= sy;
	}
	state.width = width;
	state.height = height;
	state.settled = false;
	writeNodeData(state);
	writeLinks(state);
}

/** Pointer input: restart the energy clock (motion resumes only on pointer movement). */
export function pokeConstellation(state: ConstellationState): void {
	state.idle = 0;
	state.settled = false;
}

/** The energy the world is heading for, `idle` seconds after the last input. */
export function energyTarget(idle: number): number {
	if (idle <= ENERGY_HOLD_SECONDS) return 1;
	return Math.max(0, 1 - (idle - ENERGY_HOLD_SECONDS) / ENERGY_FADE_SECONDS);
}

function writeNodeData(state: ConstellationState): void {
	const out = state.nodeData;
	for (let i = 0; i < state.count; i++) {
		const s = state.seeds[i];
		const lit = state.lit[i];
		const o = i * 5;
		out[o] = state.x[i];
		out[o + 1] = state.y[i];
		out[o + 2] = s.radius * (1 + 0.6 * lit);
		out[o + 3] = s.tone * 0.7 + (1 - s.tone * 0.7) * lit;
		out[o + 4] = lit;
	}
}

function writeLinks(state: ConstellationState): void {
	state.linkCount = buildLinks(
		state.x,
		state.y,
		state.lit,
		state.count,
		state.linkData,
		state.linkScratch,
		LAYOUT_WIDTH / state.width,
		LAYOUT_HEIGHT / state.height,
	);
}

/**
 * Advance the world by `dt` wall-clock seconds with the pointer at `pointer`, fill the node and link
 * buffers, and return `true` while anything is still moving. The motion integrates at most
 * {@link DT_MAX} per call, but the settle clock runs on `dt` itself, so a slow device still stops in
 * time. A zero (or broken) step advances nothing and reports the world as moving, so a renderer's
 * first frame never mistakes an unstarted world for a settled one. A settled world returns `false`
 * and stays untouched until {@link pokeConstellation} or a resize.
 */
export function stepConstellation(
	state: ConstellationState,
	dt: number,
	pointer: Pointer | null,
): boolean {
	if (state.settled) return false;
	const wall = Number.isFinite(dt) && dt > 0 ? dt : 0;
	if (wall === 0) return true;
	const step = Math.min(DT_MAX, wall);
	state.idle += wall;
	const target = energyTarget(state.idle);
	state.energy = target > state.energy
		? Math.min(target, state.energy + step / ENERGY_RISE_SECONDS)
		: target;
	state.clock += step * state.energy;

	const follow = 1 - Math.exp(-FOLLOW_RATE * step);
	const glow = 1 - Math.exp(-LIT_RATE * step);
	const still = state.energy === 0;
	const deadline = state.idle >= SETTLE_DEADLINE_SECONDS;
	const w = state.width;
	const h = state.height;
	let moving = !still;
	for (let i = 0; i < state.count; i++) {
		const s = state.seeds[i];
		const drift = s.amp * state.energy;
		const bx = s.u * w + drift * Math.sin(s.fx * state.clock + s.px);
		const by = s.v * h + drift * Math.cos(s.fy * state.clock + s.py);
		const rest = state.restLit[i];
		const reach = pointer ? gatherWeight(distance(pointer.x - bx, pointer.y - by)) : 0;
		const toPointer = pointer !== null && reach > rest;
		const weight = toPointer ? reach : rest;
		const ax = toPointer ? pointer.x : state.teamU[i] * w;
		const ay = toPointer ? pointer.y : state.teamV[i] * h;
		const dl = weight - state.lit[i];
		const litDone = deadline || (still && Math.abs(dl) < 1e-3);
		state.lit[i] = litDone ? weight : state.lit[i] + dl * glow;
		if (!litDone) moving = true;
		const pull = GATHER_PULL * state.lit[i];
		const tx = bx + (ax - bx) * pull;
		const ty = by + (ay - by) * pull;
		const dx = tx - state.x[i];
		const dy = ty - state.y[i];
		const placed = deadline ||
			(still && Math.abs(dx) < SETTLED_EPSILON && Math.abs(dy) < SETTLED_EPSILON);
		if (placed) {
			state.x[i] = tx;
			state.y[i] = ty;
		} else {
			state.x[i] += dx * follow;
			state.y[i] += dy * follow;
			moving = true;
		}
	}
	writeNodeData(state);
	writeLinks(state);
	state.settled = !moving;
	return moving;
}
// #endregion

// #region Quiet zones
/** An axis-aligned box in the background's CSS px. */
export interface ZoneRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** A quiet zone: `copy` caps the constellation at the quiet alpha, `halo` clears it. */
export interface Zone extends ZoneRect {
	kind: "copy" | "halo";
}

function area(r: ZoneRect): number {
	return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

function union(a: ZoneRect, b: ZoneRect): ZoneRect {
	return {
		x0: Math.min(a.x0, b.x0),
		y0: Math.min(a.y0, b.y0),
		x1: Math.max(a.x1, b.x1),
		y1: Math.max(a.y1, b.y1),
	};
}

function contains(outer: ZoneRect, inner: ZoneRect): boolean {
	return outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 &&
		outer.y1 >= inner.y1;
}

/**
 * Reduce `rects` to at most `max` boxes that still cover every one of them: boxes inside another are
 * dropped, then the pair whose union adds the least uncovered area is merged until the count fits.
 * The result always covers the input — a merge only ever grows a quiet zone.
 */
export function mergeRects(rects: readonly ZoneRect[], max: number): ZoneRect[] {
	let out = rects.filter((r) => area(r) > 0).map((r) => ({ ...r }));
	out = out.filter((r, i) =>
		!out.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i))
	);
	const limit = Math.max(1, Math.floor(max));
	while (out.length > limit) {
		let bi = 0;
		let bj = 1;
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < out.length; i++) {
			for (let j = i + 1; j < out.length; j++) {
				const growth = area(union(out[i], out[j])) - area(out[i]) - area(out[j]);
				if (growth < best) {
					best = growth;
					bi = i;
					bj = j;
				}
			}
		}
		const merged = union(out[bi], out[bj]);
		out = out.filter((_, k) => k !== bi && k !== bj);
		out = out.filter((r) => !contains(merged, r));
		out.push(merged);
	}
	return out;
}

/** Inputs for {@link buildZones}: raw boxes measured in the background's CSS px. */
export interface ZoneInput {
	/** Boxes of copy (text runs, explicit `data-lp-quiet` regions), unpadded. */
	copy: readonly ZoneRect[];
	/** Search field boxes, unpadded. */
	halo: readonly ZoneRect[];
	/** The resolved `--lp-halo-blur` (px). */
	haloBlur: number;
	/** The background box. */
	width: number;
	height: number;
}

/**
 * The quiet zones the constellation honours: copy boxes padded by {@link COPY_PAD}, search fields
 * padded by {@link HALO_BLUR_FACTOR} × the halo blur, both clipped to the background, merged to fit
 * {@link MAX_ZONES} (halo boxes first, at most {@link MAX_HALO_ZONES}). Halo zones come last so a
 * painter that draws them in order leaves the halo clear wherever the two overlap.
 */
export function buildZones(input: ZoneInput): Zone[] {
	const clip = (r: ZoneRect, pad: number): ZoneRect => ({
		x0: Math.max(0, r.x0 - pad),
		y0: Math.max(0, r.y0 - pad),
		x1: Math.min(input.width, r.x1 + pad),
		y1: Math.min(input.height, r.y1 + pad),
	});
	const haloPad = Math.max(0, input.haloBlur) * HALO_BLUR_FACTOR;
	const halo = mergeRects(input.halo.map((r) => clip(r, haloPad)), MAX_HALO_ZONES);
	const copy = mergeRects(input.copy.map((r) => clip(r, COPY_PAD)), MAX_ZONES - halo.length);
	return [
		...copy.map((r) => ({ ...r, kind: "copy" as const })),
		...halo.map((r) => ({ ...r, kind: "halo" as const })),
	];
}
// #endregion

// #region Colour limits
/** A straight sRGB colour, each channel 0–1. */
export type Rgb = readonly [number, number, number];

function linear(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(c: Rgb): number {
	return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
}

/** `ink` at `alpha` over `bg`, blended the way the browser composites the canvas (sRGB). */
export function composite(bg: Rgb, ink: Rgb, alpha: number): Rgb {
	return [
		bg[0] + (ink[0] - bg[0]) * alpha,
		bg[1] + (ink[1] - bg[1]) * alpha,
		bg[2] + (ink[2] - bg[2]) * alpha,
	];
}

/**
 * The largest alpha of `ink` over `bg` that keeps the composite's luminance on `bg`'s side of
 * `limit`: at or below it when the ink is brighter (dark canvas, a ceiling), at or above it when the
 * ink is darker (light canvas, a floor). Walked in 1/512 steps, so it holds even where the
 * composite's luminance is not monotonic in alpha; 0 when `bg` itself is already past the limit.
 */
export function luminanceCap(bg: Rgb, ink: Rgb, limit: number): number {
	const base = relativeLuminance(bg);
	const ceiling = relativeLuminance(ink) >= base;
	const ok = (lum: number) => (ceiling ? lum <= limit : lum >= limit);
	if (!ok(base)) return 0;
	const steps = 512;
	let cap = 0;
	for (let k = 1; k <= steps; k++) {
		const alpha = k / steps;
		if (!ok(relativeLuminance(composite(bg, ink, alpha)))) break;
		cap = alpha;
	}
	return cap;
}

/** The constellation's colours and alpha tokens, as the cascade resolves them. */
export interface ConstellationPalette {
	/** `--lp-node`. */
	node: Rgb;
	/** `--lp-bg`, the canvas the copy sits on. */
	bg: Rgb;
	/** `--lp-node-alpha`, `--lp-node-alpha-quiet`, `--lp-node-alpha-halo`. */
	alpha: number;
	quietAlpha: number;
	haloAlpha: number;
	/** `--lp-bg-lum-max` — a ceiling on a dark canvas, a floor on a light one. */
	lumLimit: number;
}

/** The alpha ceilings the renderer applies: everywhere, inside copy zones, inside halo zones. */
export interface ZoneCaps {
	full: number;
	copy: number;
	halo: number;
}

/**
 * Solve the three alpha ceilings: the open field takes `--lp-node-alpha`; copy takes the lower of
 * `--lp-node-alpha-quiet` and the luminance clamp; the halo takes the lower of `--lp-node-alpha-halo`
 * and the copy ceiling. Every value is clamped to 0–1.
 */
export function zoneCaps(p: ConstellationPalette): ZoneCaps {
	const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
	const full = unit(p.alpha);
	const copy = Math.min(full, unit(p.quietAlpha), luminanceCap(p.bg, p.node, p.lumLimit));
	const halo = Math.min(copy, unit(p.haloAlpha));
	return { full, copy, halo };
}
// #endregion

// #region Frame watchdog
/** Frames discarded after the canvas starts (program link, first uploads). */
export const WATCHDOG_WARMUP_FRAMES = 30;

/** Frame intervals the watchdog samples once, before judging. */
export const WATCHDOG_SAMPLE_FRAMES = 120;

/** A 95th-percentile frame interval (ms) above this tears the canvas down. */
export const WATCHDOG_P95_BUDGET_MS = 40;

/** The `p` (0–1) percentile of `samples`, nearest-rank; `NaN` for no samples. */
export function percentile(samples: readonly number[], p: number): number {
	if (samples.length === 0) return Number.NaN;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
	return sorted[rank - 1];
}
// #endregion
