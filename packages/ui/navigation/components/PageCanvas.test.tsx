import { assert, assertEquals, assertFalse } from "@std/assert";
import type { ComponentChildren, JSX } from "preact";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";

/**
 * PageCanvas, rendered — the canvas body is the page's one `<main>`, and the optional `footer` slot is
 * its SIBLING, never its child, so a `<footer>` passed in is the page's `contentinfo` landmark
 * (Decision #295). Before the slot existed the signed-in shell mounted the site footer inside
 * `<main>`, and a signed-in page had no `contentinfo` while the same page for a guest did.
 *
 * ## Why the component is imported through a data URL
 *
 * `PageCanvas.tsx` and `ShellFrame.tsx` import their `.css`, which a plain `deno test` refuses to
 * load. Each is loaded from its own source with the stylesheet import dropped and every other
 * specifier resolved in place (the `WorkRoster.test.tsx` arrangement).
 */

// #region CSS-free import
/** A data URL sits outside every config, so its JSX factory is named in place. */
const JSX_PRAGMA = `/** @jsxRuntime classic */\n/** @jsx h */\n/** @jsxFrag Fragment */\n` +
	`import { Fragment, h } from "${import.meta.resolve("preact")}";\n`;

/** `file`'s source as an importable data URL: stylesheets dropped, `swaps` applied, the rest resolved. */
async function cssFree(file: URL, swaps: Record<string, string> = {}): Promise<string> {
	let source = (await Deno.readTextFile(file)).replace(/^import\s+"[^"]+\.css";\s*$/gm, "");
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		const target = swaps[spec] ??
			(spec.startsWith(".") ? new URL(spec, file).href : import.meta.resolve(spec));
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	return `data:text/tsx,${encodeURIComponent(JSX_PRAGMA + source)}`;
}

/** `PageCanvas`'s signature, restated: `typeof import(…)` would pull the CSS back into the graph. */
type PageCanvasFn = (props: {
	footer?: ComponentChildren;
	mainId?: string;
	children?: ComponentChildren;
}) => JSX.Element;

const SHELL_FRAME = await cssFree(new URL("./ShellFrame.tsx", import.meta.url));
const { PageCanvas } = await import(
	await cssFree(new URL("./PageCanvas.tsx", import.meta.url), { "./ShellFrame.tsx": SHELL_FRAME })
) as { PageCanvas: PageCanvasFn };
// #endregion

const count = (html: string, needle: string): number => html.split(needle).length - 1;

Deno.test("PageCanvas: the footer slot follows </main> — one main, and the footer outside it", () => {
	const html = renderToString(
		<PageCanvas footer={<footer class="site-foot">Site</footer>}>
			<p>Page</p>
		</PageCanvas>,
	);
	assertEquals(count(html, "<main"), 1);
	assertEquals(count(html, "<footer"), 1);
	const mainEnd = html.indexOf("</main>");
	const slot = html.indexOf('class="ui-page-canvas__footer"');
	assert(slot > mainEnd, "the slot opens after </main>");
	assert(html.indexOf("<footer") > mainEnd, "the footer is not inside <main>");
	assert(html.indexOf("<p>Page</p>") < mainEnd, "the page stays inside <main>");
});

Deno.test("PageCanvas: no footer, or a withheld one, renders no slot", () => {
	for (const footer of [undefined, null]) {
		const html = renderToString(<PageCanvas footer={footer}>Page</PageCanvas>);
		assertFalse(html.includes("ui-page-canvas__footer"));
		assertEquals(count(html, "<main"), 1);
	}
});

Deno.test("page-canvas.css: the slot is positioned, and below --bp-md it takes the BottomNav clearance", () => {
	const css = Deno.readTextFileSync(new URL("../styles/page-canvas.css", import.meta.url));
	const slot = css.slice(css.indexOf(".ui-page-canvas__footer {"));
	assert(/^\.ui-page-canvas__footer \{[^}]*position: relative;/m.test(slot), "positioned");
	const mobile = css.slice(css.indexOf("@media (max-width: 767px)"));
	assert(
		/\.ui-page-canvas:has\(> \.ui-page-canvas__footer\) > \.ui-page-canvas__body \{\s*padding-block-end: 0;/
			.test(mobile),
		"the body gives its reservation up when a footer follows it",
	);
	assert(
		/\.ui-page-canvas__footer \{\s*padding-block-end: calc\(\s*var\(--shell-bottomnav-h\)/.test(
			mobile,
		),
		"the footer slot reserves the bar's height",
	);
});
