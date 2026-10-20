/**
 * demo-stage.test — the demo stage's URL state and words (`flows/LANDING.md` §2.1 note 11, §4.4):
 * `?demo=` ⇄ the open tab both ways (an unknown or missing value opens the Work board), the address
 * a tab writes keeping the rest of the URL, the same-page links the host takes over, the tablist's
 * roving keys, the fee as the copy prints it, and the §4.4 words — captions under 15 words, every
 * fee clause dropped when the fee is unknown.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	DEFAULT_DEMO,
	DEMO_IDS,
	DEMO_STAGE_COPY,
	DEMO_TABS,
	demoDescription,
	demoDomIds,
	demoFromUrl,
	demoHref,
	isDemoId,
	parseDemoId,
	platformFeeLabel,
	samePageDemoLink,
	tabFocusTarget,
	urlWithDemo,
} from "./demo-stage.ts";

// #region URL ⇄ tab
Deno.test("the four tabs, in the §4.4 order, the Work board first and by default", () => {
	assertEquals([...DEMO_IDS], ["board", "payments", "booking", "splits"]);
	assertEquals(DEFAULT_DEMO, "board");
	assertEquals(DEMO_IDS.map((id) => DEMO_TABS[id].label), [
		"Work board",
		"Payment protection",
		"Booking",
		"Team pay",
	]);
});

Deno.test("?demo= opens exactly the tab it names; anything else opens the Work board", () => {
	for (const id of DEMO_IDS) {
		assert(isDemoId(id));
		assertEquals(parseDemoId(id), id);
		assertEquals(demoFromUrl(`https://example.test/?demo=${id}#demo`), id);
	}
	for (const raw of [null, undefined, "", "Board", "features", "board ", "split"]) {
		assertEquals(parseDemoId(raw), "board", String(raw));
	}
	assertFalse(isDemoId(42));
	assertEquals(demoFromUrl("/"), "board");
	assertEquals(demoFromUrl(new URL("https://example.test/?q=x&demo=booking")), "booking");
});

Deno.test("each tab links to itself on the page's stage, and the link parses back to the tab", () => {
	for (const id of DEMO_IDS) {
		const href = demoHref(id);
		assertEquals(href, `/?demo=${id}#demo`);
		assertEquals(demoFromUrl(href), id);
		assertEquals(samePageDemoLink(href, "/"), id);
	}
	assertEquals(demoHref("splits", "/features"), "/features?demo=splits#demo");
});

Deno.test("opening a tab writes ?demo= and keeps the path, the other parameters and the hash", () => {
	assertEquals(urlWithDemo("https://example.test/", "payments"), "/?demo=payments");
	assertEquals(
		urlWithDemo("https://example.test/?demo=board#demo", "booking"),
		"/?demo=booking#demo",
	);
	assertEquals(
		urlWithDemo("https://example.test/?utm_source=x&demo=board#faq", "splits"),
		"/?utm_source=x&demo=splits#faq",
	);
	for (const id of DEMO_IDS) assertEquals(demoFromUrl(urlWithDemo("https://a.test/?x=1", id)), id);
});

Deno.test("only a link to this page's #demo that names a tab is the host's to open in place", () => {
	assertEquals(samePageDemoLink("/?demo=board#demo", "/"), "board");
	assertEquals(samePageDemoLink("?demo=payments#demo", "/"), "payments");
	assertEquals(samePageDemoLink("/?demo=board", "/"), null, "no #demo: an ordinary link");
	assertEquals(samePageDemoLink("/?demo=nope#demo", "/"), null);
	assertEquals(samePageDemoLink("/features?demo=board#demo", "/"), null, "another page");
	assertEquals(samePageDemoLink("https://elsewhere.test/?demo=board#demo", "/"), null);
	assertEquals(samePageDemoLink("/explore?q=logo", "/"), null);
});

Deno.test("each tab and its panel point at each other, and the panel at its description", () => {
	const all = DEMO_IDS.flatMap((id) => Object.values(demoDomIds(id)));
	assertEquals(new Set(all).size, all.length);
	assertEquals(demoDomIds("board"), {
		tab: "demo-tab-board",
		panel: "demo-panel-board",
		desc: "demo-desc-board",
	});
});

Deno.test("roving focus: arrows wrap, Home and End jump, other keys are not the tablist's", () => {
	assertEquals(tabFocusTarget("ArrowRight", 0, 4), 1);
	assertEquals(tabFocusTarget("ArrowRight", 3, 4), 0);
	assertEquals(tabFocusTarget("ArrowLeft", 0, 4), 3);
	assertEquals(tabFocusTarget("ArrowLeft", 2, 4), 1);
	assertEquals(tabFocusTarget("Home", 2, 4), 0);
	assertEquals(tabFocusTarget("End", 1, 4), 3);
	for (const key of ["Enter", " ", "ArrowDown", "Tab", "a"]) {
		assertEquals(tabFocusTarget(key, 1, 4), null, key);
	}
	assertEquals(tabFocusTarget("ArrowRight", 0, 0), null);
});
// #endregion

// #region Words
Deno.test("the fee prints from basis points with no trailing zeros", () => {
	assertEquals(platformFeeLabel(500), "5%");
	assertEquals(platformFeeLabel(250), "2.5%");
	assertEquals(platformFeeLabel(125), "1.25%");
	assertEquals(platformFeeLabel(1000), "10%");
	assertEquals(platformFeeLabel(0), "0%");
});

Deno.test("the stage's words are §4.4's, and every caption is under 15 words", () => {
	assertEquals(DEMO_STAGE_COPY.eyebrow, "See it work");
	assertEquals(DEMO_STAGE_COPY.title, "See a project run, step by step.");
	assertEquals(DEMO_STAGE_COPY.note, "Example only. No real money moves.");
	assertEquals(DEMO_STAGE_COPY.reset, "Start again");
	assertFalse(
		"resetLabel" in DEMO_STAGE_COPY,
		"Start again is named by its own words (WCAG 2.5.3)",
	);
	assertEquals(DEMO_STAGE_COPY.moreHref, "/features");
	assertEquals(DEMO_TABS.board.posterLabel, "Example work board with five columns.");
	for (const id of DEMO_IDS) assert(DEMO_TABS[id].posterLabel.length > 0, `${id}: a named poster`);
	assertEquals(
		DEMO_TABS.board.caption,
		"Work only starts once it's paid for. Approve, and it moves on.",
	);
	for (const id of DEMO_IDS) {
		const words = DEMO_TABS[id].caption.split(/\s+/).length;
		assert(words < 15, `${id}: ${words} words`);
	}
});

Deno.test("descriptions name the server's fee, and drop every fee clause without one", () => {
	assertEquals(
		demoDescription("payments", 500),
		"Follow a £5,000 project in three stages. Each stage's money is held safely before work starts. When you approve, the team is paid, minus the 5% fee.",
	);
	assert(demoDescription("payments", 250).endsWith("minus the 2.5% fee."));
	assert(
		demoDescription("splits", 500).includes("The 5% fee comes off, then the team's vault share."),
	);
	for (const id of DEMO_IDS) {
		const text = demoDescription(id, null);
		assertFalse(/fee|%/.test(text), `${id}: ${text}`);
		const sentences = text.split(/(?<=[.?])\s+/).length;
		assert(sentences >= 2 && sentences <= 3, `${id}: ${sentences} sentences`);
	}
	assertEquals(
		demoDescription("payments", null),
		"Follow a £5,000 project in three stages. Each stage's money is held safely before work starts. When you approve, the team is paid.",
	);
});

Deno.test("no page copy uses a banned word or the absolutes #281 forbids", () => {
	const banned =
		/\b(squad|micro-agency|tvl|escrow|release|next card)\b|until you approve|only paid when you approve|instant payout/i;
	const copy = [
		...Object.values(DEMO_STAGE_COPY),
		...DEMO_IDS.flatMap((id) => [
			DEMO_TABS[id].label,
			DEMO_TABS[id].caption,
			demoDescription(id, 500),
			demoDescription(id, null),
		]),
	];
	for (const line of copy) assertFalse(banned.test(line), line);
});
// #endregion
