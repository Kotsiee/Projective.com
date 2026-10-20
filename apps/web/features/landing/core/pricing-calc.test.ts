/**
 * The Pricing calculator's arithmetic against the database's (`flows/LANDING.md` §4.9; claims
 * C1–C7). At every release `fn_release_ticket_escrow` takes the fee as an integer division and pays
 * the rest (`supabase/migrations/00001200_functions_finance_core.sql:742-744`):
 *
 *   v_fee    := (r.amount_cents * v_fee_bp) / 10000;                           -- :743
 *   v_payout := r.amount_cents + COALESCE(r.deadline_bonus_cents, 0) - v_fee;  -- :744
 *
 * with the rate from `fn_escrow_fee_bp` (`:691-707`). `bigint / integer` truncates toward zero,
 * which for a non-negative amount is the floor: these tests restate that rule independently
 * ({@link sqlFee}) and pin the calculator to it on the worked examples, odd pennies and rates other
 * than today's 500 bp — the fee is read live, never assumed.
 */
import { assertEquals } from "@std/assert";
import {
	CALCULATOR_COPY,
	calculatorAnnouncement,
	DEFAULT_PRICE_MINOR,
	formatPounds,
	formatPoundsShort,
	formatPriceInput,
	parseStagePrice,
	PRICE_MAX_MINOR,
	PRICE_STEP_MINOR,
	PRICING_COPY,
	splitStage,
	stepPrice,
} from "./pricing-calc.ts";

/** SQL's `(amount * bp) / 10000` on bigints: integer division, truncating toward zero. */
function sqlFee(amountMinor: number, bp: number): number {
	return Number((BigInt(amountMinor) * BigInt(bp)) / 10_000n);
}

// #region Arithmetic — fn_release_ticket_escrow (00001200:742-744)
Deno.test("the worked example: £2,000 at 500 bp — the fee is £100, the team receives £1,900 (C4)", () => {
	assertEquals(splitStage(200_000, 500), {
		priceMinor: 200_000,
		feeMinor: 10_000,
		netMinor: 190_000,
	});
});

Deno.test("the rounding example: £10.50 at 500 bp — floor(52.5) = 52p, the team receives £9.98 (C5)", () => {
	assertEquals(splitStage(1050, 500), { priceMinor: 1050, feeMinor: 52, netMinor: 998 });
});

Deno.test("odd pennies truncate the fee down, never up (C6)", () => {
	// 1999 × 500 / 10000 = 99.95 → 99; 19 × 500 / 10000 = 0.95 → 0; 33,333 × 500 / 10000 = 1666.65 → 1666.
	assertEquals(splitStage(1999, 500), { priceMinor: 1999, feeMinor: 99, netMinor: 1900 });
	assertEquals(splitStage(19, 500), { priceMinor: 19, feeMinor: 0, netMinor: 19 });
	assertEquals(splitStage(33_333, 500), { priceMinor: 33_333, feeMinor: 1666, netMinor: 31_667 });
	// 150,001 × 275 / 10000 = 4125.0275 → 4125, at a rate other than today's.
	assertEquals(splitStage(150_001, 275).feeMinor, 4125);
});

Deno.test("every price and rate matches SQL's integer division, and the parts add back up", () => {
	const prices = [1, 7, 99, 100, 101, 1010, 1049, 1050, 1051, 9_999, 200_000, 200_050, 1_234_567];
	for (const bp of [0, 1, 125, 250, 275, 333, 500, 1_000, 10_000]) {
		for (const price of [...prices, PRICE_MAX_MINOR]) {
			const split = splitStage(price, bp);
			assertEquals(split.feeMinor, sqlFee(price, bp), `${price} at ${bp} bp`);
			assertEquals(split.netMinor, price - sqlFee(price, bp), `${price} at ${bp} bp`);
			assertEquals(split.feeMinor + split.netMinor, price);
		}
	}
});

Deno.test("nothing to pay, nothing taken: a zero price or a zero rate has no fee (C7's spirit)", () => {
	assertEquals(splitStage(0, 500), { priceMinor: 0, feeMinor: 0, netMinor: 0 });
	assertEquals(splitStage(200_000, 0), { priceMinor: 200_000, feeMinor: 0, netMinor: 200_000 });
});

Deno.test("the steppers move £100 and stay between nothing and the cap", () => {
	assertEquals(stepPrice(200_000, 1), 200_000 + PRICE_STEP_MINOR);
	assertEquals(stepPrice(200_000, -1), 200_000 - PRICE_STEP_MINOR);
	assertEquals(stepPrice(5_000, -1), 0);
	assertEquals(stepPrice(null, 1), PRICE_STEP_MINOR);
	assertEquals(stepPrice(null, -1), 0);
	assertEquals(stepPrice(PRICE_MAX_MINOR, 1), PRICE_MAX_MINOR);
});
// #endregion

// #region Parsing
Deno.test("pounds and pence parse to exact pence", () => {
	assertEquals(parseStagePrice("2000"), { kind: "ok", minor: 200_000 });
	assertEquals(parseStagePrice("2000.50"), { kind: "ok", minor: 200_050 });
	assertEquals(parseStagePrice("2000.5"), { kind: "ok", minor: 200_050 });
	assertEquals(parseStagePrice("10.50"), { kind: "ok", minor: 1050 });
	assertEquals(parseStagePrice("2000.10"), { kind: "ok", minor: 200_010 });
	assertEquals(parseStagePrice("0.07"), { kind: "ok", minor: 7 });
	assertEquals(parseStagePrice(".5"), { kind: "ok", minor: 50 });
	assertEquals(parseStagePrice("0"), { kind: "ok", minor: 0 });
	assertEquals(parseStagePrice("002000"), { kind: "ok", minor: 200_000 });
});

Deno.test("the field's own forms parse: a £ sign, grouping, spaces, a trailing point", () => {
	assertEquals(parseStagePrice("£2,000"), { kind: "ok", minor: 200_000 });
	assertEquals(parseStagePrice(" £ 2,000.50 "), { kind: "ok", minor: 200_050 });
	assertEquals(parseStagePrice("1,234,567"), { kind: "ok", minor: 123_456_700 });
	assertEquals(parseStagePrice("2 000"), { kind: "ok", minor: 200_000 });
	assertEquals(parseStagePrice("2000."), { kind: "ok", minor: 200_000 });
});

Deno.test("nothing typed is empty", () => {
	assertEquals(parseStagePrice(""), { kind: "empty" });
	assertEquals(parseStagePrice("   "), { kind: "empty" });
	assertEquals(parseStagePrice("£"), { kind: "empty" });
});

Deno.test("negatives, letters, a third decimal place, bad grouping and NaN are invalid", () => {
	for (
		const text of [
			"-5",
			"-2000",
			"−2000",
			"abc",
			"20o0",
			"1e3",
			"NaN",
			"Infinity",
			"2000.505",
			"2,00",
			"20,00",
			"2,000,00",
			".",
			"2..0",
			"$2000",
			"2000£",
		]
	) {
		assertEquals(parseStagePrice(text), { kind: "invalid" }, text);
	}
});

Deno.test("a price over the sane maximum is invalid; the maximum itself is fine", () => {
	assertEquals(parseStagePrice("10000000"), { kind: "ok", minor: PRICE_MAX_MINOR });
	assertEquals(parseStagePrice("10000000.01"), { kind: "invalid" });
	assertEquals(parseStagePrice("99999999"), { kind: "invalid" });
	assertEquals(parseStagePrice("99999999999999999999"), { kind: "invalid" });
});
// #endregion

// #region Formatting and copy
Deno.test("calculator figures always show pence; sentences drop them when whole", () => {
	assertEquals(formatPounds(200_000), "£2,000.00");
	assertEquals(formatPounds(52), "£0.52");
	assertEquals(formatPounds(123_456_789), "£1,234,567.89");
	assertEquals(formatPoundsShort(200_000), "£2,000");
	assertEquals(formatPoundsShort(998), "£9.98");
	assertEquals(formatPoundsShort(1050), "£10.50");
	assertEquals(formatPoundsShort(52), "52p");
	assertEquals(formatPoundsShort(0), "0p");
	assertEquals(formatPriceInput(DEFAULT_PRICE_MINOR), "2,000");
	assertEquals(formatPriceInput(200_050), "2,000.50");
	assertEquals(formatPriceInput(5), "0.05");
	for (const minor of [0, 5, 99, 1050, 200_050, 123_456_789]) {
		assertEquals(parseStagePrice(formatPriceInput(minor)), { kind: "ok", minor });
	}
});

Deno.test("the section's sentences are §4.9's, every figure computed from the fee (C1, C4, C5)", () => {
	assertEquals(PRICING_COPY.headingFee("5%"), "A 5% fee.");
	assertEquals(
		PRICING_COPY.workedExample("5%", 500),
		"On a £2,000 stage you pay £2,000. The team receives £1,900 after the 5% fee.",
	);
	assertEquals(
		PRICING_COPY.roundingExample(500),
		"On a £10.50 stage, the fee is 52p and the team receives £9.98.",
	);
	// Another rate changes every figure, so none is a literal.
	assertEquals(
		PRICING_COPY.workedExample("2.5%", 250),
		"On a £2,000 stage you pay £2,000. The team receives £1,950 after the 2.5% fee.",
	);
	assertEquals(
		PRICING_COPY.roundingExample(250),
		"On a £10.50 stage, the fee is 26p and the team receives £10.24.",
	);
});

Deno.test("the live region reads the two figures (§4.9)", () => {
	assertEquals(
		CALCULATOR_COPY.live(splitStage(200_000, 500)),
		"You pay £2,000. The team receives £1,900.",
	);
	assertEquals(CALCULATOR_COPY.feeRow("5%"), "Projective fee (5%)");
});

Deno.test("the live region speaks every state the panel shows: figures, invalid, empty", () => {
	assertEquals(
		calculatorAnnouncement(parseStagePrice("2,000"), 500),
		"You pay £2,000. The team receives £1,900.",
	);
	assertEquals(calculatorAnnouncement(parseStagePrice("20o0"), 500), CALCULATOR_COPY.invalid);
	assertEquals(calculatorAnnouncement(parseStagePrice(""), 500), CALCULATOR_COPY.empty);
	assertEquals(CALCULATOR_COPY.empty, "Type a stage price to see who gets what.");
});

Deno.test("no banned or omitted wording reaches the section (§4, §5.1, #281)", () => {
	const words = [
		PRICING_COPY.headingFee("5%"),
		PRICING_COPY.headingPrice,
		...PRICING_COPY.body,
		PRICING_COPY.workedExample("5%", 500),
		PRICING_COPY.roundingExample(500),
		...PRICING_COPY.notes,
		...(Object.values(CALCULATOR_COPY) as unknown[]).filter((v): v is string =>
			typeof v === "string"
		),
		CALCULATOR_COPY.live(splitStage(200_000, 500)),
	].join(" ").toLowerCase();
	for (
		const banned of [
			"flat",
			"until you approve",
			"only paid when you approve",
			"when you approve",
			"no bidding",
			"card fee",
			"processing",
			"instant",
			"escrow",
			"release",
			"+ 5%",
		]
	) {
		assertEquals(words.includes(banned), false, banned);
	}
});
// #endregion
