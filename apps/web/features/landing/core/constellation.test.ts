/**
 * constellation.test — the B1 world: seeded layout, the live world starting from the static picture,
 * the settle rule (WCAG 2.2.2: still within five wall-clock seconds of the last input, from the
 * renderer's first frame and on a slow device), gathering, links, the static fallback's determinism,
 * quiet-zone merging and the luminance clamp (`flows/LANDING.md` §2.7, §3.2, §3.6).
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	buildLinks,
	buildZones,
	composite,
	CONSTELLATION_SEED,
	createConstellation,
	createLinkScratch,
	createRandom,
	DT_MAX,
	energyTarget,
	frameSeconds,
	GATHER_RADIUS,
	LAYOUT_HEIGHT,
	LAYOUT_WIDTH,
	layoutNodes,
	LINK_DISTANCE,
	LINKS_PER_NODE,
	luminanceCap,
	MAX_HALO_ZONES,
	MAX_LINKS,
	MAX_ZONES,
	mergeRects,
	NODE_COUNT,
	percentile,
	pokeConstellation,
	relativeLuminance,
	resizeConstellation,
	restingLayout,
	type Rgb,
	SETTLE_DEADLINE_SECONDS,
	SETTLE_SECONDS,
	staticConstellation,
	stepConstellation,
	zoneCaps,
	type ZoneRect,
} from "./constellation.ts";

// #region Helpers
const FRAME = 1 / 60;

/** Step `seconds` of frames; return the time (s) the world first reported settled, or `null`. */
function runUntilSettled(
	state: ReturnType<typeof createConstellation>,
	seconds: number,
	pointer: { x: number; y: number } | null,
): number | null {
	let t = 0;
	while (t < seconds) {
		t += FRAME;
		if (!stepConstellation(state, FRAME, pointer)) return t;
	}
	return null;
}

function hex(value: string): Rgb {
	const n = Number.parseInt(value.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Every value of `actual` within `eps` of `expected` (Float32 storage rounds differently by path). */
function assertClose(
	actual: ArrayLike<number>,
	expected: ArrayLike<number>,
	eps: number,
	msg = "",
) {
	assertEquals(actual.length, expected.length, msg);
	for (let i = 0; i < actual.length; i++) assertAlmostEquals(actual[i], expected[i], eps, msg);
}

function rect(x0: number, y0: number, x1: number, y1: number): ZoneRect {
	return { x0, y0, x1, y1 };
}

function covers(outer: readonly ZoneRect[], inner: ZoneRect): boolean {
	return outer.some((o) =>
		o.x0 <= inner.x0 && o.y0 <= inner.y0 && o.x1 >= inner.x1 && o.y1 >= inner.y1
	);
}
// #endregion

// #region Random and layout
Deno.test("random: one seed, one stream; values stay in [0, 1)", () => {
	const a = createRandom(42);
	const b = createRandom(42);
	const c = createRandom(43);
	const seqA = Array.from({ length: 64 }, a);
	assertEquals(seqA, Array.from({ length: 64 }, b));
	assert(seqA.some((v, i) => v !== Array.from({ length: 64 }, c)[i]));
	for (const v of seqA) assert(v >= 0 && v < 1);
});

Deno.test("layout: deterministic, inside the unit square, one node per stratified cell", () => {
	const one = layoutNodes(CONSTELLATION_SEED, 80, 16 / 9);
	assertEquals(one, layoutNodes(CONSTELLATION_SEED, 80, 16 / 9));
	assertEquals(one.length, 80);
	for (const n of one) {
		assert(n.u > 0 && n.u < 1 && n.v > 0 && n.v < 1);
		assert(n.tone >= 0.35 && n.tone <= 1);
		assert(n.radius >= 0.9 && n.radius <= 2);
	}
	const cols = Math.ceil(Math.sqrt(80 * 16 / 9));
	const rows = Math.ceil(80 / cols);
	const cells = new Set(one.map((n) => Math.floor(n.u * cols) + Math.floor(n.v * rows) * cols));
	assertEquals(cells.size, 80);
});

Deno.test("the live world starts on the static picture at any box size", () => {
	const picture = staticConstellation();
	for (const [w, h] of [[1600, 900], [1280, 800], [375, 812], [1920, 640]]) {
		const s = createConstellation(w, h);
		assertEquals(s.count, NODE_COUNT);
		assertEquals(s.count, picture.nodes.length);
		for (let i = 0; i < s.count; i++) {
			assertAlmostEquals(s.x[i] / w * 100, Number.parseFloat(picture.nodes[i].cx), 0.006);
			assertAlmostEquals(s.y[i] / h * 100, Number.parseFloat(picture.nodes[i].cy), 0.006);
			assertAlmostEquals(s.nodeData[i * 5 + 3], Number(picture.nodes[i].opacity), 0.006);
		}
		assertEquals(s.linkCount, picture.links.length, `${w}×${h} draws the same team lines`);
	}
});
// #endregion

// #region Settle rule
Deno.test("energy holds, then falls to zero at SETTLE_SECONDS", () => {
	assertEquals(energyTarget(0), 1);
	assertEquals(energyTarget(1.5), 1);
	assertAlmostEquals(energyTarget(2.5), 0.5, 1e-9);
	assertEquals(energyTarget(SETTLE_SECONDS), 0);
	assertEquals(energyTarget(60), 0);
});

Deno.test("settle: the idle drift after load is still within five seconds", () => {
	const s = createConstellation(1280, 800);
	const settledAt = runUntilSettled(s, 10, null);
	assert(settledAt !== null && settledAt <= 5, `settled at ${settledAt}`);
	assertEquals(s.settled, true);
	const before = s.nodeData.slice();
	assertEquals(stepConstellation(s, FRAME, null), false);
	assertEquals(s.nodeData, before);
	assertClose(s.nodeData, createConstellation(1280, 800).nodeData, 1e-3, "it rests on the picture");
});

Deno.test("settle: driven as the renderer drives it, the load drift runs, then stops in time", () => {
	const s = createConstellation(1280, 800);
	const start = s.nodeData.slice();
	let last: number | null = null;
	let now = 1000;
	let frames = 0;
	let moved = false;
	let settledAt: number | null = null;
	while (now < 1000 + 10_000) {
		const moving = stepConstellation(s, frameSeconds(last, now), null);
		frames += 1;
		if (frames === 1) assertEquals(moving, true, "the first frame (dt 0) never settles the world");
		if (s.nodeData.some((v, i) => Math.abs(v - start[i]) > 0.5)) moved = true;
		if (!moving) {
			settledAt = (now - 1000) / 1000;
			break;
		}
		last = now;
		now += 1000 / 60;
	}
	assert(moved, "the nodes drifted after load");
	assert(settledAt !== null && settledAt <= 5, `settled at ${settledAt}`);
	assertEquals(frameSeconds(null, 5000), 0);
	assertAlmostEquals(frameSeconds(5000, 5016), 0.016, 1e-9);
});

Deno.test("settle: a slow or janky device is still within five wall-clock seconds", () => {
	for (const dt of [0.1, 0.25]) {
		const s = createConstellation(1280, 800);
		pokeConstellation(s);
		let t = 0;
		while (stepConstellation(s, dt, { x: 640, y: 300 })) t += dt;
		assert(t <= SETTLE_DEADLINE_SECONDS + dt && t <= 5, `settled after ${t}s at ${dt}s frames`);
	}
});

Deno.test("settle: a resting pointer keeps its team, and the world is still within five seconds", () => {
	const s = createConstellation(1280, 800);
	const pointer = { x: 900, y: 300 };
	pokeConstellation(s);
	const settledAt = runUntilSettled(s, 10, pointer);
	assert(settledAt !== null && settledAt <= 5, `settled at ${settledAt}`);
	assert(s.linkCount > 0, "a gathered team is joined by lines");
	let lit = 0;
	for (let i = 0; i < s.count; i++) if (s.lit[i] > 0.5) lit += 1;
	assert(lit >= 3, `team of ${lit}`);
});

Deno.test("settle: motion resumes only on pointer input, and settles again", () => {
	const s = createConstellation(1280, 800);
	runUntilSettled(s, 10, null);
	for (let k = 0; k < 120; k++) assertEquals(stepConstellation(s, FRAME, null), false);
	pokeConstellation(s);
	assertEquals(stepConstellation(s, FRAME, { x: 200, y: 200 }), true);
	const again = runUntilSettled(s, 10, { x: 200, y: 200 });
	assert(again !== null && again <= 5, `settled again at ${again}`);
});

Deno.test("settle: a jank frame integrates at most DT_MAX; a broken dt advances nothing", () => {
	const a = createConstellation(1280, 800);
	const b = createConstellation(1280, 800);
	stepConstellation(a, 0.3, null);
	stepConstellation(b, DT_MAX, null);
	assertEquals(a.nodeData, b.nodeData);
	assertAlmostEquals(a.idle, 0.3, 1e-9);

	const c = createConstellation(1280, 800);
	const before = c.nodeData.slice();
	assertEquals(stepConstellation(c, Number.NaN, null), true);
	assertEquals(stepConstellation(c, -1, null), true);
	assertEquals(c.idle, 0);
	assertEquals(c.nodeData, before);

	const d = createConstellation(1280, 800);
	assertEquals(stepConstellation(d, 60, null), false, "a minute-long frame is past the deadline");
	assertClose(d.nodeData, before, 1e-3, "and lands on the resting picture");
	for (const v of d.nodeData) assert(Number.isFinite(v));
});
// #endregion

// #region Gathering and links
Deno.test("gathering: nodes near the pointer move towards it and light up; far ones keep their rest", () => {
	const s = createConstellation(1280, 800);
	const pointer = { x: 640, y: 400 };
	pokeConstellation(s);
	for (let k = 0; k < 90; k++) stepConstellation(s, FRAME, pointer);
	let gathered = 0;
	for (let i = 0; i < s.count; i++) {
		const hx = s.seeds[i].u * 1280;
		const hy = s.seeds[i].v * 800;
		const home = Math.hypot(hx - pointer.x, hy - pointer.y);
		const now = Math.hypot(s.x[i] - pointer.x, s.y[i] - pointer.y);
		if (home < GATHER_RADIUS * 0.4) {
			gathered += 1;
			assert(now < home, `node ${i} gathered`);
			assert(s.lit[i] > 0.5, `node ${i} lit`);
		}
		if (home > GATHER_RADIUS + 20) {
			assertAlmostEquals(s.lit[i], s.restLit[i], 0.02, `node ${i} keeps its resting glow`);
		}
	}
	assert(gathered > 0, "the pointer sits over some nodes");
});

Deno.test("resting teams: the static picture's teams are lit, joined, and survive the drift", () => {
	const rest = restingLayout();
	const teamed = [...rest.lit].filter((l) => l > 0.5).length;
	assert(teamed >= 3, `${teamed} nodes rest in a team`);
	const s = createConstellation(1600, 900);
	runUntilSettled(s, 10, null);
	for (let i = 0; i < s.count; i++) assertAlmostEquals(s.lit[i], rest.lit[i], 1e-6);
	assert(s.linkCount > 0, "the teams are joined by lines at rest");
});

Deno.test("links: reusable scratch gives the same answer as a fresh one, frame after frame", () => {
	const s = createConstellation(1600, 900);
	pokeConstellation(s);
	const scratch = createLinkScratch(s.count);
	const a = new Float32Array(MAX_LINKS * 5);
	const b = new Float32Array(MAX_LINKS * 5);
	for (let k = 0; k < 40; k++) {
		stepConstellation(s, FRAME, { x: 500 + k * 4, y: 420 });
		const n = buildLinks(s.x, s.y, s.lit, s.count, a, scratch);
		assertEquals(n, buildLinks(s.x, s.y, s.lit, s.count, b));
		assertEquals(a.slice(0, n * 5), b.slice(0, n * 5));
		assert(scratch.seen.every((v) => v === 0), "the pair flags are cleared after every pass");
	}
});

Deno.test("links: each node starts at most LINKS_PER_NODE, nearest first", () => {
	const xs = new Float32Array([0, 10, 20, 30, 40]);
	const ys = new Float32Array(5);
	const lit = new Float32Array(5).fill(1);
	const out = new Float32Array(MAX_LINKS * 5);
	const n = buildLinks(xs, ys, lit, 5, out);
	const starts = new Map<number, number>();
	for (let k = 0; k < n; k++) starts.set(out[k * 5], (starts.get(out[k * 5]) ?? 0) + 1);
	for (const c of starts.values()) assert(c <= LINKS_PER_NODE);
	assertEquals([out[0], out[2]], [0, 10], "the first segment joins node 0 to its nearest");
	const scale = LAYOUT_WIDTH / 100;
	assert(10 * scale >= LINK_DISTANCE, "10 px in a 100 px box is past the link reach");
	assertEquals(
		buildLinks(xs, ys, lit, 5, out, createLinkScratch(5), scale, LAYOUT_HEIGHT / 100),
		0,
		"distances are judged in the reference box",
	);
});

Deno.test("links: only between lit nodes, never longer than LINK_DISTANCE, capped", () => {
	const count = 60;
	const xs = new Float32Array(count);
	const ys = new Float32Array(count);
	const lit = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		xs[i] = 100 + (i % 8) * 12;
		ys[i] = 100 + Math.floor(i / 8) * 12;
		lit[i] = i < 50 ? 1 : 0;
	}
	const out = new Float32Array(MAX_LINKS * 5);
	const n = buildLinks(xs, ys, lit, count, out);
	assert(n > 0 && n <= MAX_LINKS);
	for (let k = 0; k < n; k++) {
		const o = k * 5;
		assert(Math.hypot(out[o + 2] - out[o], out[o + 3] - out[o + 1]) < LINK_DISTANCE);
		assert(out[o + 4] > 0 && out[o + 4] <= 1);
	}
	lit.fill(0);
	assertEquals(buildLinks(xs, ys, lit, count, out), 0);
});

Deno.test("resize: positions scale with the box; the count never changes", () => {
	const s = createConstellation(1000, 500);
	const count = s.count;
	const x0 = s.x[3];
	resizeConstellation(s, 2000, 1000);
	assertEquals(s.count, count);
	assertAlmostEquals(s.x[3], x0 * 2, 1e-3);
	resizeConstellation(s, 0, 0);
	assertEquals(s.width, 2000);
});
// #endregion

// #region Static fallback
Deno.test("static: deterministic, percent-positioned, with a gathered team", () => {
	const a = staticConstellation();
	assertEquals(a, staticConstellation());
	assertEquals(a.nodes.length, NODE_COUNT);
	assert(a.links.length > 0, "the static picture shows a team");
	for (const n of a.nodes) {
		assert(/^\d+(\.\d+)?%$/.test(n.cx) && /^\d+(\.\d+)?%$/.test(n.cy));
		const o = Number(n.opacity);
		assert(o > 0 && o <= 1);
	}
	for (const l of a.links) assert(Number(l.opacity) > 0);
	assert(JSON.stringify(staticConstellation(1)) !== JSON.stringify(a));
});
// #endregion

// #region Quiet zones
Deno.test("zones: merging keeps every input covered and fits the limit", () => {
	const rand = createRandom(9);
	const rects = Array.from({ length: 40 }, () => {
		const x = rand() * 1000;
		const y = rand() * 600;
		return rect(x, y, x + 20 + rand() * 200, y + 10 + rand() * 40);
	});
	const merged = mergeRects(rects, 6);
	assert(merged.length <= 6);
	for (const r of rects) assert(covers(merged, r));
	assertEquals(mergeRects([rect(0, 0, 10, 10), rect(2, 2, 5, 5), rect(0, 0, 10, 10)], 8), [
		rect(0, 0, 10, 10),
	]);
	assertEquals(mergeRects([rect(5, 5, 5, 9)], 4), []);
});

Deno.test("zones: copy padded by 24px, halo by 1.5 × blur, clipped, halos last", () => {
	const zones = buildZones({
		copy: [rect(100, 100, 300, 140)],
		halo: [rect(80, 200, 900, 260)],
		haloBlur: 32,
		width: 1000,
		height: 800,
	});
	assertEquals(zones, [
		{ x0: 76, y0: 76, x1: 324, y1: 164, kind: "copy" },
		{ x0: 32, y0: 152, x1: 948, y1: 308, kind: "halo" },
	]);
	const clipped = buildZones({
		copy: [rect(-50, -50, 2000, 20)],
		halo: [],
		haloBlur: 32,
		width: 1000,
		height: 800,
	});
	assertEquals(clipped, [{ x0: 0, y0: 0, x1: 1000, y1: 44, kind: "copy" }]);
});

Deno.test("zones: never more than MAX_ZONES, of which at most MAX_HALO_ZONES halos", () => {
	const many = Array.from({ length: 50 }, (_, i) => rect(i * 40, i * 30, i * 40 + 10, i * 30 + 5));
	const zones = buildZones({ copy: many, halo: many, haloBlur: 4, width: 4000, height: 4000 });
	assert(zones.length <= MAX_ZONES);
	assert(zones.filter((z) => z.kind === "halo").length <= MAX_HALO_ZONES);
});
// #endregion

// #region Colour limits
Deno.test("luminance: WCAG relative luminance of the extremes and a token", () => {
	assertEquals(relativeLuminance([0, 0, 0]), 0);
	assertAlmostEquals(relativeLuminance([1, 1, 1]), 1, 1e-12);
	assertAlmostEquals(relativeLuminance(hex("#288690")), 0.1951, 1e-3);
});

Deno.test("luminance cap: a ceiling on the dark canvas, a floor on the light one", () => {
	const darkBg = hex("#07090A");
	const darkNode = hex("#6CCDD5");
	const cap = luminanceCap(darkBg, darkNode, 0.04);
	assert(cap > 0 && cap < 1);
	assert(relativeLuminance(composite(darkBg, darkNode, cap)) <= 0.04);
	assert(relativeLuminance(composite(darkBg, darkNode, cap + 2 / 512)) > 0.04);

	const lightBg = hex("#F6F8F8");
	const lightNode = hex("#288690");
	const floor = luminanceCap(lightBg, lightNode, 0.57);
	assert(floor > 0 && floor < 1);
	assert(relativeLuminance(composite(lightBg, lightNode, floor)) >= 0.57);

	assertEquals(luminanceCap(darkBg, darkNode, 0.001), 0);
	assertEquals(luminanceCap(hex("#FFFFFF"), darkNode, 0.04), 1);
	assertEquals(luminanceCap(darkBg, darkNode, 1), 1);
});

Deno.test("zone caps: the token sheet's four states keep copy under quiet and the halo clear", () => {
	const states = [
		{ bg: "#07090A", node: "#6CCDD5", alpha: 0.6, quiet: 0.08, lum: 0.04 },
		{ bg: "#F6F8F8", node: "#288690", alpha: 0.5, quiet: 0.1, lum: 0.57 },
		{ bg: "#07090A", node: "#6CCDD5", alpha: 0.35, quiet: 0.06, lum: 0.037 },
		{ bg: "#F6F8F8", node: "#288690", alpha: 0.3, quiet: 0.05, lum: 0.7 },
	];
	for (const st of states) {
		const caps = zoneCaps({
			bg: hex(st.bg),
			node: hex(st.node),
			alpha: st.alpha,
			quietAlpha: st.quiet,
			haloAlpha: 0,
			lumLimit: st.lum,
		});
		assertEquals(caps.full, st.alpha);
		assert(caps.copy <= st.quiet && caps.copy > 0, JSON.stringify({ st, caps }));
		assertEquals(caps.halo, 0);
		const lum = relativeLuminance(composite(hex(st.bg), hex(st.node), caps.copy));
		assert(st.bg === "#07090A" ? lum <= st.lum : lum >= st.lum);
	}
	const broken = zoneCaps({
		bg: hex("#07090A"),
		node: hex("#6CCDD5"),
		alpha: Number.NaN,
		quietAlpha: 4,
		haloAlpha: -1,
		lumLimit: 1,
	});
	assertEquals(broken, { full: 0, copy: 0, halo: 0 });
});
// #endregion

// #region Watchdog
Deno.test("percentile: nearest rank, unsorted input, empty is NaN", () => {
	assertEquals(percentile([5, 1, 4, 2, 3], 0.95), 5);
	assertEquals(percentile([5, 1, 4, 2, 3], 0.5), 3);
	assertEquals(percentile([16.7], 0.95), 16.7);
	assert(Number.isNaN(percentile([], 0.95)));
	const frames = [...Array(114).fill(16.7), ...Array(6).fill(80)];
	assertEquals(percentile(frames, 0.95), 16.7);
});
// #endregion
