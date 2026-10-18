/**
 * background-gate.test — the hero background gate table (`flows/LANDING.md` §3.6, §7): one named
 * case per row, then every combination of every input checked against the invariants the spec states.
 */
import { assertEquals } from "@std/assert";
import {
	type BackgroundFailure,
	type BackgroundForce,
	type BackgroundSnapshot,
	type BackgroundVerdict,
	decideBackground,
	parseBackgroundForce,
} from "./background-gate.ts";

// #region Fixtures
/** A capable desktop with the hero on screen: the one state that runs WebGL. */
const DESKTOP: BackgroundSnapshot = {
	reducedMotionMedia: false,
	dataMotionReduced: false,
	saveData: false,
	deviceMemory: 8,
	hardwareConcurrency: 8,
	finePointer: true,
	forcedColors: false,
	webgl2: null,
	failure: null,
	intersecting: true,
	hidden: false,
	force: "auto",
};

function decide(patch: Partial<BackgroundSnapshot>): BackgroundVerdict {
	return decideBackground({ ...DESKTOP, ...patch });
}
// #endregion

// #region Named rows
Deno.test("gate: a capable desktop runs webgl, untested or tested webgl2 alike", () => {
	assertEquals(decide({}), { mode: "webgl", reason: null, pause: null });
	assertEquals(decide({ webgl2: true }), { mode: "webgl", reason: null, pause: null });
});

Deno.test("gate: reduced motion on either channel ends every moving path", () => {
	const still: BackgroundVerdict = { mode: "static", reason: "reduced-motion", pause: null };
	assertEquals(decide({ reducedMotionMedia: true }), still);
	assertEquals(decide({ dataMotionReduced: true }), still);
	assertEquals(decide({ dataMotionReduced: true, force: "webgl" }), still);
	assertEquals(decide({ reducedMotionMedia: true, finePointer: false }), still);
});

Deno.test("gate: Save-Data, low memory and low cores fall back to the spotlight on a mouse", () => {
	assertEquals(decide({ saveData: true }), {
		mode: "spotlight",
		reason: "save-data",
		pause: null,
	});
	assertEquals(decide({ deviceMemory: 2 }), {
		mode: "spotlight",
		reason: "low-memory",
		pause: null,
	});
	assertEquals(decide({ hardwareConcurrency: 4 }), {
		mode: "spotlight",
		reason: "low-cpu",
		pause: null,
	});
	assertEquals(decide({ deviceMemory: 4, hardwareConcurrency: 5 }).mode, "webgl");
});

Deno.test("gate: unknown memory passes on a fine pointer only", () => {
	assertEquals(decide({ deviceMemory: null }).mode, "webgl");
	assertEquals(decide({ deviceMemory: null, finePointer: false }), {
		mode: "static",
		reason: "unknown-memory",
		pause: null,
	});
	assertEquals(decide({ deviceMemory: 8, finePointer: false }).mode, "webgl");
});

Deno.test("gate: a touch device without webgl is static (no spotlight on coarse pointers)", () => {
	assertEquals(decide({ finePointer: false, deviceMemory: 2 }), {
		mode: "static",
		reason: "low-memory",
		pause: null,
	});
});

Deno.test("gate: a failed context or a latched failure ends webgl", () => {
	assertEquals(decide({ webgl2: false }), {
		mode: "spotlight",
		reason: "no-webgl",
		pause: null,
	});
	for (const failure of ["context-lost", "watchdog", "render-error", "no-tokens"] as const) {
		assertEquals(decide({ failure }), { mode: "spotlight", reason: failure, pause: null });
		assertEquals(decide({ failure, force: "webgl" }).reason, failure);
	}
});

Deno.test("gate: a hidden tab or an offscreen hero pauses, never changes the mode", () => {
	assertEquals(decide({ hidden: true }), { mode: "webgl", reason: null, pause: "hidden" });
	assertEquals(decide({ intersecting: false }), {
		mode: "webgl",
		reason: null,
		pause: "offscreen",
	});
	assertEquals(decide({ hidden: true, intersecting: false }).pause, "hidden");
	assertEquals(decide({ saveData: true, intersecting: false }), {
		mode: "spotlight",
		reason: "save-data",
		pause: "offscreen",
	});
	assertEquals(decide({ finePointer: false, deviceMemory: 2, hidden: true }).pause, null);
});

Deno.test("gate: forced paths — static wins over all, webgl skips only the capability gates", () => {
	assertEquals(decide({ force: "static" }), {
		mode: "static",
		reason: "forced-static",
		pause: null,
	});
	assertEquals(
		decide({ force: "webgl", saveData: true, deviceMemory: 1, hardwareConcurrency: 2 }).mode,
		"webgl",
	);
	assertEquals(decide({ force: "webgl", finePointer: false, deviceMemory: null }).mode, "webgl");
	assertEquals(decide({ force: "webgl", webgl2: false }).reason, "no-webgl");
});

Deno.test("gate: forced colours paint no background layer at all", () => {
	assertEquals(decide({ forcedColors: true }), {
		mode: "static",
		reason: "forced-colors",
		pause: null,
	});
});

Deno.test("gate: parseBackgroundForce accepts only the two forced paths", () => {
	assertEquals(parseBackgroundForce("webgl"), "webgl");
	assertEquals(parseBackgroundForce("static"), "static");
	assertEquals(parseBackgroundForce("auto"), "auto");
	assertEquals(parseBackgroundForce("WEBGL"), "auto");
	assertEquals(parseBackgroundForce(undefined), "auto");
	assertEquals(parseBackgroundForce(null), "auto");
});
// #endregion

// #region Exhaustive invariants
/** Every combination of every input, with representative values for the numeric hints. */
function* snapshots(): Generator<BackgroundSnapshot> {
	const bools = [false, true];
	const memories = [null, 2, 4, 8];
	const cores = [null, 2, 4, 8];
	const webgl = [null, false, true];
	const failures: (BackgroundFailure | null)[] = [null, "context-lost", "watchdog"];
	const forces: BackgroundForce[] = ["auto", "static", "webgl"];
	for (const reducedMotionMedia of bools) {
		for (const dataMotionReduced of bools) {
			for (const saveData of bools) {
				for (const deviceMemory of memories) {
					for (const hardwareConcurrency of cores) {
						for (const finePointer of bools) {
							for (const forcedColors of bools) {
								for (const webgl2 of webgl) {
									for (const failure of failures) {
										for (const intersecting of bools) {
											for (const hidden of bools) {
												for (const force of forces) {
													yield {
														reducedMotionMedia,
														dataMotionReduced,
														saveData,
														deviceMemory,
														hardwareConcurrency,
														finePointer,
														forcedColors,
														webgl2,
														failure,
														intersecting,
														hidden,
														force,
													};
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
}

/** The spec's rules restated independently of the implementation's control flow. */
function oracle(s: BackgroundSnapshot): BackgroundVerdict {
	const reduced = s.reducedMotionMedia || s.dataMotionReduced;
	const ending = s.force === "static" || s.forcedColors || reduced;
	if (ending) {
		const reason = s.force === "static"
			? "forced-static"
			: s.forcedColors
			? "forced-colors"
			: "reduced-motion";
		return { mode: "static", reason, pause: null };
	}
	const memoryOk = s.deviceMemory === null ? s.finePointer : s.deviceMemory >= 4;
	const coresOk = s.hardwareConcurrency === null || s.hardwareConcurrency > 4;
	const capable = s.force === "webgl" || (!s.saveData && memoryOk && coresOk);
	const webgl = s.failure === null && s.webgl2 !== false && capable;
	const pause = s.hidden ? "hidden" : s.intersecting ? null : "offscreen";
	if (webgl) return { mode: "webgl", reason: null, pause };
	const reason = s.failure ??
		(s.webgl2 === false
			? "no-webgl"
			: s.saveData
			? "save-data"
			: s.deviceMemory !== null && s.deviceMemory < 4
			? "low-memory"
			: s.deviceMemory === null && !s.finePointer
			? "unknown-memory"
			: "low-cpu");
	return s.finePointer
		? { mode: "spotlight", reason, pause }
		: { mode: "static", reason, pause: null };
}

Deno.test("gate: every combination matches the spec's rules", () => {
	let count = 0;
	for (const s of snapshots()) {
		assertEquals(decideBackground(s), oracle(s), JSON.stringify(s));
		count += 1;
	}
	assertEquals(count, 2 ** 7 * 4 * 4 * 3 * 3 * 3);
});

Deno.test("gate: invariants — webgl never under reduced motion, spotlight only on a fine pointer", () => {
	for (const s of snapshots()) {
		const v = decideBackground(s);
		const reduced = s.reducedMotionMedia || s.dataMotionReduced;
		if (reduced) assertEquals(v.mode, "static");
		if (v.mode === "webgl") {
			assertEquals(v.reason, null);
			assertEquals(s.failure, null);
			assertEquals(s.webgl2 === false, false);
		} else {
			assertEquals(v.reason === null, false);
		}
		if (v.mode === "spotlight") assertEquals(s.finePointer, true);
		if (v.mode === "static") assertEquals(v.pause, null);
		else assertEquals(v.pause !== null, s.hidden || !s.intersecting);
	}
});
// #endregion
