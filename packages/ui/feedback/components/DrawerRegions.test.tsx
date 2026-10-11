import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { DrawerRegions } from "./DrawerRegions.tsx";

const css = Deno.readTextFileSync(new URL("../styles/drawer.css", import.meta.url));

/** The declarations of one top-level rule in drawer.css. */
function rule(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	assert(at >= 0, `missing rule ${selector}`);
	return css.slice(at, css.indexOf("}", at));
}

Deno.test("footer renders after the scroll body, not inside it", () => {
	const html = renderToString(
		<DrawerRegions footer={<button type="button">Pay</button>}>
			<p>Line</p>
		</DrawerRegions>,
	);
	assertEquals(
		html,
		'<div class="ui-drawer__body"><p>Line</p></div>' +
			'<div class="ui-drawer__footer"><button type="button">Pay</button></div>',
	);
});

Deno.test("no footer region without a footer", () => {
	assertFalse(renderToString(<DrawerRegions>x</DrawerRegions>).includes("ui-drawer__footer"));
	assertFalse(
		renderToString(<DrawerRegions footer={false}>x</DrawerRegions>).includes("ui-drawer__footer"),
	);
});

Deno.test("only the body scrolls; the footer is pinned behind one hairline", () => {
	assert(rule(".ui-drawer__body").includes("overflow: auto"));
	const footer = rule(".ui-drawer__footer");
	assert(footer.includes("flex: none"));
	assert(footer.includes("border-block-start: var(--hairline)"));
	assert(footer.includes("env(safe-area-inset-bottom)"));
	assertFalse(footer.includes("overflow"));
});
