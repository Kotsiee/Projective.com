/**
 * The landing search and its calls to action as the server renders them in `/features`'s final call
 * to action (`flows/LANDING.md` §4.1, §4.11; the hero left with `/`, Decision #349): the
 * no-JavaScript search form (`role="search"`, `GET /explore`, fields `q` and `category` over the
 * five real categories), its visually hidden label, the combobox wiring, the `/` hint promised only
 * once it works, a recent search's named remove button beside its option, and the calls to action
 * per viewer, with the search's submit the region's one fill. The island imports CSS and cannot load
 * under `deno test`, so the section renders the search's own markup (`HeroSearchForm`, exactly what
 * the island paints first).
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { SUGGEST_QUERY_MAX } from "@projective/types/explore";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { FinalCta } from "./FinalCta.tsx";
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
	search: HeroSearchFormProps = firstPaint(),
): string {
	return renderToString(<FinalCta search={<HeroSearchForm {...search} />} viewer={viewer} />);
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
// #endregion

// #region Search form
Deno.test("FinalCta: the search is a real GET form to /explore with q and category", () => {
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

Deno.test("FinalCta: the input has a visually hidden label and the combobox wiring", () => {
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
	assert(html.includes('class="lp-search"'), "the field is the hero's one contour");
});

Deno.test("HeroSearchForm: two searches on one page carry two landmark names", () => {
	const form = (markup: string) => tagWith(markup, 'role="search"');
	const hero = renderToString(
		<HeroSearchForm {...firstPaint({ landmark: { label: "Search Projective" } })} />,
	);
	assertMatch(form(hero), /aria-label="Search Projective"/);
	assertFalse(form(hero).includes("aria-labelledby"));
	const final = renderToString(
		<HeroSearchForm
			{...firstPaint({
				ids: heroSearchIds("-final"),
				landmark: { label: "ignored", labelledBy: "get-started-title" },
			})}
		/>,
	);
	assertMatch(form(final), /aria-labelledby="get-started-title"/);
	assertFalse(form(final).includes("aria-label="), "a heading's name wins over a label");
	const unnamed = renderToString(<HeroSearchForm {...firstPaint()} />);
	assertFalse(/aria-label(?:ledby)?=/.test(form(unnamed)));
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
	assert(html.includes("lp-hero-search--open"), "the open panel holds the field's focus state");
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
Deno.test("FinalCta: the calls to action follow the viewer", () => {
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
	// The search's submit is the region's one fill (tier 3); "Hire a team" is outlined (tier 4), and
	// nothing amber renders while no money moves here (Decision #288 (E)).
	assertEquals(count(guest, "lp-btn--brand"), 1);
	assertMatch(tagWith(guest, "lp-search__submit"), /lp-btn--brand/);
	assertMatch(
		guest,
		/<a class="lp-btn lp-btn--outlined lp-hero__cta" href="[^"]+">Hire a team<\/a>/,
	);
	assertFalse(guest.includes("lp-btn--accent"));
	assertFalse(guest.includes("lp-btn--tonal") || guest.includes("lp-btn--primary"));
});
// #endregion
