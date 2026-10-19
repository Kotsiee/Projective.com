/**
 * The three editorial text sections as the server renders them (`flows/LANDING.md` §4.2, §4.6,
 * §4.8): each is one landmark labelled by its one h2, its copy is the deck's word for word, it says
 * none of the banned words (#281, #283), "escrow" appears once on the protection band and nowhere
 * else, every fee figure follows the server's rate (never a literal 5%), and nothing in them is a
 * filled money control — the teams section's one fill is tier 2, per viewer.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { GUEST_VIEWER, type HeroViewer } from "../core/hero-search.ts";
import { WHY_COPY, WHY_SECTION_ID, WHY_TITLE_ID, WhyDifferent } from "./WhyDifferent.tsx";
import {
	PaymentProtection,
	PROTECTION_COPY,
	PROTECTION_SECTION_ID,
	PROTECTION_TITLE_ID,
	protectionFlow,
} from "./PaymentProtection.tsx";
import {
	FOR_TEAMS_COPY,
	FOR_TEAMS_SECTION_ID,
	FOR_TEAMS_TITLE_ID,
	ForTeams,
	teamsBar,
	teamsCtas,
} from "./ForTeams.tsx";
import { evenSplitOf, teamPayView } from "../core/demos/split-model.ts";

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
Deno.test("WhyDifferent: one labelled landmark, the deck's copy, a real table", () => {
	const html = renderToString(<WhyDifferent />);
	const text = textOf(html);
	assertLandmark(html, WHY_SECTION_ID, WHY_TITLE_ID);
	for (
		const line of [
			WHY_COPY.eyebrow,
			WHY_COPY.title,
			WHY_COPY.subtitle,
			WHY_COPY.oldWay,
			WHY_COPY.ours,
		]
	) {
		assert(text.includes(line), line);
	}
	for (const row of WHY_COPY.rows) {
		for (const line of [row.label, row.old, row.ours]) assert(text.includes(line), line);
	}
	assertEquals(WHY_COPY.rows.length, 5);
	assertEquals(count(html, /role="columnheader"/), 2);
	assertEquals(count(html, /<th[^>]*scope="row"/), 5);
	assertEquals(count(html, /class="lp-meta lp-why__cue" aria-hidden="true"/), 10);
	assertEquals(count(text, /team-as-a-service/i), 1, "the subtitle is its one place");
	assertEquals(count(text, /escrow/i), 0);
	assertFalse(/\d+%/.test(text), "no figures at all");
	assertNoBanned(text);
});
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

// #region For freelancers and teams
const CLIENT: HeroViewer = { authenticated: true, isFreelancer: false, restricted: false };
const FREELANCER: HeroViewer = { authenticated: true, isFreelancer: true, restricted: false };
const RESTRICTED: HeroViewer = { authenticated: true, isFreelancer: false, restricted: true };

Deno.test("ForTeams: one labelled landmark, the deck's copy, no escrow", () => {
	const html = renderToString(<ForTeams viewer={GUEST_VIEWER} feeBp={500} />);
	const text = textOf(html);
	assertLandmark(html, FOR_TEAMS_SECTION_ID, FOR_TEAMS_TITLE_ID);
	for (
		const line of [
			FOR_TEAMS_COPY.eyebrow,
			FOR_TEAMS_COPY.title,
			FOR_TEAMS_COPY.subline,
			FOR_TEAMS_COPY.smallPrint,
		]
	) {
		assert(text.includes(line), line);
	}
	assertEquals(FOR_TEAMS_COPY.points.length, 8);
	assertEquals(count(html, /<h3\b/), 8);
	for (const point of FOR_TEAMS_COPY.points) {
		assert(text.includes(point.title), point.title);
		assert(text.includes(point.body), point.body);
	}
	assert(text.includes("Coming soon with Pro Team"), "the paid rules are labelled Coming soon");
	assertEquals(count(text, /escrow/i), 0);
	assertNoBanned(text);
});

Deno.test("ForTeams: Offer your skills follows the hero's mapping as the one tier-2 fill", () => {
	const projects = explorePath("projects");
	const html = (viewer: HeroViewer) => renderToString(<ForTeams viewer={viewer} />);
	const fills = (markup: string) => count(markup, /lp-btn--structural/);

	const guest = html(GUEST_VIEWER);
	assertEquals(fills(guest), 1);
	assertMatch(guest, /href="\/join\?intent=freelancer">Offer your skills<\/a>/);
	assertMatch(guest, new RegExp(`href="${projects.replace("?", "\\?")}">Find open projects</a>`));

	const client = html(CLIENT);
	assertEquals(fills(client), 1);
	assertMatch(client, /href="\/become-partner">Offer your skills<\/a>/);

	for (const viewer of [FREELANCER, RESTRICTED]) {
		const markup = html(viewer);
		assertEquals(fills(markup), 0, "no fill: one link to open projects, never two");
		assertEquals(count(markup, new RegExp(`href="${projects.replace("?", "\\?")}"`)), 1);
		assertFalse(markup.includes("Offer your skills"));
	}
	assertEquals(teamsCtas(FREELANCER).offer, null);
	assertEquals(teamsCtas(RESTRICTED).offer, null);
});

Deno.test("ForTeams: the team-pay figure follows the server's rate, and hides without it", () => {
	const at = (feeBp: number | null) =>
		renderToString(<ForTeams viewer={GUEST_VIEWER} feeBp={feeBp} />);
	const five = textOf(at(500));
	assert(five.includes("Example · a £2,000 stage"));
	assert(five.includes("A £2,000 stage is approved. The 5% fee leaves £1,900.00."));
	for (const amount of ["£570.11", "£569.94", "£190.01"]) assert(five.includes(amount), amount);
	assert(five.includes("The team keeps 10% in its shared vault: £190.00."), "the vault first");
	assert(five.includes("Any spare penny goes to the vault. It all adds up."), "the penny");
	assertFalse(/\d+(?:\.\d+)?% £/.test(five), "amounts only: no column of percentages");
	assertFalse(five.includes("33.34%"), "never a share of the remainder printed as a share of all");
	assertFalse(five.includes("Then members can withdraw it."), "point 4 says it once");

	const other = textOf(at(250));
	assert(other.includes("The 2.5% fee leaves £1,950.00."));
	assertFalse(FEE_LITERAL.test(other), "no literal 5% when the rate is 2.5%");

	const none = at(null);
	assertFalse(none.includes("lp-teams__figure"), "no figure without the rate");
	assertMatch(none, /lp-teams__top lp-teams__top--text/);
	assertFalse(FEE_LITERAL.test(textOf(none)));
	assertFalse(/£\d/.test(textOf(none)), "no amounts at all");
});

Deno.test("ForTeams: the bar's segments cover what the team receives, in the rows' order", () => {
	const segments = teamsBar(teamPayView(evenSplitOf(), 500));
	assertEquals(segments.map((s) => s.tone), ["1", "2", "3", "vault"]);
	const last = segments[segments.length - 1];
	assert(Math.abs(last.x + last.width - 100) < 0.01, "the bar ends at 100%");
	assert(segments.every((s, i) => i === 0 || s.x > segments[i - 1].x + segments[i - 1].width));
	assertEquals(teamsBar(teamPayView(evenSplitOf(), null)), []);
});
// #endregion
