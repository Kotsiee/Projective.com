import { assertEquals } from "@std/assert";
import type { PublicMetrics } from "@projective/types/marketing";
import {
	aboutMetricTiles,
	formatAsOf,
	formatFeePercent,
	formatMetricCount,
	formatMetricDuration,
	formatMetricMoney,
	withheldNotice,
} from "./metric-format.ts";

const FULL: PublicMetrics = {
	asOf: "2026-10-17T21:07:08.982Z",
	minN: 10,
	platformFeeBp: 500,
	totalValueProtected: { amountMinor: 15_100_099, currency: "USD", converted: false },
	stagesDelivered: 1204,
	medianFundingToApprovalHours: 396,
};

// #region Formatters
Deno.test("formatMetricMoney: whole units, rounded down, grouped below a million", () => {
	assertEquals(formatMetricMoney(15_100_099, "USD"), { text: "US$151,000" });
	assertEquals(formatMetricMoney(99, "GBP"), { text: "£0" });
	assertEquals(formatMetricMoney(1_999, "GBP"), { text: "£19" });
	// Yen has no minor unit.
	assertEquals(formatMetricMoney(5_000, "JPY"), { text: "JP¥5,000" });
});

Deno.test("formatMetricMoney: compact above a million, floored to 3 figures, spoken exactly", () => {
	assertEquals(formatMetricMoney(1_238_999_99, "GBP"), { text: "£1.23M", spoken: "£1,238,999" });
	// 12,389,000 would round UP to 12.4M; floored first it never overstates.
	assertEquals(formatMetricMoney(12_389_000_00, "GBP"), { text: "£12.3M", spoken: "£12,389,000" });
});

Deno.test("formatMetricMoney: an unknown code still prints a number with its code", () => {
	assertEquals(formatMetricMoney(12_345, "ZZZ").text.includes("123"), true);
});

Deno.test("formatMetricCount / formatFeePercent", () => {
	assertEquals(formatMetricCount(1204), "1,204");
	assertEquals(formatMetricCount(9.9), "9");
	assertEquals(formatFeePercent(500), "5%");
	assertEquals(formatFeePercent(250), "2.5%");
	assertEquals(formatFeePercent(125), "1.25%");
	assertEquals(formatFeePercent(0), "0%");
});

Deno.test("formatMetricDuration: hours below two days, days after, never a zero", () => {
	assertEquals(formatMetricDuration(0.4), "Under an hour");
	assertEquals(formatMetricDuration(1), "1 hour");
	assertEquals(formatMetricDuration(36.4), "36 hours");
	assertEquals(formatMetricDuration(47.9), "48 hours");
	assertEquals(formatMetricDuration(48), "2 days");
	assertEquals(formatMetricDuration(396), "16.5 days");
	assertEquals(formatMetricDuration(Number.NaN), "Under an hour");
});

Deno.test("formatAsOf: UTC, minute precision, empty for a bad instant", () => {
	assertEquals(formatAsOf("2026-10-17T21:07:08.982Z"), "17 Oct 2026, 21:07 UTC");
	assertEquals(formatAsOf("2026-01-02T03:04:00+05:00"), "1 Jan 2026, 22:04 UTC");
	assertEquals(formatAsOf("soon"), "");
});
// #endregion

// #region Tiles
Deno.test("aboutMetricTiles: every published figure in row order, the fee last", () => {
	const tiles = aboutMetricTiles(FULL);
	assertEquals(tiles.map((t) => t.key), ["protected", "stages", "median", "fee"]);
	assertEquals(tiles.map((t) => t.value.text), ["US$151,000", "1,204", "16.5 days", "5%"]);
	for (const tile of tiles) assertEquals(tile.caption.length > 0, true);
});

Deno.test("aboutMetricTiles: a withheld figure has no tile at all — never a dash or a zero", () => {
	const tiles = aboutMetricTiles({
		...FULL,
		totalValueProtected: null,
		stagesDelivered: null,
		medianFundingToApprovalHours: null,
	});
	assertEquals(tiles.map((t) => t.key), ["fee"]);
});

Deno.test("withheldNotice: names only what is hidden, and the threshold", () => {
	assertEquals(withheldNotice(FULL), null);
	assertEquals(
		withheldNotice({ ...FULL, stagesDelivered: null }),
		"Stages delivered appears here once it rests on at least 10 records — we don't publish figures too small to mean anything.",
	);
	assertEquals(
		withheldNotice({
			...FULL,
			totalValueProtected: null,
			stagesDelivered: null,
			medianFundingToApprovalHours: null,
			minN: 25,
		}),
		"Money protected, stages delivered and the funding-to-approval time appear here once each rests on at least 25 records — we don't publish figures too small to mean anything.",
	);
});
// #endregion
