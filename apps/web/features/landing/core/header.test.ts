/**
 * header.test — the header bar's "Main" links (`flows/LANDING.md` §4.0, §2.6 note 1): their order,
 * that each whole-page link has a route behind it (an anchor's section is checked against `/` by
 * `components/landing-page.test.tsx`), and which link is the page the visitor is on.
 */
import { assert, assertEquals } from "@std/assert";
import { isCurrentNavLink, LANDING_NAV_LINKS, landingNavAnchors } from "./header.ts";

// #region Fixtures
/** The public route group, from `apps/web/features/landing/core/`. */
const PUBLIC_ROUTES = new URL("../../../routes/(public)/", import.meta.url);

/** Whether `file` is a file on disk. */
function isFile(file: URL): boolean {
	try {
		return Deno.statSync(file).isFile;
	} catch {
		return false;
	}
}

/** The labels of the links that are the page `page`, in the bar's order. */
function currentOn(page: string): string[] {
	return LANDING_NAV_LINKS.filter((link) => isCurrentNavLink(link, page)).map((l) => l.label);
}
// #endregion

Deno.test("the bar's links: How it works · Explore · Pricing · Features, Explore from --bp-lg", () => {
	assertEquals(
		LANDING_NAV_LINKS.map((link) => [link.label, link.href, link.wide === true]),
		[
			["How it works", "/#how-it-works", false],
			["Explore", "/explore", true],
			["Pricing", "/#pricing", false],
			["Features", "/features", false],
		],
	);
	assertEquals(landingNavAnchors(), ["how-it-works", "pricing"]);
});

Deno.test("every whole-page link in the bar has a route file behind it", () => {
	for (const link of LANDING_NAV_LINKS) {
		if (link.href.startsWith("/#")) continue;
		const file = new URL(`.${link.href}.tsx`, PUBLIC_ROUTES);
		assert(isFile(file), `${link.label} → ${link.href}: no route file ${file.pathname}`);
	}
});

Deno.test("Features is the current page on /features, whatever its query; nothing is on /", () => {
	assertEquals(currentOn("/features"), ["Features"]);
	assertEquals(currentOn("/features?section=money"), ["Features"]);
	assertEquals(currentOn("/features#trust"), ["Features"]);
	assertEquals(currentOn("/"), []);
	assertEquals(currentOn("/?demo=board"), []);
	assertEquals(currentOn("/explore?q=logo"), ["Explore"]);
	assertEquals(currentOn("/featuresque"), []);
});
