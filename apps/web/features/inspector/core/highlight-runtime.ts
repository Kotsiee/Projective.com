import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import { CODE_LANGUAGES } from "@projective/types/files";

/**
 * highlight-runtime — highlight.js core plus a static, per-language loader map.
 *
 * **Never import this module statically** from an island or anything an island imports: reach it
 * only through `highlight-loader.ts`. Each language is its own dynamic import with a literal
 * specifier, so the bundler emits one small chunk per grammar and a page fetches only the grammar
 * its file needs. Every id {@link CODE_LANGUAGES} can name has an entry (plus `markdown` and
 * `plaintext`); a test pins that.
 */

// #region Languages
type LanguageModule = { default: LanguageFn };

/** Every grammar the inspector can load, keyed by highlight.js language id. */
export const LANGUAGE_LOADERS: Readonly<Record<string, () => Promise<LanguageModule>>> = {
	bash: () => import("highlight.js/lib/languages/bash"),
	c: () => import("highlight.js/lib/languages/c"),
	clojure: () => import("highlight.js/lib/languages/clojure"),
	cpp: () => import("highlight.js/lib/languages/cpp"),
	csharp: () => import("highlight.js/lib/languages/csharp"),
	css: () => import("highlight.js/lib/languages/css"),
	dart: () => import("highlight.js/lib/languages/dart"),
	diff: () => import("highlight.js/lib/languages/diff"),
	dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
	dos: () => import("highlight.js/lib/languages/dos"),
	elixir: () => import("highlight.js/lib/languages/elixir"),
	erlang: () => import("highlight.js/lib/languages/erlang"),
	fsharp: () => import("highlight.js/lib/languages/fsharp"),
	go: () => import("highlight.js/lib/languages/go"),
	graphql: () => import("highlight.js/lib/languages/graphql"),
	groovy: () => import("highlight.js/lib/languages/groovy"),
	haskell: () => import("highlight.js/lib/languages/haskell"),
	ini: () => import("highlight.js/lib/languages/ini"),
	java: () => import("highlight.js/lib/languages/java"),
	javascript: () => import("highlight.js/lib/languages/javascript"),
	json: () => import("highlight.js/lib/languages/json"),
	julia: () => import("highlight.js/lib/languages/julia"),
	kotlin: () => import("highlight.js/lib/languages/kotlin"),
	latex: () => import("highlight.js/lib/languages/latex"),
	less: () => import("highlight.js/lib/languages/less"),
	lua: () => import("highlight.js/lib/languages/lua"),
	makefile: () => import("highlight.js/lib/languages/makefile"),
	markdown: () => import("highlight.js/lib/languages/markdown"),
	nginx: () => import("highlight.js/lib/languages/nginx"),
	objectivec: () => import("highlight.js/lib/languages/objectivec"),
	perl: () => import("highlight.js/lib/languages/perl"),
	php: () => import("highlight.js/lib/languages/php"),
	plaintext: () => import("highlight.js/lib/languages/plaintext"),
	powershell: () => import("highlight.js/lib/languages/powershell"),
	properties: () => import("highlight.js/lib/languages/properties"),
	protobuf: () => import("highlight.js/lib/languages/protobuf"),
	python: () => import("highlight.js/lib/languages/python"),
	r: () => import("highlight.js/lib/languages/r"),
	ruby: () => import("highlight.js/lib/languages/ruby"),
	rust: () => import("highlight.js/lib/languages/rust"),
	scala: () => import("highlight.js/lib/languages/scala"),
	scss: () => import("highlight.js/lib/languages/scss"),
	sql: () => import("highlight.js/lib/languages/sql"),
	swift: () => import("highlight.js/lib/languages/swift"),
	typescript: () => import("highlight.js/lib/languages/typescript"),
	vbnet: () => import("highlight.js/lib/languages/vbnet"),
	x86asm: () => import("highlight.js/lib/languages/x86asm"),
	xml: () => import("highlight.js/lib/languages/xml"),
	yaml: () => import("highlight.js/lib/languages/yaml"),
};

/** Grammars another grammar embeds (`<style>`/`<script>` inside HTML), loaded alongside it. */
const EMBEDDED: Readonly<Record<string, readonly string[]>> = {
	xml: ["css", "javascript"],
	markdown: ["xml"],
};

/** Names people write on a fenced code block that are neither an extension nor a grammar id. */
const FENCE_ALIASES: Readonly<Record<string, string>> = {
	shell: "bash",
	console: "bash",
	sh: "bash",
	zsh: "bash",
	golang: "go",
	html: "xml",
	svg: "xml",
	"c++": "cpp",
	"c#": "csharp",
	"f#": "fsharp",
	md: "markdown",
	text: "plaintext",
	txt: "plaintext",
	docker: "dockerfile",
	make: "makefile",
	tex: "latex",
	yml: "yaml",
	ps: "powershell",
};

/** The grammar id for a fence tag or file extension (`ts`, `shell`, `typescript`), or `null`. */
export function resolveLanguage(name: string): string | null {
	const key = name.trim().toLowerCase();
	if (key.length === 0) return null;
	if (key in LANGUAGE_LOADERS) return key;
	const mapped = FENCE_ALIASES[key] ?? CODE_LANGUAGES[key];
	return mapped && mapped in LANGUAGE_LOADERS ? mapped : null;
}

const registering = new Map<string, Promise<boolean>>();

function register(id: string): Promise<boolean> {
	const existing = registering.get(id);
	if (existing) return existing;
	const loader = LANGUAGE_LOADERS[id];
	if (!loader) return Promise.resolve(false);
	const pending = loader().then(
		(mod) => {
			hljs.registerLanguage(id, mod.default);
			return true;
		},
		(error: unknown) => {
			registering.delete(id);
			throw error;
		},
	);
	registering.set(id, pending);
	return pending;
}

/**
 * Load a grammar (and the grammars it embeds) once. Resolves `false` for an unknown id; rejects when
 * the grammar's chunk cannot be fetched, so the caller can fall back to plain text.
 */
export async function ensureLanguage(id: string): Promise<boolean> {
	if (!(id in LANGUAGE_LOADERS)) return false;
	const embedded = EMBEDDED[id] ?? [];
	const [own] = await Promise.all([register(id), ...embedded.map(register)]);
	return own;
}

/** The grammar's display name ("TypeScript"), once loaded; else `null`. */
export function languageLabel(id: string): string | null {
	return hljs.getLanguage(id)?.name ?? null;
}
// #endregion

// #region Highlight
/**
 * Highlight `code` as `language`, loading the grammar first. Returns escaped HTML whose only markup
 * is `<span class="hljs-…">`, or `null` when the language is unknown.
 */
export async function highlightCode(code: string, language: string): Promise<string | null> {
	const id = resolveLanguage(language);
	if (!id || !(await ensureLanguage(id))) return null;
	return hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
}
// #endregion
