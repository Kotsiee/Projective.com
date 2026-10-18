import { assertEquals } from "@std/assert";
import {
	ABOUT_CONTRAST,
	ABOUT_CREDENTIALS,
	ABOUT_CTA,
	ABOUT_FOUNDERS,
	ABOUT_HERO,
	ABOUT_META,
	ABOUT_QUOTE,
} from "./about-content.ts";

/**
 * The page's claims, pinned: every public sentence of `/about` lives in `about-content.ts`, and these
 * tests hold it to the rules the page is reviewed against (Decision #277).
 */

/** Every sentence the module publishes. */
function allCopy(): string {
	return [
		ABOUT_META.description,
		ABOUT_HERO.eyebrow,
		ABOUT_HERO.title,
		ABOUT_HERO.standfirst,
		...ABOUT_CONTRAST.flatMap((side) => [side.label, ...side.statements]),
		ABOUT_QUOTE.text,
		ABOUT_QUOTE.attribution,
		...ABOUT_FOUNDERS.flatMap((f) => [f.name, f.role, f.bio]),
		...ABOUT_CREDENTIALS.flatMap((c) => [c.title, c.body, c.link?.label ?? ""]),
		ABOUT_CTA.title,
		ABOUT_CTA.body,
	].join("\n");
}

Deno.test("about-content: the friction and the model are four short statements each", () => {
	assertEquals(ABOUT_CONTRAST.map((s) => s.label), ["The friction", "The model"]);
	for (const side of ABOUT_CONTRAST) {
		assertEquals(side.statements.length, 4);
		for (const s of side.statements) assertEquals(s.length <= 120, true, s);
	}
});

Deno.test("about-content: the standfirst is two sentences", () => {
	assertEquals(ABOUT_HERO.standfirst.split(/(?<=[.!?])\s+/).length, 2);
});

Deno.test("about-content: no certification, compliance badge or invented vocabulary is claimed", () => {
	const text = allCopy();
	for (
		const banned of [
			"SOC 2",
			"SOC2",
			"ISO 27001",
			"PCI",
			"certified",
			"Squad",
			"Contributor",
			"TVL",
		]
	) {
		assertEquals(text.includes(banned), false, banned);
	}
});

Deno.test("about-content: founders are the three flagged placeholders with web-served avatars", async () => {
	assertEquals(ABOUT_FOUNDERS.length, 3);
	assertEquals(
		ABOUT_FOUNDERS.map((f) => f.avatar.src),
		["/test_images/profile_4.jpg", "/test_images/profile_5.jpg", "/test_images/profile_6.jpg"],
	);
	for (const founder of ABOUT_FOUNDERS) {
		assertEquals(founder.name.includes("XXXX"), true);
		assertEquals(founder.links.length, 0);
		const file = new URL(`../../../../static${founder.avatar.src}`, import.meta.url);
		const info = await Deno.stat(file);
		assertEquals(info.isFile, true, founder.avatar.src);
		assertEquals(founder.avatar.w > 0 && founder.avatar.h > 0, true);
	}
});

Deno.test("about-content: credentials link only to the fixed legal slugs, or not at all", () => {
	const LEGAL = new Set([
		"terms",
		"privacy",
		"cookies",
		"ip-transfer-deed",
		"escrow-terms",
		"acceptable-use",
	]);
	assertEquals(ABOUT_CREDENTIALS.length >= 6, true);
	assertEquals(new Set(ABOUT_CREDENTIALS.map((c) => c.id)).size, ABOUT_CREDENTIALS.length);
	for (const cred of ABOUT_CREDENTIALS) {
		if (!cred.link) continue;
		const slug = cred.link.href.match(/^\/legal\/([a-z-]+)$/)?.[1];
		assertEquals(slug !== undefined && LEGAL.has(slug), true, cred.link.href);
	}
});

Deno.test("about-content: the closing band's actions", () => {
	assertEquals(ABOUT_CTA.primary.guestHref, "/join");
	assertEquals(ABOUT_CTA.primary.memberHref, "/projects?create=1");
	assertEquals(ABOUT_CTA.secondary.href, "/contact?intent=sales");
});
