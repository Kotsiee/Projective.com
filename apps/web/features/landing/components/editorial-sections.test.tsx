/**
 * Payment protection as the server renders it on `/features` (`flows/LANDING.md` §4.6; Decision #349
 * moved it off `/`): one landmark labelled by its one h2, its copy the deck's word for word, none of
 * the banned words (#281, #283), "escrow" once, every fee figure the server's rate (never a literal
 * 5%), and nothing in it a filled money control.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import {
	PaymentProtection,
	PROTECTION_COPY,
	PROTECTION_SECTION_ID,
	PROTECTION_TITLE_ID,
	protectionFlow,
} from "./PaymentProtection.tsx";

// #region Helpers
/** The text a reader gets: tags dropped, entities decoded, white space collapsed. */
function textOf(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&#x27;|&apos;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function count(haystack: string, needle: RegExp): number {
	return [...haystack.matchAll(new RegExp(needle.source, `${needle.flags.replace("g", "")}g`))]
		.length;
}

/** Words the page never says (#283 (D), #281, LANDING.md §4 "Banned in page copy", §5.1). */
const BANNED: readonly RegExp[] = [
	/\bsquads?\b/i,
	/micro-?agenc/i,
	/\bTVL\b/,
	/\bCREATE\b/,
	/\bKYC\b|\bKYB\b/,
	/\bIP\b/,
	/\brelease/i,
	/until you approve/i,
	/only paid when you approve/i,
	/\bflat\b/i,
	/no bidding/i,
	/virus/i,
	/instant payout/i,
	/next card/i,
	/card (processing )?fees?/i,
	/processing/i,
	/your work stays yours/i,
	/everyone who gets paid/i,
	/already works together/i,
];

/** A standalone "5%" — the fee as a literal (25%, 75% and 2.5% are not it). */
const FEE_LITERAL = /(?<![\d.])5%/;

/** The section's landmark and heading contract: one h2, and the section labelled by it. */
function assertLandmark(html: string, sectionId: string, titleId: string): void {
	assertEquals(count(html, /<h2\b/), 1, "one h2");
	assertEquals(count(html, /<h1\b/), 0, "no h1 (the hero's alone)");
	assertMatch(html, new RegExp(`^<section id="${sectionId}"[^>]*aria-labelledby="${titleId}"`));
	assertMatch(html, new RegExp(`<h2 id="${titleId}"`));
	assertFalse(/\sstyle="/.test(html), "no inline styles");
	assertFalse(/lp-btn--accent|lp-btn--brand/.test(html), "no amber and no brand fill here");
}

function assertNoBanned(text: string): void {
	for (const word of BANNED) assertFalse(word.test(text), `banned: ${word}`);
}
// #endregion

// #region Why it's different
// #endregion

// #region Payment protection
Deno.test("PaymentProtection: one labelled band, the deck's copy, escrow once", () => {
	const html = renderToString(<PaymentProtection termsHref="/legal/escrow-terms" feeBp={500} />);
	const text = textOf(html);
	assertLandmark(html, PROTECTION_SECTION_ID, PROTECTION_TITLE_ID);
	assertMatch(html, /class="lp-section lp-section--band lp-protect"/);
	assertMatch(html, /lp-display--editorial/);
	for (const line of [PROTECTION_COPY.eyebrow, PROTECTION_COPY.title, PROTECTION_COPY.explainer]) {
		assert(text.includes(line), line);
	}
	assertEquals(PROTECTION_COPY.points.length, 8);
	assertEquals(count(html, /<h3\b/), 8);
	for (const point of PROTECTION_COPY.points) {
		assert(text.includes(point.title), point.title);
		assert(text.includes(point.body), point.body);
	}
	assertEquals(count(text, /escrow/i), 1, "the explainer line's one escrow");
	assertEquals(count(text, /team-as-a-service/i), 0);
	assertNoBanned(text);
});

Deno.test("PaymentProtection: the terms link only once the terms are served; help always", () => {
	const without = renderToString(<PaymentProtection termsHref={null} />);
	assertMatch(without, /<a class="lp-section__link" href="\/help">Get help with payments<\/a>/);
	assertFalse(without.includes(PROTECTION_COPY.termsLink));
	const withTerms = renderToString(<PaymentProtection termsHref="/legal/escrow-terms" />);
	assertMatch(
		withTerms,
		/<a class="lp-section__link" href="\/legal\/escrow-terms">Read the payment protection terms<\/a>/,
	);
});

Deno.test("PaymentProtection: the rail's fee and the Fair Exit figures follow the server's rate", () => {
	const at = (feeBp: number | null) =>
		textOf(renderToString(<PaymentProtection termsHref={null} feeBp={feeBp} />));
	const five = at(500);
	assert(five.includes("minus the 5% fee"));
	assert(five.includes("Fair Exit on a £2,000 stage"));
	assert(five.includes("At 50%: the team gets £950. You get £1,000 back, fee-free."));
	const other = at(250);
	assert(other.includes("minus the 2.5% fee"));
	assert(other.includes("At 50%: the team gets £975. You get £1,000 back, fee-free."));
	assertFalse(FEE_LITERAL.test(other), "no literal 5% when the rate is 2.5%");
	const none = at(null);
	assertFalse(none.includes("minus the"), "no fee clause without the rate");
	assertFalse(none.includes("Fair Exit on a"), "no Fair Exit figures without the rate");
	assertFalse(FEE_LITERAL.test(none));
	assertEquals(protectionFlow(null).stops.map((stop) => stop.label), [
		"Held safely",
		"You approve",
		"Team paid",
		"Clears in 7 days",
		"Withdraw to bank",
	]);
	for (const label of protectionFlow(null).stops.map((stop) => stop.label)) {
		assert(none.includes(label));
	}
});
// #endregion
