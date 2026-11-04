import { assert, assertEquals } from "@std/assert";
import { buildWeave, WEAVE_FILLET, WEAVE_PATH, WEAVE_TILE } from "./hero-weave.ts";

const key = (p: [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

Deno.test("the straps interlace: every strap alternates over and under, one over at every crossing", () => {
	const { runs, over, consistent } = buildWeave();
	assert(runs.length > 0);
	assert(consistent, "the over/under two-colouring must have no conflict");
	const byMid = new Map<string, number[]>();
	runs.forEach((r, i) => byMid.set(key(r.mid), [...(byMid.get(key(r.mid)) ?? []), i]));
	for (const pair of byMid.values()) {
		if (pair.length === 2) {
			assert(over[pair[0]] !== over[pair[1]], "two straps cross: one over, one under");
		}
	}
});

Deno.test("the interlace repeats on the tile, so the pattern is seamless", () => {
	const { runs, over } = buildWeave();
	const at = new Map(runs.map((r, i) => [`${key(r.a)}|${key(r.b)}`, i] as const));
	let checked = 0;
	runs.forEach((r, i) => {
		const t = (p: [number, number]): [number, number] => [p[0] + WEAVE_TILE, p[1]];
		const j = at.get(`${key(t(r.a))}|${key(t(r.b))}`) ?? at.get(`${key(t(r.b))}|${key(t(r.a))}`);
		if (j === undefined) return;
		checked++;
		assertEquals(over[j], over[i], "a run and its neighbour-tile copy lie the same way");
	});
	assert(checked > 20);
});

Deno.test("straps cross only at their midpoints: no stray interior crossings", () => {
	const { runs } = buildWeave();
	const segs = runs.flatMap((r) => [[r.a, r.mid], [r.mid, r.b]] as [number, number][][]);
	let stray = 0;
	for (let i = 0; i < segs.length; i++) {
		for (let j = i + 1; j < segs.length; j++) {
			const [a, b] = segs[i], [c, d] = segs[j];
			const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
			const den = r[0] * s[1] - r[1] * s[0];
			if (Math.abs(den) < 1e-9) continue;
			const w = [c[0] - a[0], c[1] - a[1]];
			const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
			if (t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4) stray++;
		}
	}
	assertEquals(stray, 0);
});

Deno.test("the path is straight strap edges and small filleted turns: no circles, no arcs", () => {
	assert(WEAVE_PATH.includes("Q"), "turns are rounded");
	assert(!/[AaCc]/.test(WEAVE_PATH), "no arc or curve beyond the micro-fillets");
	assert(WEAVE_FILLET >= 2.5 && WEAVE_FILLET <= 3.5);
});
