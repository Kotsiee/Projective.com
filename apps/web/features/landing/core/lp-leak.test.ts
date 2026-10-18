/**
 * lp-leak.test — the landing namespace's leak gate (Decision #280 (E), allowlist per #285 (B)).
 *
 * The `lp-` classes and `--lp-*` tokens are a scoped exemption from the design system, legal only
 * in `apps/web/features/landing/**`, the `/` route (`routes/(public)/index.tsx`) and the `/features`
 * route (`routes/(public)/features.tsx`). This reads every `.ts`, `.tsx`, `.js`, `.jsx` and `.css`
 * file under `apps/web/` and `packages/` and fails, naming `file:line`, on any `lp-` name or
 * `--lp-*` custom property anywhere else.
 *
 * The allowlist is the footer's pre-existing block and nothing else, kept until it is renamed after
 * P8 (#285 (B)). It applies only inside {@link FOOTER_FAMILY}, the files #285 (B) names:
 *   - a class in the `lp-footer` BEM family exactly (`lp-footer`, `lp-footer__x`, `lp-footer__x--y`),
 *     plus the three ids and one keyframes name that block already uses ({@link FOOTER_NAMES});
 *   - an `--lp-*` token declared in the same file that reads it (the footer-local tokens);
 *   - `marketing/styles/hero-search.css` reading `--lp-hair-strong` (with an app-token fallback).
 * Any other file is held to the full rule: a stylesheet that declares `--lp-text` to restyle the
 * landing from outside, or a component carrying `lp-footer-cta`, is a leak.
 *
 * Comments are blanked before matching (line breaks kept, so offsets still map to source lines):
 * prose may name the namespace — `packages/ui/styles/index.css` does — without leaking it. String
 * literals are kept, because that is where class names live, and a `//` right after a `:` is a URL's
 * scheme separator (`https://`, in JSX text or anywhere else), never a comment opener.
 */
import { assert, assertEquals } from "@std/assert";

// #region Policy
/** The repository root, from `apps/web/features/landing/core/`. */
const ROOT = new URL("../../../../../", import.meta.url);

/** The trees the gate reads, relative to the root. */
const SCAN_ROOTS = ["apps/web/", "packages/"] as const;

/** Build output, dependencies and tool folders are not source. */
const SKIP_DIRS = new Set(["node_modules", "_fresh", "dist", "coverage", "vendor"]);

/** The file kinds that can name a class or a custom property (Vite registers `.jsx` islands too). */
const SCANNED = /\.(tsx?|jsx?|css)$/;

/** The exempt paths (Decision #280 (A)). */
function isExempt(path: string): boolean {
	return path.startsWith("apps/web/features/landing/") ||
		path === "apps/web/routes/(public)/index.tsx" ||
		path === "apps/web/routes/(public)/features.tsx";
}

/** The footer's pre-existing `lp-footer` block — the only files the #285 (B) allowlist reaches. */
const FOOTER_FAMILY: ReadonlySet<string> = new Set([
	"apps/web/features/marketing/components/PublicFooter.tsx",
	"apps/web/features/marketing/islands/FooterLinkGroups.island.tsx",
	"apps/web/features/marketing/islands/NewsletterForm.island.tsx",
	"apps/web/features/marketing/islands/RecentlyViewed.island.tsx",
	"apps/web/features/marketing/styles/footer.css",
	"apps/web/features/marketing/styles/hero-search.css",
	"apps/web/features/shell/styles/guest-shell.css",
]);

/** The `lp-footer` BEM family: the block, an element, and either one's modifier. */
const FOOTER_CLASS = /^lp-footer(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$/;

/** The names outside that pattern the footer block already uses: three ids and one keyframes. */
const FOOTER_NAMES: ReadonlySet<string> = new Set([
	"lp-footer-brand",
	"lp-footer-news-error",
	"lp-footer-recent",
	"lp-footer-breathe",
]);

/** Token reads #285 (B) keeps in place although their file does not declare them. */
const NAMED_EXCEPTIONS: ReadonlyArray<{ path: string; token: string }> = [
	{ path: "apps/web/features/marketing/styles/hero-search.css", token: "--lp-hair-strong" },
];
// #endregion

// #region Scanner
/** One namespace use outside the exempt paths. */
interface Leak {
	path: string;
	line: number;
	token: string;
}

/** Blank `text[start, end)` to spaces, keeping line breaks so offsets keep their line. */
function blank(text: string, start: number, end: number): string {
	return text.slice(start, end).replace(/[^\n]/g, " ");
}

/**
 * Blank every comment in `src`, skipping string literals so a `//` or `/*` inside one is not read
 * as a comment opener. CSS has block comments only (`//` is a URL there); TypeScript has both.
 */
function blankComments(src: string, lineComments: boolean): string {
	const out: string[] = [];
	let copied = 0;
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		const next = src[i + 1];
		const scheme = next === "/" && src[i - 1] === ":";
		if (ch === "/" && (next === "*" || (lineComments && next === "/" && !scheme))) {
			const close = next === "*" ? src.indexOf("*/", i + 2) : src.indexOf("\n", i);
			const end = close === -1 ? src.length : next === "*" ? close + 2 : close;
			out.push(src.slice(copied, i), blank(src, i, end));
			copied = i = end;
		} else if (ch === '"' || ch === "'" || ch === "`") {
			let j = i + 1;
			while (j < src.length && src[j] !== ch) {
				if (src[j] === "\\") j++;
				else if (src[j] === "\n" && ch !== "`") break;
				j++;
			}
			i = j + 1;
		} else {
			i++;
		}
	}
	out.push(src.slice(copied));
	return out.join("");
}

function lineOf(text: string, index: number): number {
	return text.slice(0, index).split("\n").length;
}

/** An `lp-` class (or any other `lp-` name) — but not the `lp-` inside an `--lp-` token. */
const CLASS_TOKEN = /(?<!--)\blp-[a-z][\w-]*/g;
/** An `--lp-*` custom property, read or declared. */
const CUSTOM_PROPERTY = /--lp-[a-z0-9][\w-]*/g;

/**
 * Every leak in one file. `path` is repository-relative with `/` separators; an exempt path has
 * none by definition.
 */
function findLeaks(path: string, source: string): Leak[] {
	if (isExempt(path) || !source.includes("lp-")) return [];
	const text = blankComments(source.replace(/\r\n?/g, "\n"), !path.endsWith(".css"));
	const footer = FOOTER_FAMILY.has(path);
	const declared = footer
		? new Set([...text.matchAll(/(--lp-[a-z0-9][\w-]*)\s*:/g)].map((m) => m[1]))
		: new Set<string>();
	const leaks: Leak[] = [];
	for (const match of text.matchAll(CLASS_TOKEN)) {
		const name = match[0];
		if (footer && (FOOTER_CLASS.test(name) || FOOTER_NAMES.has(name))) continue;
		leaks.push({ path, line: lineOf(text, match.index), token: name });
	}
	for (const match of text.matchAll(CUSTOM_PROPERTY)) {
		const token = match[0];
		if (declared.has(token)) continue;
		if (NAMED_EXCEPTIONS.some((e) => e.path === path && e.token === token)) continue;
		leaks.push({ path, line: lineOf(text, match.index), token });
	}
	return leaks.sort((a, b) => a.line - b.line);
}

/** Every scanned file under `dir` (repository-relative), depth first. */
function* walk(dir: string): Generator<string> {
	for (const entry of Deno.readDirSync(new URL(dir, ROOT))) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory) {
			if (!SKIP_DIRS.has(entry.name)) yield* walk(`${dir}${entry.name}/`);
		} else if (entry.isFile && SCANNED.test(entry.name)) {
			yield `${dir}${entry.name}`;
		}
	}
}
// #endregion

// #region Gate
Deno.test("no lp- class or --lp-* token leaks outside the landing's exempt paths", () => {
	const leaks: Leak[] = [];
	let scanned = 0;
	for (const root of SCAN_ROOTS) {
		for (const path of walk(root)) {
			scanned++;
			leaks.push(...findLeaks(path, Deno.readTextFileSync(new URL(path, ROOT))));
		}
	}
	assert(scanned > 500, `the scan read only ${scanned} files — is the root right?`);
	assertEquals(
		leaks.map((l) => `${l.path}:${l.line} ${l.token}`),
		[],
		"the lp- namespace is scoped to apps/web/features/landing/**, / and /features (Decision #280)",
	);
});
// #endregion

// #region Self-test
Deno.test("the scanner catches a planted leak and honours the allowlist", () => {
	const path = "apps/web/features/explore/components/Planted.tsx";
	assertEquals(
		findLeaks(path, `const a = 1;\nexport const X = () => <div class="ex-card lp-hero__title" />;`),
		[{ path, line: 2, token: "lp-hero__title" }],
	);
	assertEquals(
		findLeaks(path, `<div data-lp-bg="static" />`).map((l) => l.token),
		["lp-bg"],
	);

	const sheet = "apps/web/features/explore/styles/planted.css";
	assertEquals(
		findLeaks(sheet, ".ex-card {\n\tcolor: var(--lp-text);\n}"),
		[{ path: sheet, line: 2, token: "--lp-text" }],
	);
	assertEquals(findLeaks(sheet, "@keyframes lp-ring-turn {}").map((l) => l.token), [
		"lp-ring-turn",
	]);

	// Inside the footer family: its BEM classes, its named ids and a same-file token are not leaks…
	const footer = "apps/web/features/marketing/components/PublicFooter.tsx";
	const footerSheet = "apps/web/features/marketing/styles/footer.css";
	assertEquals(
		findLeaks(
			footer,
			`<footer class="lp-footer lp-footer__inner lp-footer__news-field--invalid" />`,
		),
		[],
	);
	assertEquals(findLeaks(footer, `<footer aria-labelledby="lp-footer-brand" />`), []);
	assertEquals(
		findLeaks(footerSheet, ".x {\n\t--lp-pad-x: 1rem;\n\tpadding: var(--lp-pad-x);\n}"),
		[],
	);
	// …but a name outside the family is a leak even there.
	assertEquals(
		findLeaks(footer, `<a class="lp-footer-cta lp-footerless lp-hero" />`).map((l) => l.token),
		["lp-footer-cta", "lp-footerless", "lp-hero"],
	);

	// Outside the footer family the allowlist does not apply at all.
	assertEquals(
		findLeaks(path, `<a class="lp-footer lp-footer-cta lp-footerless" />`).map((l) => l.token),
		["lp-footer", "lp-footer-cta", "lp-footerless"],
	);
	assertEquals(
		findLeaks(
			"packages/ui/styles/new.css",
			"#main-content { --lp-text: red; --lp-amber: hotpink; }",
		)
			.map((l) => l.token),
		["--lp-text", "--lp-amber"],
	);
	assertEquals(
		findLeaks(sheet, ".ex-card { --lp-accent: teal; color: var(--lp-accent); }").map((l) =>
			l.token
		),
		["--lp-accent", "--lp-accent"],
	);

	// A URL in JSX text does not open a line comment that would hide the rest of its line.
	assertEquals(
		findLeaks(path, `<p>see https://x.y</p><div class="lp-hero" />`).map((l) => l.token),
		["lp-hero"],
	);
	// A .jsx or .js file is read like any other.
	assert(SCANNED.test("Planted.island.jsx") && SCANNED.test("sw.js"));
	assertEquals(
		findLeaks("apps/web/features/explore/islands/Planted.island.jsx", `<b class="lp-root" />`)
			.map((l) => l.token),
		["lp-root"],
	);

	// Prose in a comment and a URL are not leaks.
	assertEquals(findLeaks(sheet, "/* re-derived as --lp-hair-strong and .lp-root */\n.x {}"), []);
	assertEquals(findLeaks(path, "// the old .lp-hero\nconst help = 'help-text';"), []);
	assertEquals(findLeaks(path, `const u = "https://example.com"; // .lp-root`), []);
	assertEquals(findLeaks(sheet, ".x { background: url(https://example.com/a.png); }"), []);

	// A string keeps its class names even when it carries a comment opener.
	assertEquals(findLeaks(path, `const s = "/* lp-hero */";`).map((l) => l.token), ["lp-hero"]);

	// The named exception covers exactly its file and token.
	const heroSearch = "apps/web/features/marketing/styles/hero-search.css";
	assertEquals(findLeaks(heroSearch, ".t { border-color: var(--lp-hair-strong, red); }"), []);
	assertEquals(
		findLeaks(heroSearch, ".t { color: var(--lp-text); }").map((l) => l.token),
		["--lp-text"],
	);

	// The exempt paths may use the namespace freely.
	assertEquals(findLeaks("apps/web/features/landing/styles/lp-shell.css", ".lp-root {}"), []);
	assertEquals(findLeaks("apps/web/routes/(public)/index.tsx", `<div class="lp-root" />`), []);
	assertEquals(findLeaks("apps/web/routes/(public)/features.tsx", `<div class="lp-root" />`), []);
	assertEquals(
		findLeaks("apps/web/routes/(public)/about.tsx", `<div class="lp-root" />`).length,
		1,
	);
});
// #endregion
