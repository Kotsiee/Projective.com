/**
 * "The numbers so far" as the server renders it (`flows/LANDING.md` §4.7; claims Y1–Y4; Decision
 * #277): one h2 labelling the section, the subline with its UTC date, up to three figures — each
 * hidden when the service withheld it — and nothing at all when no figure is left or the read
 * failed. Never a 0, a dash, a skeleton or an estimate.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { PublicMetrics } from "@projective/types/marketing";
import { roundHours } from "@server/services/marketing/public-metrics-model.ts";
import {
	asOfDate,
	LIVE_NUMBERS_COPY,
	LiveNumbers,
	liveNumberTiles,
	NUMBERS_TITLE_ID,
	withinHours,
} from "./LiveNumbers.tsx";

// #region Fixtures
const FULL: PublicMetrics = {
	asOf: "2026-10-17T21:07:08.982Z",
	minN: 10,
	platformFeeBp: 500,
	totalValueProtected: { amountMinor: 15_000_000, currency: "GBP", converted: false },
	stagesDelivered: 1204,
	medianFundingToApprovalHours: 36.1,
};

/** Every nullable figure withheld: what the development seed answers (#277 (E)). */
const NONE: PublicMetrics = {
	...FULL,
	totalValueProtected: null,
	stagesDelivered: null,
	medianFundingToApprovalHours: null,
};

function render(metrics: PublicMetrics | null): string {
	return renderToString(<LiveNumbers metrics={metrics} />);
}

/** The text of an HTML fragment: inline tags dropped, block tags as spaces, whitespace folded. */
function text(html: string): string {
	return html
		.replace(/<\/?(?:time|span)\b[^>]*>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
// #endregion

// #region Threshold hiding
Deno.test("all three withheld: the section, h2 included, is not rendered", () => {
	assertEquals(render(NONE), "");
});

Deno.test("a failed read (null): nothing is rendered", () => {
	assertEquals(render(null), "");
});

Deno.test("all three present: one labelled section, three figures in row order", () => {
	const html = render(FULL);
	assertMatch(
		html,
		new RegExp(`<section id="numbers" class="lp-numbers" aria-labelledby="${NUMBERS_TITLE_ID}">`),
	);
	assertEquals(html.match(/<h2\b/g)?.length, 1);
	assertMatch(
		html,
		new RegExp(`<h2 id="${NUMBERS_TITLE_ID}"[^>]*>${LIVE_NUMBERS_COPY.heading}</h2>`),
	);
	assertEquals(html.match(/class="lp-numbers__item /g)?.length, 3);
	const at = (s: string) => html.indexOf(s);
	assert(at("lp-numbers__item--protected") < at("lp-numbers__item--stages"));
	assert(at("lp-numbers__item--stages") < at("lp-numbers__item--median"));
	assertEquals(
		text(html),
		"The numbers so far Counted from real payments on Projective, as of 17 Oct 2026. " +
			"At least £150,000 Money protected so far " +
			"1,204 Stages delivered Approved and paid out. " +
			"37 hours Half of approved stages were approved within this time of being paid for.",
	);
	assertMatch(html, /<time datetime="2026-10-17T21:07:08.982Z">17 Oct 2026<\/time>/);
});

Deno.test("partial: a withheld figure has no tile, and the others keep their order", () => {
	const noMoney = render({ ...FULL, totalValueProtected: null });
	assertFalse(noMoney.includes("lp-numbers__item--protected"));
	assertFalse(noMoney.includes(LIVE_NUMBERS_COPY.protected));
	assertFalse(noMoney.includes(LIVE_NUMBERS_COPY.floor));
	assertEquals(noMoney.match(/class="lp-numbers__item /g)?.length, 2);

	const onlyStages = render({ ...NONE, stagesDelivered: 12 });
	assertEquals(onlyStages.match(/class="lp-numbers__item /g)?.length, 1);
	assertMatch(onlyStages, /lp-numbers__item--stages/);
	assertFalse(onlyStages.includes("hours"));

	const onlyMedian = liveNumberTiles({ ...NONE, medianFundingToApprovalHours: 0.4 });
	assertEquals(onlyMedian.map((t) => t.key), ["median"]);
});

Deno.test("a converted protected total has no tile: Y1 is never a figure built on rates", () => {
	const converted = render({
		...FULL,
		totalValueProtected: { amountMinor: 15_000_000, currency: "GBP", converted: true },
	});
	assertFalse(converted.includes("lp-numbers__item--protected"));
	assertFalse(converted.includes(LIVE_NUMBERS_COPY.protected));
	assertFalse(converted.includes(LIVE_NUMBERS_COPY.floor));
	assertEquals(converted.match(/class="lp-numbers__item /g)?.length, 2);
	assertEquals(
		liveNumberTiles({
			...NONE,
			totalValueProtected: { amountMinor: 15_000_000, currency: "GBP", converted: true },
		}),
		[],
	);
});

Deno.test("never a 0: a figure that would print as nothing has no tile", () => {
	assertEquals(liveNumberTiles({ ...NONE, stagesDelivered: 0 }), []);
	assertEquals(
		liveNumberTiles({
			...NONE,
			totalValueProtected: { amountMinor: 0, currency: "GBP", converted: false },
		}),
		[],
	);
	// Under one whole unit would floor to "£0".
	assertEquals(
		liveNumberTiles({
			...NONE,
			totalValueProtected: { amountMinor: 99, currency: "GBP", converted: false },
		}),
		[],
	);
	assertEquals(render({ ...NONE, stagesDelivered: 0 }), "");
	// A median under an hour reads "1 hour", never "0 hours".
	assertEquals(withinHours(0), { value: "1", unit: "hour" });
	assertEquals(withinHours(0.4), { value: "1", unit: "hour" });
});
// #endregion

// #region Formatting
Deno.test("the protected total is the floor it is: 'At least', /about's formatter, its own currency", () => {
	const [tile] = liveNumberTiles({
		...NONE,
		totalValueProtected: { amountMinor: 15_100_000, currency: "USD", converted: false },
	});
	assertEquals(tile.qualifier, "At least");
	assertEquals(tile.figure, { text: "US$151,000" });
	// Compact above a million, the exact published amount spoken.
	const [big] = liveNumberTiles({
		...NONE,
		totalValueProtected: { amountMinor: 1_200_000_000, currency: "GBP", converted: false },
	});
	assertEquals(big.figure, { text: "£12M", spoken: "£12,000,000" });
	const html = render({
		...NONE,
		totalValueProtected: { amountMinor: 1_200_000_000, currency: "GBP", converted: false },
	});
	assertMatch(
		html,
		/<span aria-hidden="true">£12M<\/span><span class="ui-visually-hidden">£12,000,000<\/span>/,
	);
	assertFalse(/approx|~|about/i.test(text(html)));
});

Deno.test("the median rounds up to the whole hour, so 'within' stays true", () => {
	assertEquals(withinHours(36), { value: "36", unit: "hours" });
	assertEquals(withinHours(36.1), { value: "37", unit: "hours" });
	assertEquals(withinHours(36.000000001), { value: "36", unit: "hours" });
	assertEquals(withinHours(1), { value: "1", unit: "hour" });
	assertEquals(withinHours(1204.5), { value: "1,205", unit: "hours" });
});

Deno.test("a median just over the hour stays 'within' end to end: the service rounds it up, then the tile", () => {
	// 36.04 h published to the nearest tenth would be 36.0 and print "36 hours", false of the
	// stages that took 36.04; the service publishes 36.1, which prints 37.
	const published = roundHours(36.04);
	assertEquals(published, 36.1);
	assertEquals(withinHours(published), { value: "37", unit: "hours" });
	const tiles = liveNumberTiles({ ...NONE, medianFundingToApprovalHours: published });
	assertEquals(tiles.map((t) => [t.key, t.figure.text, t.unit]), [["median", "37", "hours"]]);
	for (const median of [0.01, 1.96, 12.3, 36.04, 47.999, 395.999978254167]) {
		const shown = Number(withinHours(roundHours(median)).value.replace(/,/g, ""));
		assert(shown >= median, `${median} h prints within ${shown} hours`);
	}
});

Deno.test("asOf prints as a UTC date", () => {
	assertEquals(asOfDate("2026-10-17T23:59:00.000Z"), "17 Oct 2026");
	assertEquals(asOfDate("2026-10-17T23:59:00.000-05:00"), "18 Oct 2026");
	assertEquals(asOfDate("not a date"), "");
});

Deno.test("no figure from the omitted sources, and no banned words (§4.7, §5.1)", () => {
	const words = text(render(FULL)).toLowerCase();
	for (const banned of ["tvl", "approx", "escrow", "all stages", "half of all", "—", "estimate"]) {
		assertFalse(words.includes(banned), banned);
	}
});
// #endregion
