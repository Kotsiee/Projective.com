import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { MetaLineMarkup as MetaLine } from "../core/meta-line.tsx";

const css = Deno.readTextFileSync(new URL("../styles/meta-line.css", import.meta.url));

/** The declarations of one top-level rule in meta-line.css. */
function rule(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	assert(at >= 0, `missing rule ${selector}`);
	return css.slice(at, css.indexOf("}", at));
}

Deno.test("falsy entries drop; facts join with one aria-hidden middot; figures are tabular", () => {
	const html = renderToString(
		<MetaLine items={["Owner", null, { text: "4 members", tabular: true }]} />,
	);
	assertEquals(
		html,
		'<p class="ui-meta-line">' +
			'<span class="ui-meta-line__item">Owner</span>' +
			'<span class="ui-meta-line__sep" aria-hidden="true">·</span>' +
			'<span class="ui-meta-line__item ui-meta-line__item--tabular">4 members</span>' +
			"</p>",
	);
});

Deno.test("every separator is aria-hidden and there is one fewer than there are facts", () => {
	const html = renderToString(<MetaLine items={["a", "", "b", false, undefined, "c"]} />);
	assertEquals(html.match(/ui-meta-line__item"/g)?.length, 3);
	assertEquals(html.match(/ui-meta-line__sep/g)?.length, 2);
	assertEquals(html.match(/ui-meta-line__sep" aria-hidden="true"/g)?.length, 2);
});

Deno.test("element, size, class and title pass through", () => {
	const html = renderToString(
		<MetaLine as="span" size="xs" class="x" items={[{ text: "3d ago", title: "14 Oct 2026" }]} />,
	);
	assertEquals(
		html,
		'<span class="ui-meta-line ui-meta-line--xs x">' +
			'<span class="ui-meta-line__item" title="14 Oct 2026">3d ago</span></span>',
	);
});

Deno.test("nothing renders when every entry is falsy", () => {
	assertEquals(renderToString(<MetaLine items={[null, "", { text: "" }]} />), "");
});

Deno.test("the line is type only — Meta register ink, no container", () => {
	const root = rule(".ui-meta-line");
	assert(root.includes("color: var(--text-secondary)"));
	assert(root.includes("font-size: var(--text-sm)"));
	assert(rule(".ui-meta-line__item--tabular").includes("font-variant-numeric: tabular-nums"));
	for (const prop of ["background", "border", "padding", "border-radius", "box-shadow"]) {
		assertFalse(
			css.includes(`${prop}:`),
			`meta-line.css declares ${prop} — §B.11 forbids a container`,
		);
	}
	assertFalse(/color-mix\(.*transparent/.test(css));
	assertFalse(/\d(ms|s)\b/.test(css), "meta-line.css carries a literal duration");
});
