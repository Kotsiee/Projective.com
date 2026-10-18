/**
 * The landing hero as the server renders it (`flows/LANDING.md` §4.1): one h1 with the recommended
 * headline, the no-JavaScript search form (`role="search"`, `GET /explore`, fields `q` and
 * `category` over the five real categories), its visually hidden label, the combobox wiring, the
 * `/` hint promised only once it works, a recent search's named remove button beside its option,
 * the "Try:" chips and the calls to action per viewer. The island-bound page controller imports CSS and
 * cannot load under `deno test`, so the hero is rendered with the search's own markup
 * (`HeroSearchForm`, exactly what the island paints first) and stand-ins for the other islands.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { SUGGEST_QUERY_MAX } from "@projective/types/explore";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { HERO_COPY, LandingHero } from "./LandingHero.tsx";
import { HeroSearchForm, type HeroSearchFormProps, heroSearchIds } from "./HeroSearchForm.tsx";
import {
	DEFAULT_HERO_CATEGORY,
	GUEST_VIEWER,
	HERO_SEARCH_COPY,
	type HeroViewer,
	suggestSections,
} from "../core/hero-search.ts";

// #region Fixtures
/** The search's first paint: nothing open, not hydrated, no typewriter. */
function firstPaint(over: Partial<HeroSearchFormProps> = {}): HeroSearchFormProps {
	return {
		ids: heroSearchIds(),
		query: "",
		category: DEFAULT_HERO_CATEGORY,
		hydrated: false,
		scopeButton: false,
		typewriter: null,
		slashFocus: true,
		open: false,
		sections: [],
		active: -1,
		status: "idle",
		announcement: "",
		sheetOpen: false,
		avatarFallback: "/test_images/profile_1.jpg",
		glyph: (name) => <i data-glyph={name} />,
		...over,
	};
}

function render(
	viewer: HeroViewer = GUEST_VIEWER,
	chips: string[] = ["brand identity", "landing page"],
	search: HeroSearchFormProps = firstPaint(),
): string {
	return renderToString(
		<LandingHero
			background={<div id="bg-slot" />}
			search={<HeroSearchForm {...search} />}
			chips={chips}
			viewer={viewer}
			theatre={<div id="theatre-slot" />}
		/>,
	);
}

/** Count of `needle` in `hay`. */
function count(hay: string, needle: string): number {
	return hay.split(needle).length - 1;
}

/** The opening tag of the first element carrying `marker`. */
function tagWith(html: string, marker: string): string {
	const at = html.indexOf(marker);
	assert(at !== -1, `no element carries ${marker}`);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}
// #endregion

// #region Structure
Deno.test("LandingHero: one h1 with the recommended headline, the copy marked quiet", () => {
	const html = render();
	assertEquals(count(html, "<h1"), 1);
	assert(html.includes(HERO_COPY.lines[0]) && html.includes(HERO_COPY.lines[1]));
	assert(html.includes(HERO_COPY.lead));
	assert(html.includes(HERO_COPY.eyebrow));
	assert(html.includes('id="hero"'));
	assert(html.includes('data-lp-quiet="copy"'));
	assertFalse(html.includes("<main"));
	// Background first, the theatre after the calls to action.
	const bg = html.indexOf('id="bg-slot"');
	const ctas = html.indexOf("lp-hero__ctas");
	assert(bg < html.indexOf("<h1") && ctas < html.indexOf('id="theatre-slot"'));
});
// #endregion

// #region Search form
Deno.test("LandingHero: the search is a real GET form to /explore with q and category", () => {
	const html = render();
	const form = tagWith(html, 'role="search"');
	assertMatch(form, /<form\b/);
	assertMatch(form, /action="\/explore"/);
	assertMatch(form, /method="get"/);
	const input = tagWith(html, 'name="q"');
	assertMatch(input, /<input\b/);
	assertMatch(input, /placeholder="Search teams, services and projects"/);
	const select = tagWith(html, 'name="category"');
	assertMatch(select, /<select\b/);
	assertMatch(select, /aria-label="Search in"/);
	const values = [...html.matchAll(/<option[^>]*value="([a-z]+)"/g)].map((m) => m[1]);
	assertEquals(values, ["all", "freelancers", "services", "projects", "businesses"]);
	assertMatch(html, /<option[^>]*value="all"[^>]*selected/);
	assertMatch(html, /<button[^>]*type="submit"[^>]*>[\s\S]*?Search<\/span><\/button>/);
	// No mobile picker button before hydration: it would open a sheet that needs JavaScript.
	assertFalse(html.includes("lp-search__scope-btn"));
});

Deno.test("LandingHero: the input has a visually hidden label and the combobox wiring", () => {
	const html = render();
	const ids = heroSearchIds();
	assertMatch(
		html,
		new RegExp(
			`<label class="ui-visually-hidden" for="${ids.input}">${HERO_SEARCH_COPY.label}</label>`,
		),
	);
	const input = tagWith(html, 'name="q"');
	assertMatch(input, new RegExp(`id="${ids.input}"`));
	assertMatch(input, /role="combobox"/);
	assertMatch(input, /aria-autocomplete="list"/);
	assertMatch(input, /aria-expanded="false"/);
	assertMatch(input, new RegExp(`aria-controls="${ids.list}"`));
	assertMatch(input, new RegExp(`maxlength="${SUGGEST_QUERY_MAX}"`, "i"));
	assertFalse(/aria-activedescendant/.test(input));
	const list = tagWith(html, `id="${ids.list}"`);
	assertMatch(list, /role="listbox"/);
	assertMatch(html, new RegExp(`id="${ids.status}"[^>]*role="status"[^>]*aria-live="polite"`));
	assert(html.includes('class="lp-search"'), "the field is the background's halo box");
});

Deno.test("HeroSearchForm: the / hint and aria-keyshortcuts are promised only once the key is bound", () => {
	const before = renderToString(<HeroSearchForm {...firstPaint()} />);
	assertFalse(tagWith(before, 'name="q"').includes("aria-keyshortcuts"));
	// The hint's box is drawn on the server (nothing moves at hydration) but not shown.
	assertMatch(
		before,
		/<span class="lp-search__hint" aria-hidden="true"><kbd class="lp-search__kbd">\/<\/kbd>to search<\/span>/,
	);
	const after = renderToString(<HeroSearchForm {...firstPaint({ hydrated: true })} />);
	assertMatch(tagWith(after, 'name="q"'), /aria-keyshortcuts="\/"/);
	assert(after.includes('class="lp-search__hint lp-search__hint--live"'));
	assert(after.includes("lp-hero-search--hydrated"));
	assertFalse(after.includes("lp-search__scope-btn"), "the sheet button waits for its sheet");
});

Deno.test("HeroSearchForm: a recent search's remove button is named and sits beside its option", () => {
	const sections = suggestSections({
		typed: "",
		recent: ["UX"],
		trending: ["Figma"],
		status: "idle",
		data: null,
	});
	const ids = heroSearchIds();
	const html = renderToString(
		<HeroSearchForm {...firstPaint({ open: true, sections, active: 0, hydrated: true })} />,
	);
	assertMatch(
		html,
		new RegExp(
			`<div\\s+class="lp-suggest__row" role="none"><div\\s+id="${ids.list}-0"[^>]*role="option"[^>]*aria-describedby="${ids.removeHint}"`,
		),
	);
	const remove = tagWith(html, 'class="lp-suggest__remove"');
	assertMatch(remove, /aria-label="Remove “UX” from recent searches"/);
	assertMatch(remove, /tabindex="-1"/i);
	assertFalse(remove.includes("aria-hidden"), "reachable by touch screen readers");
	// The description is referenced, never read out on its own.
	assertMatch(
		html,
		new RegExp(`<span id="${ids.removeHint}" hidden>Press Delete to remove</span>`),
	);
	assertEquals(count(html, 'class="lp-suggest__remove"'), 1);
	assert(html.includes("lp-hero-search--open"), "the open panel rests the ring");
});

Deno.test("HeroSearchForm: an open panel names its active row and groups its options", () => {
	const sections = suggestSections({
		typed: "brand",
		recent: [],
		trending: null,
		status: "ready",
		data: {
			q: "brand",
			scope: "all",
			terms: [],
			trending: [],
			handles: [{ handle: "@ada", name: "Ada", avatar: "", kind: "freelancer", verified: false }],
			hits: [{
				id: "s1",
				type: "services",
				title: "Brand sprint",
				ownerName: "Ada",
				ownerHandle: "@ada",
			}],
		},
	});
	const html = renderToString(
		<HeroSearchForm
			{...firstPaint({
				query: "brand",
				open: true,
				sections,
				active: 1,
				hydrated: true,
				scopeButton: true,
			})}
		/>,
	);
	const ids = heroSearchIds();
	const input = tagWith(html, 'name="q"');
	assertMatch(input, /aria-expanded="true"/);
	assertMatch(input, new RegExp(`aria-activedescendant="${ids.list}-1"`));
	assertEquals(count(html, 'role="option"'), 3);
	assertMatch(html, new RegExp(`id="${ids.list}-1"[^>]*aria-selected="true"`));
	assert(html.includes(">People &amp; teams<") && html.includes(">Services<"));
	assertFalse(html.includes(">Products<"));
	assertMatch(html, /src="\/test_images\/profile_1\.jpg"[^>]*width="32"[^>]*height="32"/);
	assert(html.includes("Search Explore for “brand”"));
	assert(html.includes("lp-search__scope-btn"), "hydrated: the mobile picker button renders");
	assert(html.includes("lp-hero-search--sheet"));
	assertMatch(html, /aria-label="Choose what to search \(now: All\)"/);
	assertFalse(tagWith(html, "lp-search__scope-btn").includes("aria-controls"), "no sheet open");
	const opened = renderToString(
		<HeroSearchForm {...firstPaint({ hydrated: true, scopeButton: true, sheetOpen: true })} />,
	);
	assertMatch(
		tagWith(opened, "lp-search__scope-btn"),
		new RegExp(`aria-controls="${ids.sheet}"`),
	);
});

Deno.test("HeroSearchForm: a second instance keeps its ids apart and takes no shortcut", () => {
	const ids = heroSearchIds("-final");
	const html = renderToString(<HeroSearchForm {...firstPaint({ ids, slashFocus: false })} />);
	assert(html.includes('id="lp-q-final"') && html.includes('for="lp-q-final"'));
	assertFalse(html.includes("aria-keyshortcuts"));
	assertFalse(html.includes("lp-search__hint"));
});
// #endregion

// #region Chips and calls to action
Deno.test("LandingHero: the chips link into Explore, and an empty list omits the row", () => {
	const html = render();
	assertMatch(html, /<nav class="lp-chips" aria-label="Suggested searches">/);
	assert(html.includes(`href="${explorePath("all", "brand identity").replace("&", "&amp;")}"`));
	assert(html.includes(">Try:<"));
	assertFalse(html.includes("Popular"));
	assertFalse(render(GUEST_VIEWER, []).includes("lp-chips"));
});

Deno.test("LandingHero: the calls to action follow the viewer", () => {
	const teams = `href="${explorePath("teams")}"`;
	const guest = render();
	assert(guest.includes(teams) && guest.includes(">Hire a team<"));
	assert(guest.includes('href="/join?intent=freelancer"') && guest.includes(">Offer your skills<"));
	const client = render({ authenticated: true, isFreelancer: false, restricted: false });
	assert(client.includes('href="/become-partner"'));
	const freelancer = render({ authenticated: true, isFreelancer: true, restricted: false });
	assert(
		freelancer.includes(`href="${explorePath("projects")}"`) && freelancer.includes(">Find work<"),
	);
	const minor = render({ authenticated: true, isFreelancer: false, restricted: true });
	assert(minor.includes(teams));
	assertFalse(minor.includes("Offer your skills") || minor.includes("Find work"));
	// Neither call to action is the filled primary: the submit is.
	assertEquals(count(guest, "lp-btn--primary"), 1);
});
// #endregion
