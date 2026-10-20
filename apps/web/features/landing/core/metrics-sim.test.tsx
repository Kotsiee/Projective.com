/**
 * metrics-sim.test — the `landingMetrics` Dev Context Switcher axis forces the numbers section's
 * threshold result (`flows/LANDING.md` §6): `hidden` omits the section, `shown` draws every tile,
 * and neither touches the fee or rescues a failed read.
 */
import { assertEquals } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { PublicMetrics } from "@projective/types/marketing";
import { LiveNumbers, liveNumberTiles } from "../components/LiveNumbers.tsx";
import {
	applyLandingMetricsSim,
	LANDING_METRICS_SAMPLE,
	parseLandingMetricsSim,
} from "./metrics-sim.ts";

// #region Fixtures
/** The development seed's answer: below the threshold, only the fee. */
const SEED: PublicMetrics = {
	asOf: "2026-10-17T21:07:08.982Z",
	minN: 10,
	platformFeeBp: 500,
	totalValueProtected: null,
	stagesDelivered: null,
	medianFundingToApprovalHours: null,
};
// #endregion

Deno.test("parseLandingMetricsSim: the two values, anything else ignored", () => {
	assertEquals(parseLandingMetricsSim("hidden"), "hidden");
	assertEquals(parseLandingMetricsSim(" shown "), "shown");
	assertEquals(parseLandingMetricsSim("auto"), null);
	assertEquals(parseLandingMetricsSim(""), null);
	assertEquals(parseLandingMetricsSim(undefined), null);
});

Deno.test("shown: every tile renders on the seed, with the read's own date and fee", () => {
	const shown = applyLandingMetricsSim(SEED, "shown");
	assertEquals(shown?.platformFeeBp, 500);
	assertEquals(shown?.asOf, SEED.asOf);
	assertEquals(shown?.totalValueProtected, LANDING_METRICS_SAMPLE.totalValueProtected);
	assertEquals(liveNumberTiles(shown!).map((tile) => tile.key), ["protected", "stages", "median"]);
});

Deno.test("hidden: the section is omitted even when the read clears the threshold", () => {
	const full = applyLandingMetricsSim(SEED, "shown")!;
	const hidden = applyLandingMetricsSim(full, "hidden");
	assertEquals(hidden?.platformFeeBp, 500, "the fee is never simulated away");
	assertEquals(renderToString(<LiveNumbers metrics={hidden} />), "");
});

Deno.test("no simulation, or a failed read, passes through untouched", () => {
	assertEquals(applyLandingMetricsSim(SEED, null), SEED);
	assertEquals(applyLandingMetricsSim(null, "shown"), null);
	assertEquals(applyLandingMetricsSim(null, "hidden"), null);
});
