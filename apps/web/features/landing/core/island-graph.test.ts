/**
 * island-graph.test — the source walk that keeps the budget's island lists honest.
 *
 * The first half proves the walk on a fixture tree (barrels, `export *`, type-only and commented
 * imports, dynamic imports, the developer tools, islands inside islands). The second half runs it on
 * the real tree: every island `_app.tsx`, the landing branch of `(public)/_layout.tsx`,
 * `LandingShell` and each page controller renders must be in `js-budget.ts`, and nothing else may
 * be. A work order that adds an island to a landing page and forgets the list fails here.
 */
import { assert, assertEquals } from "@std/assert";
import {
	createResolver,
	type DenoJson,
	isIslandPath,
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

/** The workspace's own import map: root aliases and member `exports`. */
function repoWalk(): WalkOptions {
	const root = JSON.parse(readRepo("deno.json") ?? "{}") as DenoJson;
	const members = (root.workspace ?? []).map((dir) => {
		const clean = dir.replace(/^\.\//, "");
		return { dir: clean, json: JSON.parse(readRepo(`${clean}/deno.json`) ?? "{}") as DenoJson };
	});
	return { read: readRepo, resolve: createResolver(workspaceMapFrom(root, members)) };
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

Deno.test("LANDING_SHELL_ISLANDS is exactly what LandingShell renders", () => {
	assertEquals(paths(LANDING_SHELL_ISLANDS), islandsRenderedBy([ISLAND_SOURCES.shell], repoWalk()));
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
