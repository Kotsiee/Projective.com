import { assertEquals } from "@std/assert";
import { ESCROW_AGE_THRESHOLD_DAYS, EscrowAgeSchema } from "@projective/types/finance";
import { type RawEscrowAge, toEscrowAge } from "./escrow-age.ts";

/*
 * finance.read_escrow_age → EscrowAge (MR7, Decision #473). The counsel brief quotes these figures, so a
 * wrong mapping would put the wrong age, total or currency in front of counsel.
 */

// #region Fixtures
/** The shape `finance.fn_escrow_age` wrote on the seeded database (2026-11-18), plus a seat row. */
function raw(): RawEscrowAge {
	return {
		as_of: "2026-11-18T19:27:58.836205+00:00",
		rows: [
			{
				kind: "held_bound",
				currency: "USD",
				count: 5,
				total_minor: 10700000,
				oldest_at: "2026-11-05T21:40:20.816374+00:00",
				p50_days: 9.9,
				p90_days: 12.5,
				max_days: 12.9,
				over: [
					{ days: 30, count: 0, total_minor: 0 },
					{ days: 60, count: 0, total_minor: 0 },
					{ days: 90, count: 0, total_minor: 0 },
				],
			},
			{
				kind: "held_seat",
				currency: "USD",
				count: 2,
				total_minor: 850,
				oldest_at: "2026-10-29T19:27:58.836205+00:00",
				p50_days: 10,
				p90_days: 18,
				max_days: 20,
				over: [
					{ days: 30, count: 0, total_minor: 0 },
					{ days: 60, count: 0, total_minor: 0 },
					{ days: 90, count: 0, total_minor: 0 },
				],
			},
		],
	};
}
// #endregion

Deno.test("escrow age: every row maps to the camelCase read and parses", () => {
	const read = toEscrowAge(raw());
	assertEquals(EscrowAgeSchema.parse(read), read);
	assertEquals(read.asOf, "2026-11-18T19:27:58.836205+00:00");
	assertEquals(read.rows.map((row) => row.kind), ["held_bound", "held_seat"]);
	assertEquals(read.rows[0], {
		kind: "held_bound",
		currency: "USD",
		count: 5,
		totalMinor: 10700000,
		oldestAt: "2026-11-05T21:40:20.816374+00:00",
		p50Days: 9.9,
		p90Days: 12.5,
		maxDays: 12.9,
		over: [
			{ days: 30, count: 0, totalMinor: 0 },
			{ days: 60, count: 0, totalMinor: 0 },
			{ days: 90, count: 0, totalMinor: 0 },
		],
	});
	assertEquals(read.rows[0].over.map((over) => over.days), [...ESCROW_AGE_THRESHOLD_DAYS]);
});

Deno.test("escrow age: a kind this build does not know is dropped, never guessed", () => {
	const input = raw();
	input.rows!.splice(1, 0, { ...input.rows![0], kind: "frozen_forever" });
	assertEquals(toEscrowAge(input).rows.map((row) => row.kind), ["held_bound", "held_seat"]);
});

Deno.test("escrow age: an empty database reads as no rows", () => {
	assertEquals(toEscrowAge({ as_of: "2026-11-18T00:00:00+00:00", rows: null }).rows, []);
	assertEquals(toEscrowAge(null).rows, []);
});
