import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { HelpCentreSearchResult } from "@projective/types/editorial";
import {
	HELP_CONTACT_HREF,
	HELP_DISPUTE_HREF,
	HELP_DISPUTE_LABEL,
	HelpStillStuck,
} from "./HelpStillStuck.tsx";
import { HelpHit } from "./HelpHit.tsx";
import { HelpNotFound } from "./HelpNotFound.tsx";

/** The help centre's island-free components, rendered to markup. */

/** Rendered markup with the whitespace the precompiled JSX leaves inside a tag removed. */
function render(node: Parameters<typeof renderToString>[0]): string {
	return renderToString(node).replace(/\s+>/g, ">").replace(/<(\w+)\s+/g, "<$1 ");
}

const hit: HelpCentreSearchResult = {
	slug: "how-stage-funding-works",
	title: "How stage funding works",
	category: "escrow-and-payments",
	categoryTitle: "Escrow & payments",
	href: "/help/escrow-and-payments/how-stage-funding-works",
	snippet: "You pay for a stage before the work starts.",
	highlights: { title: [[4, 9]], snippet: [[14, 19]] },
};

Deno.test("Still stuck? — Contact support always, the disputes link only when signed in, the fill last", () => {
	const guest = render(<HelpStillStuck signedIn={false} />);
	const member = render(<HelpStillStuck signedIn />);
	assert(guest.includes(`href="${HELP_CONTACT_HREF.replace("&", "&amp;")}"`));
	assertFalse(guest.includes(HELP_DISPUTE_HREF));
	assert(member.includes(HELP_DISPUTE_HREF));
	// It opens an article, so it is labelled for that, not as an action it does not perform.
	assert(HELP_DISPUTE_HREF.startsWith("/help/"));
	assert(member.includes(`<span class="ui-button__label">${HELP_DISPUTE_LABEL}</span>`));
	assertFalse(member.includes("Raise a dispute"));
	assert(
		member.indexOf("ui-button--outlined") < member.indexOf("ui-button--filled"),
		"the filled commit is last in the inline order",
	);
	assertEquals(member.match(/ui-button--filled/g)?.length, 1, "one fill in the region");
});

Deno.test("a hit marks its matched runs, as a plain link or as a listbox option", () => {
	const plain = render(<HelpHit result={hit} />);
	assert(plain.includes("How <mark>stage</mark> funding works"));
	assert(plain.includes("You pay for a <mark>stage</mark> before"));
	assertFalse(plain.includes('role="option"'));
	const option = render(<HelpHit result={hit} role="option" id="opt-0" active />);
	assert(option.includes('role="option"'));
	assert(option.includes('aria-selected="true"'));
	assert(option.includes('tabindex="-1"'));
});

Deno.test("not found: one h1 in the help frame, the search slot, a way back to /help and Still stuck?", () => {
	const html = render(
		<HelpNotFound search={<div class="probe-search" />} signedIn={false} />,
	);
	assertEquals(html.match(/<h1[\s>]/g)?.length, 1);
	assert(html.startsWith('<div class="hc hc--missing">'));
	assert(html.includes('<div class="probe-search"></div>'), "the search island is slotted in");
	assert(html.includes('href="/help"'));
	assert(html.includes('id="hc-stuck-title"'));
});
