/**
 * hero-weave — the Explore gateway's background motif (Decisions #350, #351, #353): interlaced
 * eight-point star strapwork (a khatam lattice), as one seamless tile of SVG path data. `HeroWeave` and
 * `HeroPatternGlow` both rasterise this one path (`weave-canvas.ts`), so the glow beneath lights
 * exactly the straps the stencil shows. Pure: no DOM, no colour.
 *
 * Construction — "polygons in contact" on the 4.8.8 tiling (octagons on the grid points, squares
 * between): from every edge midpoint two lines leave at 67.5° to the edge and run until they meet a
 * line from the neighbouring edge. Inside each octagon that draws an eight-point star (its points on
 * the edge midpoints); inside each square, the cross that links four stars. Each line is a strap with
 * two edges {@link WEAVE_TRACK} apart; where two straps cross (only ever at an edge midpoint) one runs
 * over and the other breaks beneath it, alternating along every strap; every turn is filleted
 * {@link WEAVE_FILLET}px, so nothing is a knife edge and nothing is a circle.
 */

// #region Parameters
/** The tile's edge in CSS px; the pattern repeats on it from the hero's top-left corner. */
export const WEAVE_TILE = 128;

/** The stencil's stroke width in CSS px. */
export const WEAVE_STROKE = 1.5;

/** The distance between a strap's two edges, in CSS px. */
export const WEAVE_TRACK = 9;

/** The radius each turn of a strap edge is rounded to, in CSS px. */
export const WEAVE_FILLET = 3;

/** The gap either side of an over strap where the under strap breaks, in CSS px. */
const LACE_GAP = 1.5;

/** The lines' contact angle with the polygon edges, in degrees (the classic star-and-cross). */
const CONTACT = 67.5;
// #endregion

// #region Geometry
type P = [number, number];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
const unit = (a: P): P => mul(a, 1 / Math.hypot(a[0], a[1]));
const perp = (a: P): P => [-a[1], a[0]];
const rot = (a: P, deg: number): P => {
	const r = (deg * Math.PI) / 180;
	return [a[0] * Math.cos(r) - a[1] * Math.sin(r), a[0] * Math.sin(r) + a[1] * Math.cos(r)];
};
const key = (p: P) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

/** Where the lines `p + t·d` and `q + u·e` meet, as `[t, u]`, or `null` when parallel. */
function meet(p: P, d: P, q: P, e: P): [number, number] | null {
	const den = cross(d, e);
	if (Math.abs(den) < 1e-9) return null;
	const w = sub(q, p);
	return [cross(w, e) / den, cross(w, d) / den];
}

/** The 4.8.8 tiling's polygons over `-span … span + 1` tiles each way. */
function polygons(span: number): P[][] {
	const T = WEAVE_TILE;
	const deg = Math.PI / 180;
	const ro = T / 2 / Math.cos(22.5 * deg);
	const rs = (T * Math.tan(22.5 * deg)) / Math.SQRT2;
	const out: P[][] = [];
	for (let i = -span; i <= span + 1; i++) {
		for (let j = -span; j <= span + 1; j++) {
			const o: P = [i * T, j * T];
			const s: P = [(i + 0.5) * T, (j + 0.5) * T];
			out.push([...Array(8)].map((_, k) => add(o, rot([ro, 0], 22.5 + 45 * k))));
			out.push([...Array(4)].map((_, k) => add(s, rot([rs, 0], 90 * k))));
		}
	}
	return out;
}

/** A strap run: the straight stretch from one turn, through its crossing, to the next turn. */
export interface WeaveRun {
	a: P;
	mid: P;
	b: P;
}

/** The runs of the polygons-in-contact line network over the given polygons. */
function runsOf(polys: P[][]): WeaveRun[] {
	const ends = new Map<string, { m: P; t: P }[]>();
	for (const poly of polys) {
		const n = poly.length;
		const centre = mul(poly.reduce((s, v) => add(s, v), [0, 0] as P), 1 / n);
		const mids = poly.map((v, k) => mul(add(v, poly[(k + 1) % n]), 0.5));
		const rays = mids.map((m) => {
			const inward = unit(sub(centre, m));
			return [rot(inward, 90 - CONTACT), rot(inward, CONTACT - 90)];
		});
		for (let k = 0; k < n; k++) {
			const k2 = (k + 1) % n;
			let best: [number, P] | null = null;
			for (const d of rays[k]) {
				for (const e of rays[k2]) {
					const r = meet(mids[k], d, mids[k2], e);
					if (r && r[0] > 1e-6 && r[1] > 1e-6 && (!best || r[0] + r[1] < best[0])) {
						best = [r[0] + r[1], add(mids[k], mul(d, r[0]))];
					}
				}
			}
			if (!best) continue;
			for (const m of [mids[k], mids[k2]]) {
				const list = ends.get(key(m)) ?? [];
				list.push({ m, t: best[1] });
				ends.set(key(m), list);
			}
		}
	}
	const runs: WeaveRun[] = [];
	for (const list of ends.values()) {
		if (list.length !== 4) continue;
		const used = new Set<number>();
		for (let i = 0; i < 4; i++) {
			for (let j = i + 1; j < 4 && !used.has(i); j++) {
				if (used.has(j)) continue;
				const d1 = unit(sub(list[i].t, list[i].m));
				const d2 = unit(sub(list[j].t, list[j].m));
				if (d1[0] * d2[0] + d1[1] * d2[1] < -0.999) {
					used.add(i).add(j);
					runs.push({ a: list[i].t, mid: list[i].m, b: list[j].t });
				}
			}
		}
	}
	return runs;
}

/**
 * Which runs lie over their crossing: a two-colouring in which the runs meeting at a turn differ (so
 * every strap alternates over and under) and the runs meeting at a crossing differ (one over, one
 * under). `consistent` is false if the network cannot be coloured so.
 */
function overOf(runs: WeaveRun[]): { over: boolean[]; consistent: boolean } {
	const groups = new Map<string, number[]>();
	runs.forEach((r, i) => {
		for (const p of [r.a, r.b, r.mid]) {
			const g = groups.get(key(p)) ?? [];
			g.push(i);
			groups.set(key(p), g);
		}
	});
	const adj = runs.map(() => [] as number[]);
	for (const g of groups.values()) {
		if (g.length === 2) adj[g[0]].push(g[1]), adj[g[1]].push(g[0]);
	}
	const over: (boolean | undefined)[] = runs.map(() => undefined);
	let consistent = true;
	for (let s = 0; s < runs.length; s++) {
		if (over[s] !== undefined) continue;
		over[s] = true;
		const queue = [s];
		while (queue.length) {
			const x = queue.shift()!;
			for (const y of adj[x]) {
				if (over[y] === undefined) over[y] = !over[x], queue.push(y);
				else if (over[y] === over[x]) consistent = false;
			}
		}
	}
	return { over: over as boolean[], consistent };
}

/** The strapwork over a 3 × 3 block of tiles: its runs, their over/under, and the network's check. */
export function buildWeave() {
	const runs = runsOf(polygons(1));
	const { over, consistent } = overOf(runs);
	return { runs, over, consistent };
}

/** The tile's strapwork as SVG path data: every strap edge piece and filleted turn touching the tile. */
function weavePath(): string {
	const { runs, over } = buildWeave();
	const h = WEAVE_TRACK / 2;
	const T = WEAVE_TILE;
	const near = (...ps: P[]) =>
		ps.some((p) => p[0] > -h * 3 && p[0] < T + h * 3 && p[1] > -h * 3 && p[1] < T + h * 3);
	const fmt = (p: P) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
	const byTurn = new Map<string, number[]>();
	runs.forEach((r, i) => {
		for (const p of [r.a, r.b]) byTurn.set(key(p), [...(byTurn.get(key(p)) ?? []), i]);
	});
	const crossOf = (i: number) =>
		runs.findIndex((r, j) => j !== i && key(r.mid) === key(runs[i].mid));
	/** The join points of run `i`'s two edges at its end `p`, against the run that turns there. */
	const joins = (i: number, p: P, from: P) => {
		const j = (byTurn.get(key(p)) ?? []).find((x) => x !== i);
		if (j === undefined) return null;
		const other = runs[j];
		const q = key(other.a) === key(p) ? other.b : other.a;
		const u1 = unit(sub(p, from));
		const u2 = unit(sub(q, p));
		return ([1, -1] as const).map((s) => {
			const p1 = add(p, mul(perp(u1), s * h));
			const p2 = add(p, mul(perp(u2), s * h));
			const r = meet(p1, u1, p2, u2);
			return { s, at: r ? add(p1, mul(u1, r[0])) : p1, u1, u2 };
		});
	};
	const parts: string[] = [];
	const corners = new Set<string>();
	runs.forEach((run, i) => {
		const ja = joins(i, run.a, run.b);
		const jb = joins(i, run.b, run.a);
		if (!ja || !jb) return;
		const u = unit(sub(run.b, run.a));
		for (const s of [1, -1]) {
			const start = add(ja.find((x) => x.s === -s)!.at, mul(u, WEAVE_FILLET));
			const end = sub(jb.find((x) => x.s === s)!.at, mul(u, WEAVE_FILLET));
			let pieces: [P, P][] = [[start, end]];
			const c = over[i] ? -1 : crossOf(i);
			if (c >= 0) {
				const v = unit(sub(runs[c].b, runs[c].a));
				const ts = [1, -1].map((g) =>
					meet(start, sub(end, start), add(runs[c].mid, mul(perp(v), g * (h + LACE_GAP))), v)![0]
				).sort((x, y) => x - y);
				const along = (t: number) => add(start, mul(sub(end, start), t));
				pieces = [[start, along(ts[0])], [along(ts[1]), end]];
			}
			for (const [p, q] of pieces) if (near(p, q)) parts.push(`M${fmt(p)}L${fmt(q)}`);
		}
		for (const { at, u1, u2 } of [...ja, ...jb]) {
			if (corners.has(key(at)) || !near(at)) continue;
			corners.add(key(at));
			parts.push(
				`M${fmt(sub(at, mul(u1, WEAVE_FILLET)))}Q${fmt(at)} ${fmt(add(at, mul(u2, WEAVE_FILLET)))}`,
			);
		}
	});
	return parts.join("");
}

/** The tile's strapwork, computed once: path data in tile units (CSS px). */
export const WEAVE_PATH = weavePath();
// #endregion
