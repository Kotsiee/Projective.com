/**
 * background-gate.test — the hero background gate table (`flows/LANDING.md` §3.6, §7): one named
 * case per row, then every combination of every input checked against the invariants the spec states.
 */
import { assertEquals } from "@std/assert";
import {
	type BackgroundForce,
	type BackgroundSnapshot,
	type BackgroundVerdict,
	decideBackground,
	parseBackgroundForce,
} from "./background-gate.ts";

// #region Fixtures
/** A capable desktop with the hero on screen: the spotlight follows the pointer. */
const DESKTOP: BackgroundSnapshot = {
	reducedMotionMedia: false,
	dataMotionReduced: false,
	saveData: false,
	deviceMemory: 8,
	hardwareConcurrency: 8,
	finePointer: true,
	forcedColors: false,
	intersecting: true,
	hidden: false,
	force: "auto",
};

function decide(patch: Partial<BackgroundSnapshot>): BackgroundVerdict {
	return decideBackground({ ...DESKTOP, ...patch });
}
// #endregion

// #region Named rows
Deno.test("gate: a capable desktop follows the pointer", () => {
	assertEquals(decide({}), { mode: "spotlight", reason: null, pause: null });
});

Deno.test("gate: reduced motion on either channel keeps the SSR paint", () => {
	const still: BackgroundVerdict = { mode: "static", reason: "reduced-motion", pause: null };
	assertEquals(decide({ reducedMotionMedia: true }), still);
	assertEquals(decide({ dataMotionReduced: true }), still);
	assertEquals(decide({ dataMotionReduced: true, force: "spotlight" }), still);
	assertEquals(decide({ reducedMotionMedia: true, finePointer: false }), still);
});

Deno.test("gate: a touch pointer keeps the SSR paint", () => {
	assertEquals(decide({ finePointer: false }), {
		mode: "static",
		reason: "coarse-pointer",
		pause: null,
	});
});

Deno.test("gate: Save-Data, low memory and low cores keep the SSR paint", () => {
	assertEquals(decide({ saveData: true }), { mode: "static", reason: "save-data", pause: null });
	assertEquals(decide({ deviceMemory: 2 }), { mode: "static", reason: "low-memory", pause: null });
	assertEquals(decide({ hardwareConcurrency: 4 }), {
		mode: "static",
		reason: "low-cpu",
		pause: null,
	});
	assertEquals(decide({ deviceMemory: 4, hardwareConcurrency: 5 }).mode, "spotlight");
});

Deno.test("gate: unknown hints pass", () => {
	assertEquals(decide({ deviceMemory: null }).mode, "spotlight");
	assertEquals(decide({ hardwareConcurrency: null }).mode, "spotlight");
});

Deno.test("gate: a hidden tab or an offscreen hero pauses, never changes the mode", () => {
	assertEquals(decide({ hidden: true }), { mode: "spotlight", reason: null, pause: "hidden" });
	assertEquals(decide({ intersecting: false }), {
		mode: "spotlight",
		reason: null,
		pause: "offscreen",
	});
	assertEquals(decide({ hidden: true, intersecting: false }).pause, "hidden");
	assertEquals(decide({ saveData: true, intersecting: false }).pause, null);
});

Deno.test("gate: forced paths — static wins over all, spotlight skips only the device gates", () => {
	assertEquals(decide({ force: "static" }), {
		mode: "static",
		reason: "forced-static",
		pause: null,
	});
	assertEquals(
		decide({
			force: "spotlight",
			finePointer: false,
			saveData: true,
			deviceMemory: 1,
			hardwareConcurrency: 2,
		}),
		{ mode: "spotlight", reason: null, pause: null },
	);
	assertEquals(decide({ force: "spotlight", forcedColors: true }).reason, "forced-colors");
});

Deno.test("gate: forced colours paint no background layer at all", () => {
	assertEquals(decide({ forcedColors: true }), {
		mode: "static",
		reason: "forced-colors",
		pause: null,
	});
});

Deno.test("gate: parseBackgroundForce accepts only the two forced paths", () => {
	assertEquals(parseBackgroundForce("spotlight"), "spotlight");
	assertEquals(parseBackgroundForce("static"), "static");
	assertEquals(parseBackgroundForce("auto"), "auto");
	assertEquals(parseBackgroundForce("webgl"), "auto");
	assertEquals(parseBackgroundForce("SPOTLIGHT"), "auto");
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
	const forces: BackgroundForce[] = ["auto", "static", "spotlight"];
	for (const reducedMotionMedia of bools) {
		for (const dataMotionReduced of bools) {
			for (const saveData of bools) {
				for (const deviceMemory of memories) {
					for (const hardwareConcurrency of cores) {
						for (const finePointer of bools) {
							for (const forcedColors of bools) {
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

/** The spec's rules restated independently of the implementation's control flow. */
function oracle(s: BackgroundSnapshot): BackgroundVerdict {
	const reduced = s.reducedMotionMedia || s.dataMotionReduced;
	if (s.force === "static" || s.forcedColors || reduced) {
		const reason = s.force === "static"
			? "forced-static"
			: s.forcedColors
			? "forced-colors"
			: "reduced-motion";
		return { mode: "static", reason, pause: null };
	}
	const memoryOk = s.deviceMemory === null || s.deviceMemory >= 4;
	const coresOk = s.hardwareConcurrency === null || s.hardwareConcurrency > 4;
	const capable = s.force === "spotlight" ||
		(s.finePointer && !s.saveData && memoryOk && coresOk);
	if (capable) {
		return {
			mode: "spotlight",
			reason: null,
			pause: s.hidden ? "hidden" : s.intersecting ? null : "offscreen",
		};
	}
	const reason = !s.finePointer
		? "coarse-pointer"
		: s.saveData
		? "save-data"
		: !memoryOk
		? "low-memory"
		: "low-cpu";
	return { mode: "static", reason, pause: null };
}

Deno.test("gate: every combination matches the spec's rules", () => {
	let count = 0;
	for (const s of snapshots()) {
		assertEquals(decideBackground(s), oracle(s), JSON.stringify(s));
		count += 1;
	}
	assertEquals(count, 2 ** 7 * 4 * 4 * 3);
});

Deno.test("gate: invariants — never moving under reduced motion, a fine pointer unless forced", () => {
	for (const s of snapshots()) {
		const v = decideBackground(s);
		const reduced = s.reducedMotionMedia || s.dataMotionReduced;
		if (reduced || s.forcedColors) assertEquals(v.mode, "static");
		if (v.mode === "spotlight") {
			assertEquals(v.reason, null);
			assertEquals(s.finePointer || s.force === "spotlight", true);
			assertEquals(v.pause !== null, s.hidden || !s.intersecting);
		} else {
			assertEquals(v.reason === null, false);
			assertEquals(v.pause, null);
		}
	}
});
// #endregion
