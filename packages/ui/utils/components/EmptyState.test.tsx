import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { EmptyStateMarkup as EmptyState } from "../core/empty-state.tsx";

/** Where each slot's class first appears in the markup, or -1. */
function at(html: string, part: string): number {
	return html.indexOf(`class="ui-empty__${part}"`);
}

Deno.test("the body slot renders between the description and the actions", () => {
	const html = renderToString(
		<EmptyState
			title="Hire as a company"
			description="One sentence."
			actions={<button type="button">Create</button>}
		>
			<ul role="list">
				<li>One point.</li>
			</ul>
		</EmptyState>,
	);
	const [title, description, body, actions] = ["title", "description", "body", "actions"].map((p) =>
		at(html, p)
	);
	assert(title >= 0 && description > title, "the description does not follow the title");
	assert(body > description, "the body does not follow the description");
	assert(actions > body, "the actions do not follow the body");
	assert(
		html.includes('<div class="ui-empty__body"><ul role="list"><li>One point.</li></ul></div>'),
		"the children are not the body's content",
	);
});

Deno.test("no body is drawn when children are absent, false or null", () => {
	for (const children of [undefined, false, null]) {
		const html = renderToString(
			<EmptyState title="Start a team" description="One sentence.">{children}</EmptyState>,
		);
		assertFalse(html.includes("ui-empty__body"), `a body was drawn for ${String(children)}`);
		assert(at(html, "description") >= 0, "the description went with the body");
	}
});

Deno.test("the root is a status region; the title's heading level changes its tag, not its class", () => {
	assertEquals(
		renderToString(<EmptyState title="Nothing here" size="sm" class="x" />),
		'<div class="ui-empty ui-empty--sm x" role="status"><p class="ui-empty__title">Nothing here</p></div>',
	);
	assert(
		renderToString(<EmptyState title="Not found" heading={1} />).includes(
			'<h1 class="ui-empty__title">Not found</h1>',
		),
	);
});
