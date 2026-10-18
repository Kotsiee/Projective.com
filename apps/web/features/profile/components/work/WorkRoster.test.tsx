import { assert, assertEquals, assertFalse } from "@std/assert";
import type { JSX } from "preact";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { DepartmentEntry, MemberEntry, ProfileKind } from "../../types/profile-types.ts";

/**
 * WorkRoster, rendered — a TEAM's roster is a list of rows whose second line is one MetaLine of
 * plain facts (Teams P1 SPEC 2, §B.11): role · "Since 2025" · two skills, no chip and no tag, and
 * each row a link to the member's own page.
 *
 * ## Why the component is imported through a data URL
 *
 * `WorkRoster.tsx` reaches `@projective/ui/display` (MetaLine, Avatar) and `UserAvatar`, whose
 * modules import their `.css` — which a plain `deno test` refuses to load. The component is loaded
 * from its own source with those two specifiers swapped: MetaLine for its CSS-free markup
 * (`MetaLineMarkup`, the exact function `MetaLine` returns) and the avatar for an inert stub.
 */

// #region CSS-free import
const SOURCE = new URL("./WorkRoster.tsx", import.meta.url);
const META_LINE = import.meta.resolve("@ui/display/core/meta-line.tsx");

function dataUrl(source: string, type: "text/tsx" | "application/javascript"): string {
	return `data:${type},${encodeURIComponent(source)}`;
}

const SWAPS: Record<string, string> = {
	"@projective/ui/display": dataUrl(
		`export { MetaLineMarkup as MetaLine } from "${META_LINE}";\n`,
		"application/javascript",
	),
	"@web/components/UserAvatar.tsx": dataUrl(
		"export function UserAvatar() { return null; }\n",
		"application/javascript",
	),
};

async function cssFreeUrl(): Promise<string> {
	let source = await Deno.readTextFile(SOURCE);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		const target = SWAPS[spec] ??
			(spec.startsWith(".") ? new URL(spec, SOURCE).href : import.meta.resolve(spec));
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	// A data URL sits outside every config, so its JSX factory is named in place (the classic one;
	// the markup it renders is the same).
	const jsx = `/** @jsxRuntime classic */\n/** @jsx h */\n/** @jsxFrag Fragment */\n` +
		`import { Fragment, h } from "${import.meta.resolve("preact")}";\n`;
	return dataUrl(jsx + source, "text/tsx");
}

/** `WorkRoster`'s signature, restated: `typeof import(…)` would pull the CSS back into the graph. */
type WorkRosterFn = (props: {
	members: readonly MemberEntry[];
	departments: readonly DepartmentEntry[];
	kind: ProfileKind;
}) => JSX.Element | null;

const { WorkRoster } = await import(await cssFreeUrl()) as { WorkRoster: WorkRosterFn };
// #endregion

/** A roster row, as `rosterOf` maps it. */
function member(handle: string, overrides: Partial<MemberEntry> = {}): MemberEntry {
	return {
		handle: `@${handle}`,
		name: handle,
		avatar: "",
		role: "Member",
		kind: "freelancer",
		departments: [],
		...overrides,
	};
}

const TEAM = [
	member("kwamemensah", {
		name: "Kwame Mensah",
		role: "Owner",
		since: "2025-10-17T19:57:36Z",
		skills: ["Deno", "Postgres"],
	}),
	member("tomaszwojcik", { name: "Tomasz Wojcik", since: "2026-01-04T09:00:00Z" }),
];

Deno.test("a team's roster is rows: role · since · two skills as one MetaLine, never a chip", () => {
	const html = renderToString(<WorkRoster members={TEAM} departments={[]} kind="team" />);
	assert(html.startsWith('<ul class="pf-roster pf-roster--rows" role="list">'), html);
	assert(
		html.includes(
			'<span class="ui-meta-line ui-meta-line--xs pf-person__meta">' +
				'<span class="ui-meta-line__item">Owner</span>' +
				'<span class="ui-meta-line__sep" aria-hidden="true">·</span>' +
				'<span class="ui-meta-line__item ui-meta-line__item--tabular">Since 2025</span>' +
				'<span class="ui-meta-line__sep" aria-hidden="true">·</span>' +
				'<span class="ui-meta-line__item">Deno</span>' +
				'<span class="ui-meta-line__sep" aria-hidden="true">·</span>' +
				'<span class="ui-meta-line__item">Postgres</span>' +
				"</span>",
		),
		html,
	);
	// A member with no skills reads role · since, and nothing stands in for the missing skills.
	assert(
		html.includes(
			'<span class="ui-meta-line__item">Member</span>' +
				'<span class="ui-meta-line__sep" aria-hidden="true">·</span>' +
				'<span class="ui-meta-line__item ui-meta-line__item--tabular">Since 2026</span>' +
				"</span>",
		),
		html,
	);
	// Each row links to the member's own page.
	assertEquals(html.match(/<a class="pf-person__link" href="\/@kwamemensah">/g)?.length, 1);
	assertEquals(html.match(/<a class="pf-person__link" href="\/@tomaszwojcik">/g)?.length, 1);
	// No container ever wraps a fact: no chip, tag, badge or pill, and no plain role line either.
	assertFalse(/ui-chip|ui-tag|ui-badge|pill|pf-tag|pf-person__role/.test(html), html);
});

Deno.test("a business keeps its grid, and its row's MetaLine is role · since — no skills", () => {
	const html = renderToString(<WorkRoster members={TEAM} departments={[]} kind="business" />);
	assert(html.startsWith('<ul class="pf-roster" role="list">'), html);
	assertFalse(html.includes("Deno"), html);
	assertFalse(/ui-chip|ui-tag|ui-badge/.test(html), html);
});
