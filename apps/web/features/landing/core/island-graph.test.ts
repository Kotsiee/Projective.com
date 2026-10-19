/**
 * island-graph.test — the source walk that keeps the budget's island lists honest.
 *
 * The first half proves the walk on a fixture tree (barrels, `export *`, type-only and commented
 * imports, dynamic imports, the developer tools, islands inside islands). The second half runs it on
 * the real tree: every island `_app.tsx`, the landing branch of `(public)/_layout.tsx`,
 * `LandingShell` (its `PublicFooter` apart) and each page controller renders must be in
 * `js-budget.ts`, and nothing else may be. A work order that adds an island to a landing page and
 * forgets the list fails here, and so does a landing branch that mounts the ticket host or the
 * eager chat host again (Decision #286 (A)).
 */
import { assert, assertEquals } from "@std/assert";
import {
	blankComments,
	createResolver,
	type DenoJson,
	isIslandPath,
	islandBindingsOf,
	islandsImportedBy,
	islandsRenderedBy,
	joinPath,
	parseImports,
	type SourceReader,
	type WalkOptions,
	workspaceMapFrom,
} from "./island-graph.ts";
import {
	APP_ISLANDS,
	type BudgetIsland,
	ISLAND_SOURCES,
	LANDING_FOOTER_ISLANDS,
	LANDING_LAYOUT_ISLANDS,
	LANDING_PAGES,
	LANDING_SHELL_ISLANDS,
	pageIslands,
} from "./js-budget.ts";

// #region Fixture tree
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	"apps/web/features/site/routes/Page.tsx": [
		'import type { Props } from "../types/props.ts";',
		'import { Shell } from "@features/site/components/Shell.tsx";',
		'import { Card, type CardProps } from "@projective/ui/display";',
		'import { Toc, Gallery as Pictures } from "@projective/ui/display";',
		'import "../styles/page.css";',
		'// import Ghost from "../islands/Ghost.island.tsx";',
		'import Hero from "../islands/Hero.island.tsx";',
		'import { signal } from "@preact/signals";',
		'const later = () => import("../islands/Later.island.tsx");',
		"export function Page() {}",
	].join("\n"),
	"apps/web/features/site/components/Shell.tsx": [
		'import Footer, { footerLinks } from "./Footer.tsx";',
		'import { DevMount } from "@web/features/devtools/components/DevMount.tsx";',
		"export function Shell() {}",
	].join("\n"),
	"apps/web/features/site/components/Footer.tsx": [
		'import Newsletter from "../islands/Newsletter.island.tsx";',
		"export const footerLinks = [];",
		"export default function Footer() {}",
	].join("\n"),
	"apps/web/features/devtools/components/DevMount.tsx":
		'import DevTools from "../islands/DevTools.island.tsx";\nexport function DevMount() {}',
	"apps/web/features/site/islands/Hero.island.tsx":
		'import Inner from "./Inner.island.tsx";\nexport default function Hero() {}',
	"apps/web/features/site/islands/Newsletter.island.tsx": "export default function Newsletter() {}",
	"packages/ui/display/mod.ts": [
		'export { Card, type CardProps } from "./components/Card.tsx";',
		'export { Gallery } from "./islands/Gallery.tsx";',
		'export { Carousel } from "./islands/Carousel.tsx";',
		'export * from "./editorial.ts";',
	].join("\n"),
	"packages/ui/display/components/Card.tsx": "export function Card() {}",
	"packages/ui/display/islands/Gallery.tsx": "export function Gallery() {}",
	"packages/ui/display/islands/Carousel.tsx": "export function Carousel() {}",
	"packages/ui/display/editorial.ts": 'export { Toc } from "./islands/Toc.tsx";',
	"packages/ui/display/islands/Toc.tsx": "export function Toc() {}",
};

const FIXTURE: WalkOptions = {
	read: (path) => FIXTURE_FILES[path] ?? null,
	resolve: createResolver({
		aliases: { "@features/": "apps/web/features/", "@web/": "apps/web/" },
		packages: [{
			name: "@projective/ui",
			dir: "packages/ui",
			exports: { "./display": "display/mod.ts" },
		}],
	}),
};
// #endregion

// #region Walk on the fixture
Deno.test("joinPath folds . and .. with forward slashes", () => {
	assertEquals(
		joinPath("apps/web/features/a/components", "../islands/./B.tsx"),
		"apps/web/features/a/islands/B.tsx",
	);
});

Deno.test("isIslandPath matches scripts under islands/, not their tests or stylesheets", () => {
	assert(isIslandPath("apps/web/features/a/islands/A.island.tsx"));
	assert(isIslandPath("packages/ui/fields/islands/Input.tsx"));
	assert(!isIslandPath("apps/web/features/a/islands/A.test.ts"));
	assert(!isIslandPath("apps/web/features/a/islands/a.css"));
	assert(!isIslandPath("apps/web/features/a/components/A.tsx"));
});

Deno.test("createResolver follows relative paths, aliases and package exports, and leaves registries alone", () => {
	const resolve = FIXTURE.resolve;
	const from = "apps/web/features/site/routes/Page.tsx";
	assertEquals(
		resolve("../islands/Hero.island.tsx", from),
		"apps/web/features/site/islands/Hero.island.tsx",
	);
	assertEquals(resolve("@web/utils/state.ts", from), "apps/web/utils/state.ts");
	assertEquals(resolve("@projective/ui/display", from), "packages/ui/display/mod.ts");
	assertEquals(resolve("@projective/ui/nowhere", from), null);
	assertEquals(resolve("@preact/signals", from), null);
	assertEquals(resolve("npm:preact@10", from), null);
});

Deno.test("parseImports skips type-only and commented imports, keeps side effects, and splits default from names", () => {
	const imports = parseImports(FIXTURE_FILES["apps/web/features/site/routes/Page.tsx"]);
	assertEquals(imports.map((statement) => statement.specifier), [
		"@features/site/components/Shell.tsx",
		"@projective/ui/display",
		"@projective/ui/display",
		"../islands/Hero.island.tsx",
		"@preact/signals",
		"../styles/page.css",
	]);
	assertEquals(imports[1], { specifier: "@projective/ui/display", names: ["Card"], whole: false });
	assertEquals(imports[2].names, ["Toc", "Gallery"]);
	assertEquals(imports[3].whole, true);
});

Deno.test("islandsRenderedBy traces barrel names, stops at islands, and skips lazy imports and the dev tools", () => {
	assertEquals(islandsRenderedBy(["apps/web/features/site/routes/Page.tsx"], FIXTURE), [
		"apps/web/features/site/islands/Hero.island.tsx",
		"apps/web/features/site/islands/Newsletter.island.tsx",
		"packages/ui/display/islands/Gallery.tsx",
		"packages/ui/display/islands/Toc.tsx",
	]);
});

Deno.test("islandBindingsOf: a component an island re-exports as its default renders that island anywhere", () => {
	const files: Readonly<Record<string, string>> = {
		"apps/web/features/site/routes/Prices.tsx": [
			'import { Money } from "@projective/ui/display";',
			'import { Card } from "@projective/ui/display";',
			"export function Prices() {}",
		].join("\n"),
		"packages/ui/display/mod.ts": [
			'export { Money } from "./components/Money.tsx";',
			'export { Card } from "./components/Card.tsx";',
		].join("\n"),
		"packages/ui/display/components/Money.tsx": "export function Money() {}",
		"packages/ui/display/components/Card.tsx": "export function Card() {}",
		// The island is the same function as the component, re-exported as its default.
		"packages/ui/display/islands/Money.island.tsx":
			'import { Money } from "../components/Money.tsx";\n// export default Ghost;\nexport default Money;',
		"packages/ui/display/islands/Badge.island.tsx":
			'export { Card as default } from "../components/Card.tsx";',
		// An island with a component of its own is not an alias of anything.
		"packages/ui/display/islands/Own.island.tsx": "export default function Own() {}",
	};
	const walk: WalkOptions = { read: (path) => files[path] ?? null, resolve: FIXTURE.resolve };
	const bindings = islandBindingsOf([
		"packages/ui/display/islands/Money.island.tsx",
		"packages/ui/display/islands/Badge.island.tsx",
		"packages/ui/display/islands/Own.island.tsx",
	], walk);
	assertEquals([...bindings.entries()].sort(), [
		[
			"packages/ui/display/components/Card.tsx#Card",
			"packages/ui/display/islands/Badge.island.tsx",
		],
		[
			"packages/ui/display/components/Money.tsx#Money",
			"packages/ui/display/islands/Money.island.tsx",
		],
	]);
	assertEquals(
		islandsRenderedBy(["apps/web/features/site/routes/Prices.tsx"], {
			...walk,
			islandBindings: bindings,
		}),
		[
			"packages/ui/display/islands/Badge.island.tsx",
			"packages/ui/display/islands/Money.island.tsx",
		],
	);
	assertEquals(islandsRenderedBy(["apps/web/features/site/routes/Prices.tsx"], walk), []);
});

Deno.test("islandsImportedBy lists only a module's direct island imports", () => {
	assertEquals(islandsImportedBy("apps/web/features/site/islands/Hero.island.tsx", FIXTURE), [
		"apps/web/features/site/islands/Inner.island.tsx",
	]);
	assertEquals(islandsImportedBy("apps/web/features/site/components/Shell.tsx", FIXTURE), []);
});
// #endregion

// #region The real tree
/** The repository root, from `apps/web/features/landing/core/`. */
const ROOT = new URL("../../../../../", import.meta.url);

const readRepo: SourceReader = (path) => {
	try {
		return Deno.readTextFileSync(new URL(path, ROOT));
	} catch {
		return null;
	}
};

/** Directories never searched for island modules: dependencies and build output. */
const SKIPPED_DIRS = new Set(["node_modules", "_fresh", ".vite", "dist", "coverage"]);

/** Every island module under `dir` (repository-relative), recursively. */
function islandModulesUnder(dir: string): string[] {
	const out: string[] = [];
	let entries: Deno.DirEntry[];
	try {
		entries = [...Deno.readDirSync(new URL(`${dir}/`, ROOT))];
	} catch {
		return out;
	}
	for (const entry of entries) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory && !SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
			out.push(...islandModulesUnder(path));
		} else if (entry.isFile && isIslandPath(path)) out.push(path);
	}
	return out;
}

/**
 * The workspace's own import map (root aliases and member `exports`), with every island the app
 * and its packages can register read for components it re-exports as its default.
 */
function repoWalk(): WalkOptions {
	const root = JSON.parse(readRepo("deno.json") ?? "{}") as DenoJson;
	const members = (root.workspace ?? []).map((dir) => {
		const clean = dir.replace(/^\.\//, "");
		return { dir: clean, json: JSON.parse(readRepo(`${clean}/deno.json`) ?? "{}") as DenoJson };
	});
	const base = { read: readRepo, resolve: createResolver(workspaceMapFrom(root, members)) };
	const islands = [...islandModulesUnder("apps/web"), ...islandModulesUnder("packages")];
	return { ...base, islandBindings: islandBindingsOf(islands, base) };
}

const paths = (islands: readonly BudgetIsland[]) => islands.map((island) => island.path).sort();

Deno.test("APP_ISLANDS is exactly what _app.tsx renders on every page", () => {
	assertEquals(paths(APP_ISLANDS), islandsRenderedBy([ISLAND_SOURCES.app], repoWalk()));
});

Deno.test("LANDING_LAYOUT_ISLANDS are islands the public layout mounts", () => {
	const imported = islandsImportedBy(ISLAND_SOURCES.layout, repoWalk());
	for (const island of LANDING_LAYOUT_ISLANDS) {
		assert(
			imported.includes(island.path),
			`${ISLAND_SOURCES.layout} does not import ${island.path}`,
		);
	}
});

/**
 * The landing branch of the public layout, comments blanked: from its `LANDING_PATHS` test to the
 * branch's closing brace (the first line that is one tab and `}`).
 */
function landingBranch(): string {
	const src = blankComments(readRepo(ISLAND_SOURCES.layout) ?? "").replace(/\r\n/g, "\n");
	const start = src.indexOf("if (LANDING_PATHS.has(ctx.url.pathname)) {");
	assert(start !== -1, `${ISLAND_SOURCES.layout} has no LANDING_PATHS branch`);
	const end = src.indexOf("\n\t}\n", start);
	assert(end !== -1, `${ISLAND_SOURCES.layout}: the LANDING_PATHS branch does not close`);
	return src.slice(start, end);
}

/** An island's component name as the layout imports it: its file name without `.island.tsx`. */
const componentOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");

Deno.test("the landing branch mounts exactly LANDING_LAYOUT_ISLANDS: no ticket host, no eager chat host", () => {
	const branch = landingBranch();
	const declared = new Set(LANDING_LAYOUT_ISLANDS.map((island) => island.path));
	for (const path of islandsImportedBy(ISLAND_SOURCES.layout, repoWalk())) {
		const mounted = new RegExp(`<${componentOf(path)}\\b`).test(branch);
		assertEquals(
			mounted,
			declared.has(path),
			`the landing branch and the list disagree on ${path}`,
		);
	}
	assert(
		/authed\s*\?\s*<LazyChatHost\b/.test(branch),
		"LazyChatHost must mount for a signed-in visitor only",
	);
});

Deno.test("LANDING_SHELL_ISLANDS and LANDING_FOOTER_ISLANDS are together exactly what LandingShell renders", () => {
	const walk = repoWalk();
	assertEquals(paths(LANDING_FOOTER_ISLANDS), islandsRenderedBy([ISLAND_SOURCES.footer], walk));
	assertEquals(
		paths([...LANDING_SHELL_ISLANDS, ...LANDING_FOOTER_ISLANDS]),
		islandsRenderedBy([ISLAND_SOURCES.shell], walk),
	);
});

Deno.test("every landing page controller has a budget page", () => {
	const controllers: string[] = [];
	for (const entry of Deno.readDirSync(new URL("apps/web/features/landing/routes/", ROOT))) {
		if (entry.isFile && /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
			controllers.push(`apps/web/features/landing/routes/${entry.name}`);
		}
	}
	assertEquals(LANDING_PAGES.map((page) => page.controller).sort(), controllers.sort());
});

Deno.test("each budget page lists exactly the islands its controller renders", () => {
	const walk = repoWalk();
	for (const page of LANDING_PAGES) {
		assertEquals(paths(page.islands), islandsRenderedBy([page.controller], walk), page.path);
	}
});

Deno.test("every declared island is an island module that exists, listed once per page", () => {
	for (const page of LANDING_PAGES) {
		const all = pageIslands(page).map((island) => island.path);
		assertEquals(all.length, new Set(all).size, `${page.path} lists an island twice`);
		for (const path of all) {
			assert(isIslandPath(path), `${path} is not under an islands/ directory`);
			assert(readRepo(path) !== null, `${path} does not exist`);
		}
	}
});
// #endregion
