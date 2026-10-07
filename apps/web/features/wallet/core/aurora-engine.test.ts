import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	advanceClock,
	AURORA_CONTRAST_MARGIN,
	AURORA_CONTRAST_TARGET,
	AURORA_CPU_PIXELS,
	AURORA_GL_MAX_EDGE,
	AURORA_MAX_STEP_MS,
	auroraCeiling,
	type AuroraEnvironment,
	type AuroraMode,
	type AuroraPalette,
	clampLuminance,
	compositeOver,
	contrastRatio,
	cpuResolution,
	decideAurora,
	FrameSampler,
	isFrameStalled,
	LUMA,
	maxGroundLuminance,
	parseCssColor,
	percentile,
	relativeLuminance,
	type Rgb,
	type Rgba,
	shouldDraw,
	srgbToLinear,
	webglResolution,
	worstContrast,
} from "./aurora-engine.ts";
import { shadeAurora, shadeWarped, snoise3, WarpLattice } from "./aurora-field.ts";

// #region Fixtures
const CLEAR: AuroraEnvironment = {
	reducedMotion: false,
	saveData: undefined,
	deviceMemory: undefined,
	hardwareConcurrency: undefined,
	hidden: false,
};

const env = (over: Partial<AuroraEnvironment>): AuroraEnvironment => ({ ...CLEAR, ...over });

function rgb(value: string): Rgb {
	const c = parseCssColor(value);
	if (!c) throw new Error(`unparsed ${value}`);
	return [c[0], c[1], c[2]];
}

function rgba(value: string): Rgba {
	const c = parseCssColor(value);
	if (!c) throw new Error(`unparsed ${value}`);
	return c;
}

/** The default dark tokens, in the computed forms the browser reports them in. */
const INK = rgba("rgb(255, 255, 255)");
const SOFT_INK = rgba("color(srgb 1 1 1 / 0.84)");
const GLASS = rgba("color(srgb 1 1 1 / 0.12)");
const PALETTE: AuroraPalette = {
	base: rgb("rgb(11, 7, 20)"),
	deep: rgb("rgb(30, 17, 69)"),
	cobalt: rgb("rgb(37, 99, 235)"),
	violet: rgb("rgb(139, 92, 246)"),
	cyan: rgb("rgb(6, 182, 212)"),
};

/** A small deterministic PRNG (mulberry32), so property tests are reproducible. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
// #endregion

// #region Gating
Deno.test("decideAurora: a clear environment runs under auto and animated", () => {
	assertEquals(decideAurora(CLEAR, "auto"), { action: "run" });
	assertEquals(decideAurora(CLEAR, "animated"), { action: "run" });
});

Deno.test("decideAurora: static never mounts, whatever else holds", () => {
	assertEquals(decideAurora(CLEAR, "static"), { action: "block", reason: "dev-static" });
	assertEquals(decideAurora(env({ reducedMotion: true, hidden: true }), "static"), {
		action: "block",
		reason: "dev-static",
	});
});

Deno.test("decideAurora: reduced motion blocks under every running mode", () => {
	for (const mode of ["auto", "animated"] as AuroraMode[]) {
		assertEquals(decideAurora(env({ reducedMotion: true }), mode), {
			action: "block",
			reason: "reduced-motion",
		});
	}
});

Deno.test("decideAurora: the hardware and data-saver gates apply under auto only", () => {
	const table: [Partial<AuroraEnvironment>, string][] = [
		[{ saveData: true }, "save-data"],
		[{ deviceMemory: 2 }, "low-memory"],
		[{ deviceMemory: 0.5 }, "low-memory"],
		[{ hardwareConcurrency: 4 }, "low-cores"],
		[{ hardwareConcurrency: 2 }, "low-cores"],
	];
	for (const [over, reason] of table) {
		assertEquals(decideAurora(env(over), "auto"), { action: "block", reason } as never);
		assertEquals(decideAurora(env(over), "animated"), { action: "run" });
	}
});

Deno.test("decideAurora: absent or healthy hints pass", () => {
	const passing: Partial<AuroraEnvironment>[] = [
		{ saveData: false },
		{ deviceMemory: 4 },
		{ deviceMemory: 8 },
		{ hardwareConcurrency: 6 },
		{ hardwareConcurrency: 0 },
		{ deviceMemory: Number.NaN },
	];
	for (const over of passing) assertEquals(decideAurora(env(over), "auto"), { action: "run" });
});

Deno.test("decideAurora: gates report in a fixed priority", () => {
	const all = env({ saveData: true, deviceMemory: 1, hardwareConcurrency: 2 });
	assertEquals(decideAurora(all, "auto"), { action: "block", reason: "save-data" });
	assertEquals(decideAurora(env({ deviceMemory: 1, hardwareConcurrency: 2 }), "auto"), {
		action: "block",
		reason: "low-memory",
	});
	assertEquals(decideAurora(env({ reducedMotion: true, saveData: true }), "auto"), {
		action: "block",
		reason: "reduced-motion",
	});
});

Deno.test("decideAurora: a hidden page waits, under auto and animated", () => {
	for (const mode of ["auto", "animated"] as AuroraMode[]) {
		assertEquals(decideAurora(env({ hidden: true }), mode), { action: "wait", reason: "hidden" });
	}
	assertEquals(decideAurora(env({ hidden: true, hardwareConcurrency: 2 }), "auto"), {
		action: "block",
		reason: "low-cores",
	});
});
// #endregion

// #region Frame budget
Deno.test("percentile: nearest rank, input untouched, NaN when empty", () => {
	const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
	assertEquals(percentile(samples, 95), 95);
	assertEquals(percentile(samples, 50), 50);
	assertEquals(percentile(samples, 100), 100);
	assertEquals(percentile([7], 95), 7);
	assertEquals(samples[0], 100);
	assert(Number.isNaN(percentile([], 95)));
});

Deno.test("FrameSampler: a steady 60 Hz run passes with its p95", () => {
	const s = new FrameSampler();
	let verdict = s.verdict;
	for (let i = 0; i < 90; i++) verdict = s.record(1000 / 60);
	assertEquals(verdict, "pass");
	assertAlmostEquals(s.p95!, 16.67, 0.01);
});

Deno.test("FrameSampler: p95 over 90 frames tolerates four long frames, not five", () => {
	const run = (slow: number) => {
		const s = new FrameSampler();
		for (let i = 0; i < 90 - slow; i++) s.record(16.7);
		for (let i = 0; i < slow; i++) s.record(40);
		return s;
	};
	assertEquals(run(4).verdict, "pass");
	const failing = run(5);
	assertEquals(failing.verdict, "fail");
	assertEquals(failing.p95, 40);
});

Deno.test("FrameSampler: the budget is exclusive and a 30 Hz cadence fails", () => {
	const at = (ms: number) => {
		const s = new FrameSampler();
		for (let i = 0; i < 90; i++) s.record(ms);
		return s.verdict;
	};
	assertEquals(at(22), "pass");
	assertEquals(at(22.1), "fail");
	assertEquals(at(1000 / 30), "fail");
});

Deno.test("FrameSampler: ignores junk intervals and settles once", () => {
	const s = new FrameSampler(3, 22);
	assertEquals(s.record(Number.NaN), "sampling");
	assertEquals(s.record(-4), "sampling");
	assertEquals(s.record(0), "sampling");
	s.record(10);
	s.record(10);
	assertEquals(s.record(10), "pass");
	assertEquals(s.record(500), "pass");
	assertEquals(s.p95, 10);
});

Deno.test("isFrameStalled: needs both a long silence and a healthy timer", () => {
	assertEquals(isFrameStalled(1200, 1), false, "one late tick is a long task, not a stall");
	assertEquals(isFrameStalled(1200, 2), true);
	assertEquals(isFrameStalled(1000, 6), false, "the threshold is exclusive");
	assertEquals(isFrameStalled(900, 6), false);
	assertEquals(isFrameStalled(2100, 2), true, "a 1 s timer clamp still trips on its second tick");
});

Deno.test("shouldDraw: ~30 draws a second at 60, 120 and 144 Hz", () => {
	for (const hz of [60, 120, 144]) {
		let last = Number.NEGATIVE_INFINITY;
		let draws = 0;
		for (let i = 0; i < hz; i++) {
			const now = i * (1000 / hz);
			if (shouldDraw(now, last)) {
				draws++;
				last = now;
			}
		}
		assert(draws >= 28 && draws <= 31, `${hz} Hz drew ${draws} times`);
	}
});

Deno.test("advanceClock: seconds, capped per step, junk ignored", () => {
	assertAlmostEquals(advanceClock(1, 500 / 15), 1 + 1 / 30, 1e-9);
	assertEquals(advanceClock(1, 60_000), 1 + AURORA_MAX_STEP_MS / 1000);
	assertEquals(advanceClock(1, Number.NaN), 1);
	assertEquals(advanceClock(1, -5), 1);
});
// #endregion

// #region Resolution
Deno.test("webglResolution: capped edge, half scale at most, no DPR", () => {
	const wide = webglResolution(1400, 600);
	assertEquals(Math.max(wide.width, wide.height), AURORA_GL_MAX_EDGE);
	assertAlmostEquals(wide.width / wide.height, 1400 / 600, 0.02);
	assertEquals(webglResolution(300, 400), { width: 150, height: 200 });
	const sliver = webglResolution(1, 1);
	assert(sliver.width >= 1 && sliver.height >= 1);
});

Deno.test("cpuResolution: ~96 × 54 at 16:9, the budget kept at other aspects", () => {
	assertEquals(cpuResolution(1600, 900), { width: 96, height: 54 });
	for (const [w, h] of [[1400, 600], [390, 480], [3000, 400]]) {
		const size = cpuResolution(w, h);
		assert(
			size.width * size.height <= AURORA_CPU_PIXELS * 1.1,
			`${w}×${h} → ${size.width}×${size.height}`,
		);
		assert(size.width >= 8 && size.height >= 8);
	}
});
// #endregion

// #region Colour
Deno.test("parseCssColor: the computed forms", () => {
	assertEquals(parseCssColor("rgb(6, 182, 212)"), [6 / 255, 182 / 255, 212 / 255, 1]);
	assertEquals(parseCssColor("rgba(255, 255, 255, 0.84)"), [1, 1, 1, 0.84]);
	assertEquals(parseCssColor("rgb(6 182 212 / 50%)"), [6 / 255, 182 / 255, 212 / 255, 0.5]);
	assertEquals(parseCssColor("color(srgb 1 1 1 / 0.84)"), [1, 1, 1, 0.84]);
	assertEquals(parseCssColor("color(srgb 0.5 none 25%)"), [0.5, 0, 0.25, 1]);
	assertEquals(parseCssColor("  TRANSPARENT "), [0, 0, 0, 0]);
	const linear = parseCssColor("color(srgb-linear 0.2140 0 1)")!;
	assertAlmostEquals(linear[0], 0.5, 1e-3);
	assertAlmostEquals(linear[2], 1, 1e-12);
});

Deno.test("parseCssColor: other spaces are left to the canvas", () => {
	for (
		const value of [
			"oklab(0.5 0.1 0.1)",
			"color(display-p3 1 0 0)",
			"lab(50 20 20)",
			"rgb(1, 2)",
			"rgb(a, b, c)",
			"color-mix(in srgb, red 50%, blue)",
			"",
		]
	) {
		assertEquals(parseCssColor(value), null, value);
	}
});

Deno.test("luminance and contrast match WCAG", () => {
	assertEquals(relativeLuminance([1, 1, 1]), 1);
	assertEquals(relativeLuminance([0, 0, 0]), 0);
	assertAlmostEquals(contrastRatio(1, 0), 21, 1e-9);
	assertAlmostEquals(contrastRatio(0, 1), 21, 1e-9);
	assertAlmostEquals(srgbToLinear(0.5), 0.214, 1e-3);
});

Deno.test("compositeOver blends in encoded space", () => {
	assertEquals(compositeOver([1, 1, 1, 0.5], [0, 0, 0]), [0.5, 0.5, 0.5]);
	assertEquals(compositeOver([1, 0, 0, 0], [0, 0.4, 0]), [0, 0.4, 0]);
});

Deno.test("clampLuminance: scales to the ceiling, keeps chromaticity, leaves dim colours", () => {
	const lin: Rgb = [0.2, 0.6, 0.9];
	const out = clampLuminance(lin, 0.1);
	const lum = LUMA[0] * out[0] + LUMA[1] * out[1] + LUMA[2] * out[2];
	assertAlmostEquals(lum, 0.1, 1e-12);
	assertAlmostEquals(out[0] / out[2], lin[0] / lin[2], 1e-12);
	assertAlmostEquals(out[1] / out[2], lin[1] / lin[2], 1e-12);
	assertEquals(clampLuminance([0.01, 0.02, 0.03], 0.1), [0.01, 0.02, 0.03]);
});
// #endregion

// #region Contrast ceiling
Deno.test("maxGroundLuminance: an opaque white ink has the closed-form ceiling", () => {
	assertAlmostEquals(maxGroundLuminance([{ ink: INK }], 4.5), 1.05 / 4.5 - 0.05, 1e-5);
});

Deno.test("maxGroundLuminance: a translucent ink is hue-sensitive and stricter", () => {
	const soft = maxGroundLuminance([{ ink: SOFT_INK }], 4.5);
	assert(soft < 1.05 / 4.5 - 0.05);
	assert(soft > 0.05);
});

Deno.test("maxGroundLuminance: 0 when nothing satisfies, 1 when everything does", () => {
	assertEquals(maxGroundLuminance([{ ink: [1, 1, 1, 0] }], 4.5), 0);
	assertEquals(maxGroundLuminance([{ ink: INK }], 1), 1);
	assertEquals(maxGroundLuminance([], 4.5), 1);
});

Deno.test("auroraCeiling: the default dark tokens", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	assertAlmostEquals(ceiling, 0.1149, 5e-4);
	assertEquals(ceiling, auroraCeiling(INK, SOFT_INK, null), "the soft ink binds, not the glass");
});

Deno.test("auroraCeiling: any ground at the ceiling keeps every ink at ≥ 4.5:1 (property)", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	const pairs = [{ ink: INK }, { ink: SOFT_INK }, { ink: INK, veil: GLASS }];
	const random = prng(7);
	for (let i = 0; i < 4000; i++) {
		const lin = clampLuminance([random(), random(), random()], ceiling);
		const ground: Rgb = [lin[0], lin[1], lin[2]].map((c) =>
			c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
		) as unknown as Rgb;
		const worst = worstContrast(pairs, ground);
		assert(
			worst >= AURORA_CONTRAST_TARGET + AURORA_CONTRAST_MARGIN - 0.05,
			`${ground.join(",")} → ${worst}`,
		);
	}
});

Deno.test("auroraCeiling: one 8-bit step of quantisation cannot cross 4.5:1", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	const random = prng(11);
	for (let i = 0; i < 2000; i++) {
		const lin = clampLuminance([random(), random(), random()], ceiling);
		const ground = lin.map((c) =>
			Math.min(1, (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) + 1 / 255)
		) as unknown as Rgb;
		assert(worstContrast([{ ink: INK }, { ink: SOFT_INK }], ground) >= AURORA_CONTRAST_TARGET);
	}
});
// #endregion

// #region Field
Deno.test("snoise3: bounded, deterministic, continuous, and not flat", () => {
	const random = prng(3);
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < 5000; i++) {
		const x = random() * 40 - 20;
		const y = random() * 40 - 20;
		const z = random() * 40 - 20;
		const n = snoise3(x, y, z);
		assert(Number.isFinite(n));
		assert(Math.abs(n) <= 1.05, `${n}`);
		assertEquals(n, snoise3(x, y, z));
		assert(Math.abs(snoise3(x + 1e-4, y, z) - n) < 0.01);
		min = Math.min(min, n);
		max = Math.max(max, n);
	}
	assert(max - min > 1.2, `range ${min}..${max}`);
});

Deno.test("shadeAurora: in gamut and under the ceiling everywhere", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	const random = prng(5);
	const out = [0, 0, 0];
	for (let i = 0; i < 3000; i++) {
		shadeAurora(random(), random(), 0.5 + random() * 2.5, random() * 600, PALETTE, ceiling, out);
		for (const c of out) assert(c >= 0 && c <= 1, `${out}`);
		assert(relativeLuminance(out as unknown as Rgb) <= ceiling + 1e-9);
	}
});

Deno.test("WarpLattice: the CPU path's interpolated field stays close to the exact field", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	const lattice = new WarpLattice();
	const warp = [0, 0, 0];
	for (const [w, h, aspect] of [[96, 54, 16 / 9], [66, 79, 0.83], [96, 41, 2.33]]) {
		const errors: number[] = [];
		for (const time of [0, 37, 137.5]) {
			lattice.sample(w, h, aspect, time);
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const u = (x + 0.5) / w;
					const v = (y + 0.5) / h;
					lattice.at(x, y, warp);
					const fast = shadeWarped(u, v, aspect, warp[0], warp[1], warp[2], PALETTE, ceiling);
					const exact = shadeAurora(u, v, aspect, time, PALETTE, ceiling);
					errors.push(Math.max(...fast.map((c, n) => Math.abs(c - exact[n]))) * 255);
				}
			}
		}
		const p99 = percentile(errors, 99);
		const worst = percentile(errors, 100);
		assert(p99 < 6, `${w}×${h}: p99 ${p99.toFixed(2)} of 255`);
		assert(worst < 40, `${w}×${h}: worst ${worst.toFixed(2)} of 255`);
	}
});

Deno.test("shadeAurora: neighbouring pixels at the CPU resolution stay smooth (no marbling)", () => {
	const ceiling = auroraCeiling(INK, SOFT_INK, GLASS);
	const steps: number[] = [];
	for (const time of [0, 40]) {
		for (let y = 0; y < 54; y++) {
			for (let x = 0; x < 95; x++) {
				const a = shadeAurora((x + 0.5) / 96, (y + 0.5) / 54, 16 / 9, time, PALETTE, ceiling);
				const b = shadeAurora((x + 1.5) / 96, (y + 0.5) / 54, 16 / 9, time, PALETTE, ceiling);
				steps.push(Math.max(...a.map((c, n) => Math.abs(c - b[n]))) * 255);
			}
		}
	}
	assert(percentile(steps, 95) < 8, `p95 step ${percentile(steps, 95).toFixed(2)} of 255`);
});

Deno.test("shadeAurora: keeps the static composition — cyan corner, deep base", () => {
	const out = [0, 0, 0];
	const corner = shadeAurora(0.02, 0.02, 2, 0, PALETTE, 1, [...out]);
	assert(corner[2] > corner[0] && corner[1] > corner[0], `corner ${corner}`);
	const edge = shadeAurora(0.02, 0.98, 2, 0, PALETTE, 1, [...out]);
	assert(relativeLuminance(edge as unknown as Rgb) < relativeLuminance(corner as unknown as Rgb));
});
// #endregion
