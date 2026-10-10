import { assert, assertEquals } from "@std/assert";
import { CODE_LANGUAGES } from "@projective/types/files";
import {
	highlightCode,
	LANGUAGE_LOADERS,
	languageLabel,
	resolveLanguage,
} from "./highlight-runtime.ts";
import { highlightedLines } from "./code-lines.ts";

Deno.test("every language CODE_LANGUAGES names has a loader, plus markdown and plaintext", () => {
	const needed = new Set([...Object.values(CODE_LANGUAGES), "markdown", "plaintext"]);
	const missing = [...needed].filter((id) => !(id in LANGUAGE_LOADERS));
	assertEquals(missing, []);
});

Deno.test("every loader resolves to a highlight.js grammar", async () => {
	for (const [id, load] of Object.entries(LANGUAGE_LOADERS)) {
		const mod = await load();
		assertEquals(typeof mod.default, "function", id);
	}
});

Deno.test("resolveLanguage maps extensions, fence aliases and ids", () => {
	assertEquals(resolveLanguage("ts"), "typescript");
	assertEquals(resolveLanguage("TypeScript"), "typescript");
	assertEquals(resolveLanguage("shell"), "bash");
	assertEquals(resolveLanguage("html"), "xml");
	assertEquals(resolveLanguage("c++"), "cpp");
	assertEquals(resolveLanguage("klingon"), null);
	assertEquals(resolveLanguage(""), null);
});

Deno.test("highlightCode escapes, colours and splits into balanced lines", async () => {
	const source = "const a = `x\n${b}` < 2; // <tag>";
	const html = await highlightCode(source, "ts");
	assert(html !== null);
	assert(html.includes('<span class="hljs-keyword">const</span>'));
	assert(html.includes("&lt;tag&gt;"));
	const lines = highlightedLines(html, 2);
	assertEquals(lines.length, 2);
	for (const line of lines) {
		assertEquals((line.match(/<span/g) ?? []).length, (line.match(/<\/span>/g) ?? []).length);
	}
	assertEquals(languageLabel("typescript"), "TypeScript");
	assertEquals(await highlightCode("x", "klingon"), null);
});

Deno.test("html embeds css and javascript grammars", async () => {
	const html = await highlightCode("<style>a{color:red}</style><script>let x</script>", "html");
	assert(html !== null);
	assert(html.includes("hljs-selector-tag") || html.includes("hljs-attribute"));
	assert(html.includes('<span class="hljs-keyword">let</span>'));
});
