import { assertEquals } from "@std/assert";
import type { StorageQuota } from "../types/file-types.ts";
import { quotaRingView } from "./quota-ring.ts";

function quota(patch: Partial<StorageQuota>): StorageQuota {
	return {
		limitMib: 25_600,
		usedMib: 6_144,
		remainingMib: 19_456,
		pct: 24,
		source: "plan",
		planCode: "team_free",
		tierLabel: "Free",
		enforced: false,
		...patch,
	};
}

Deno.test("quotaRingView reads a healthy allowance as used of limit, in primary", () => {
	const view = quotaRingView(quota({}));
	assertEquals(view.unlimited, false);
	assertEquals(view.pct, 24);
	assertEquals(view.tone, "primary");
	assertEquals(view.figure, "24%");
	assertEquals(view.summary, "6 GB of 25 GB used · 24%");
});

Deno.test("quotaRingView tones a filling allowance warning, then danger", () => {
	assertEquals(quotaRingView(quota({ usedMib: 20_480, pct: 80 })).tone, "warning");
	assertEquals(quotaRingView(quota({ usedMib: 24_000, pct: 93.8 })).tone, "danger");
});

Deno.test("quotaRingView says an exceeded allowance is over, whatever the clamped percentage", () => {
	const view = quotaRingView(quota({ usedMib: 26_000, remainingMib: 0, pct: 100 }));
	assertEquals(view.tone, "danger");
	assertEquals(view.summary, "25.4 GB of 25 GB used · over the allowance");
});

Deno.test("quotaRingView reads a sliver of use as under 1%, never as an empty 0%", () => {
	const view = quotaRingView(
		quota({ limitMib: 512_000, usedMib: 6.6, remainingMib: 511_993.4, pct: 0 }),
	);
	assertEquals(view.figure, "<1%");
	assertEquals(view.summary, "6.6 MB of 500 GB used · under 1%");
});

Deno.test("quotaRingView reads an empty library as nothing stored yet", () => {
	const view = quotaRingView(quota({ usedMib: 0, remainingMib: 25_600, pct: 0 }));
	assertEquals(view.figure, "0%");
	assertEquals(view.summary, "Nothing stored yet · 25 GB available");
});

Deno.test("quotaRingView draws no arc for an unlimited allowance, only what is stored", () => {
	const view = quotaRingView(quota({ limitMib: null, remainingMib: null, pct: 0 }));
	assertEquals(view.unlimited, true);
	assertEquals(view.pct, 0);
	assertEquals(view.figure, "6 GB");
	assertEquals(view.summary, "6 GB stored · no storage limit");
	assertEquals(view.label, "Storage: 6 GB stored · no storage limit. Show storage details");
});
