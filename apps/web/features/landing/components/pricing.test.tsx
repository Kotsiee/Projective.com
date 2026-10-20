/**
 * Pricing as the server renders it (`flows/LANDING.md` §2.1 notes 21–22, §4.9; claims C1–C7, E1,
 * N9): with the fee, the h2 "A 5% fee. You pay the price you see.", the lead, the worked and
 * rounding examples computed from the fee, and the calculator panel with its notes; without it,
 * every fee clause, both examples and the panel drop. Then the calculator's own body in each state.
 * `Pricing` itself mounts the island, whose stylesheets cannot load under `deno test`, so the
 * section is rendered from the parts it composes, with a stand-in where the island goes.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";
import { CALCULATOR_COPY, PRICING_COPY, splitStage } from "../core/pricing-calc.ts";
import {
	CALC_IDS,
	type CalculatorState,
	PRICING_TITLE_ID,
	PricingCalculatorView,
	PricingSection,
} from "./PricingView.tsx";

// #region Fixtures
const STAND_IN = <div class="stand-in" data-island="PricingCalculator" />;

function section(feeBp: number | null): string {
	const fee = feeBp === null ? null : { bp: feeBp, label: formatFeePercent(feeBp) };
	return renderToString(<PricingSection fee={fee} calculator={STAND_IN} />);
}

function calculator(state: CalculatorState, text = "2,000", live = true): string {
	return renderToString(
		<PricingCalculatorView
			feeLabel="5%"
			text={text}
			state={state}
			split={splitStage(200_000, 500)}
			live={live}
			announcement=""
		/>,
	);
}

/** The text of an HTML fragment: inline tags dropped, block tags as spaces, whitespace folded. */
function text(html: string): string {
	return html
		.replace(/<\/?span\b[^>]*>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
// #endregion

// #region Section
Deno.test("with the fee: one labelled h2 naming it, the body, both examples and the panel", () => {
	const html = section(500);
	assertMatch(
		html,
		new RegExp(`<section id="pricing" class="lp-pricing" aria-labelledby="${PRICING_TITLE_ID}">`),
	);
	assertEquals(html.match(/<h2\b/g)?.length, 1);
	assertMatch(
		html,
		/<h2 id="pricing-title"[^>]*>.*A 5% fee\..*You pay the price you see\..*<\/h2>/,
	);
	const words = text(html);
	assert(words.includes("A 5% fee. You pay the price you see."));
	assert(
		words.includes(
			"The fee comes out of the team's payment when it's paid out. You pay the stage price, with nothing on top. There's no fee on refunds.",
		),
	);
	assert(
		words.includes("On a £2,000 stage you pay £2,000. The team receives £1,900 after the 5% fee."),
	);
	assert(words.includes("On a £10.50 stage, the fee is 52p and the team receives £9.98."));
	assertMatch(
		html,
		/<div class="lp-calc"><div class="stand-in" data-island="PricingCalculator"><\/div>/,
	);
	for (const note of PRICING_COPY.notes) assert(words.includes(note), note);
	assertMatch(html, /lp-pricing__inner lp-pricing__inner--calc/);
});

Deno.test("the fee is read, never assumed: another rate changes every figure", () => {
	const words = text(section(250));
	assert(words.includes("A 2.5% fee."));
	assert(words.includes("The team receives £1,950 after the 2.5% fee."));
	assert(words.includes("the fee is 26p and the team receives £10.24."));
	assertFalse(words.includes(" 5% fee"));
});

Deno.test("without the fee: no fee clause, no examples, no panel — the island still mounts", () => {
	const html = section(null);
	const words = text(html);
	assertMatch(
		html,
		/<h2 id="pricing-title"[^>]*><span class="lp-pricing__line">You pay the price you see\.<\/span><\/h2>/,
	);
	assertFalse(words.includes("fee."), "no fee sentence in the heading");
	assertFalse(/\d%/.test(words), "no percentage anywhere");
	assertFalse(words.includes("On a £"), "no worked or rounding example");
	assertFalse(html.includes('lp-calc"'), "no panel");
	assertFalse(html.includes("lp-calc__notes"), "no notes");
	assertFalse(html.includes("lp-pricing__inner--calc"));
	assert(html.includes('data-island="PricingCalculator"'), "the stylesheet carrier stays");
	// The body names no figure, so it stays.
	assert(words.includes("You pay the stage price, with nothing on top."));
});

Deno.test("no banned or omitted wording, and nothing in amber (§4.9 'must not show', #281)", () => {
	for (const html of [section(500), section(null), calculator("ok")]) {
		const words = text(html).toLowerCase();
		for (
			const banned of [
				"flat",
				"until you approve",
				"no bidding",
				"processing",
				"card fee",
				"instant",
				"+ 5%",
			]
		) {
			assertFalse(words.includes(banned), banned);
		}
		assertFalse(html.includes("amber") || html.includes("lp-btn--accent"));
	}
});
// #endregion

// #region Calculator
Deno.test("the calculator's rows at £2,000: You pay · from the team's payment · fee · team receives", () => {
	const html = calculator("ok");
	assertEquals(
		text(html).replace(/^.*?You pay/, "You pay"),
		"You pay £2,000.00 From the team's payment: Projective fee (5%) −£100.00 The team receives £1,900.00",
	);
	assertMatch(html, /<div class="lp-calc__results" data-state="ok">/);
	assertFalse(html.includes(CALCULATOR_COPY.empty));
	assertFalse(html.includes(CALCULATOR_COPY.invalid));
	assertMatch(
		html,
		/<p class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">/,
	);
});

Deno.test("the field: labelled, decimal keyboard, described by its prefix and hint", () => {
	const html = calculator("ok");
	assertMatch(
		html,
		new RegExp(`<label class="lp-calc__label" for="${CALC_IDS.input}">Stage price</label>`),
	);
	assertMatch(html, /inputmode="decimal"/);
	assertMatch(html, new RegExp(`aria-describedby="${CALC_IDS.prefix} ${CALC_IDS.hint}"`));
	assertMatch(html, /value="2,000"/);
	assert(text(html).includes("Type what one stage costs."));
	assert(text(html).includes("Try: £500 · £2,000 · £5,000"));
	assertFalse(html.includes("aria-invalid"));
});

Deno.test("before hydration the controls are not shown, the default price is text (gate 11)", () => {
	const before = calculator("ok", "2,000", false);
	assertMatch(before, /<div class="lp-calc__controls"\s*>/);
	assertMatch(
		before,
		/<div class="lp-calc__static"\s*><p class="lp-calc__label">Stage price<\/p><p class="lp-calc__static-price">£2,000<\/p><\/div>/,
	);
	assertFalse(/\sdisabled\b/.test(before), "never a dead control, disabled or not");
	const after = calculator("ok", "2,000", true);
	assertMatch(after, /<div class="lp-calc__controls" data-live="">/);
	assertMatch(after, /<div class="lp-calc__static" aria-hidden="true">/);
	assertFalse(/\sdisabled\b/.test(after));
});

Deno.test("empty: the rows hold their room, hidden, and the empty message shows", () => {
	const html = calculator("empty", "");
	assertMatch(html, /<div class="lp-calc__results" data-state="empty">/);
	assertMatch(html, /<div class="lp-calc__rows" aria-hidden="true">/);
	assert(text(html).includes("Type a stage price to see who gets what."));
	assertFalse(html.includes("aria-invalid"));
	assertMatch(
		html,
		new RegExp(`aria-describedby="${CALC_IDS.prefix} ${CALC_IDS.hint} ${CALC_IDS.state}"`),
		"the field is described by the prompt it shows",
	);
});

Deno.test("invalid: the field is marked invalid and described by the message", () => {
	const html = calculator("invalid", "20o0");
	assertMatch(html, /aria-invalid="true"/);
	assertMatch(
		html,
		new RegExp(`aria-describedby="${CALC_IDS.prefix} ${CALC_IDS.hint} ${CALC_IDS.state}"`),
	);
	assertMatch(
		html,
		new RegExp(
			`<p id="${CALC_IDS.state}" class="lp-calc__state">Use numbers only, like 2000 or 2000.50.</p>`,
		),
	);
	assertMatch(html, /<div class="lp-calc__rows" aria-hidden="true">/);
});

Deno.test("a free stage shows no minus on a zero fee", () => {
	const html = renderToString(
		<PricingCalculatorView
			feeLabel="0%"
			text="2,000"
			state="ok"
			split={splitStage(200_000, 0)}
			live
			announcement=""
		/>,
	);
	assertMatch(html, /<dt>Projective fee \(0%\)<\/dt><dd>£0\.00<\/dd>/);
});
// #endregion
