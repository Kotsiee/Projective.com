/**
 * js-budget — the landing's JavaScript budget (`flows/LANDING.md` §7) as data and pure functions
 * over Vite's client manifest. `scripts/landing-budget.ts` (`deno task budget:landing`) is the I/O
 * around it: it reads a production build, gzips each chunk and prints the verdict.
 *
 * What "initial" means. A built page loads one module script, `import { boot } from "<client
 * entry>"` followed by an `import` of every island the server render met (Fresh's
 * `FreshRuntimeScript`, mirrored by its `Link: rel=modulepreload` header). The browser then fetches
 * the static-import closure of those modules. So a page's initial JS is the client entry
 * (`fresh:client-entry`, which carries `apps/web/client.ts`), each rendered island, and every chunk
 * they import statically, each file counted once. A `dynamicImports` edge is lazy: its chunk loads
 * only when the code calls `import()`, so it is reported apart and sits outside the initial budget.
 *
 * What the budget counts (Decision #286 (A), owner ruling 2026-10-18: "strip + defer + rescope").
 * Each initial chunk belongs to one {@link BudgetGroup}, by the mount of the islands that reach it:
 *  - the app baseline — the client entry and the `_app.tsx` islands, loaded by every page of the
 *    app. It is held to {@link APP_BASELINE_PIN}, main's measured size, re-pinned after each main
 *    merge (Decision #289): until main is merged again, one more byte fails, so landing commits
 *    cannot grow it; once main has moved, main's growth is reported until the re-pin, never failing
 *    ({@link baselineRule}). Trimming it is app-wide work, outside the landing.
 *  - landing-owned — every chunk a landing island reaches beyond the baseline: `LandingShell`'s
 *    header and the page's own islands (hero, demos, background), whether or not a footer island
 *    or a layout host shares the chunk. The 60 kB ({@link LANDING_JS_BUDGET.landingOwned}) fails here.
 *  - the layout hosts (the `(public)/_layout.tsx` landing branch) and the footer islands — reported,
 *    each as what it adds beyond the two groups above.
 * The page totals for a guest and for a signed-in visitor are reported and never fail. Each island
 * with an {@link BudgetIsland.ownMax} (the hero's 20 kB) fails past its cap, and so does each lazy
 * chunk the landing owns past 35 kB; a lazy chunk the landing does not own is reported.
 *
 * Which islands render is declared here, by where they mount: {@link APP_ISLANDS} (`_app.tsx`, every
 * page), {@link LANDING_LAYOUT_ISLANDS} (the `(public)/_layout.tsx` landing branch),
 * {@link LANDING_SHELL_ISLANDS} (`LandingShell`'s own), {@link LANDING_FOOTER_ISLANDS} (the
 * `PublicFooter` that `LandingShell` renders) and each page of {@link LANDING_PAGES}. A work order
 * that adds an island to a landing page adds it to its list; `island-graph.test.ts` walks the source
 * and fails while a list and the code disagree.
 */
import BASELINE_PIN_JSON from "./js-budget-baseline.json" with { type: "json" };

// #region Budgets
/** One kilobyte as Vite reports it (`kB`): 1,000 bytes. */
export const KB = 1000;

/**
 * The landing's JavaScript budgets in gzip bytes (`flows/LANDING.md` §7, build prompts §2.0, L2,
 * L3, as ruled by Decision #286 (A)). The app baseline's cap is its pin, {@link APP_BASELINE_PIN}.
 */
export const LANDING_JS_BUDGET = {
	/** Landing-owned initial JS of each landing page (see {@link BudgetGroup}), lazy chunks excluded. */
	landingOwned: 60 * KB,
	/** The hero search island's own weight (L2), set as that island's {@link BudgetIsland.ownMax}. */
	heroIsland: 20 * KB,
	/**
	 * Each lazily loaded chunk the landing owns — its source under `features/landing/`, or loaded by
	 * `import()` from a landing-owned chunk (the hero's lazily loaded Explore client too): the L3 demo
	 * cap, applied to every such chunk.
	 */
	lazyChunk: 35 * KB,
} as const;

/** Manifest-key prefix of the landing's own modules, whose lazy chunks {@link LANDING_JS_BUDGET.lazyChunk} always caps. */
const LANDING_KEY_PREFIX = "features/landing/";
// #endregion

// #region Baseline pin
/**
 * The app baseline's pin (Decision #289, owner ruling 2026-10-19: "Re-pin on each main merge"):
 * the client entry and the `_app.tsx` islands at main's measured size, committed as
 * {@link BASELINE_PIN_PATH} and written only by `deno task budget:landing --repin`, run after each
 * merge of main into the landing branch.
 */
export interface BaselinePin {
	/** The app baseline in gzip bytes on the production build measured at the pin. */
	bytes: number;
	/** When that build was measured (ISO 8601, UTC). */
	measuredAt: string;
	/** `git merge-base HEAD main` at the pin: the main commit last merged into the branch. */
	mainSha: string;
}

/** The committed pin, repository-relative. */
export const BASELINE_PIN_PATH = "apps/web/features/landing/core/js-budget-baseline.json";

/**
 * `value` as a {@link BaselinePin}; other keys (the file's `$comment`) are dropped.
 *
 * @throws When `bytes` is not a positive whole number, `measuredAt` not a date or `mainSha` not a
 *   full 40-character commit id.
 */
export function parseBaselinePin(value: unknown): BaselinePin {
	const { bytes, measuredAt, mainSha } = (value ?? {}) as Record<string, unknown>;
	if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
		throw new Error(`js-budget: the baseline pin's bytes must be a positive integer (${bytes})`);
	}
	if (typeof measuredAt !== "string" || Number.isNaN(Date.parse(measuredAt))) {
		throw new Error(`js-budget: the baseline pin's measuredAt must be a date (${measuredAt})`);
	}
	if (typeof mainSha !== "string" || !/^[0-9a-f]{40}$/.test(mainSha)) {
		throw new Error(`js-budget: the baseline pin's mainSha must be a commit id (${mainSha})`);
	}
	return { bytes, measuredAt, mainSha };
}

/** The committed pin ({@link BASELINE_PIN_PATH}). */
export const APP_BASELINE_PIN: BaselinePin = parseBaselinePin(BASELINE_PIN_JSON);

/** How one run judges the app baseline against its pin. */
export interface BaselineRule {
	/** The pinned bytes. */
	max: number;
	/** `true`: past `max` fails. `false`: main has moved since the pin, so past `max` is reported. */
	held: boolean;
}

/**
 * The run's {@link BaselineRule}: held to the pin while `git merge-base HEAD main` still equals the
 * pin's `mainSha` — no main merge since, so any growth is the branch's own — and held as well when the
 * merge base cannot be resolved (`null`), so a missing `main` never waives the cap. Once main has
 * been merged since the pin, its growth is main's: reported, never failing, until `--repin`.
 */
export function baselineRule(pin: BaselinePin, mergeBase: string | null): BaselineRule {
	return { max: pin.bytes, held: mergeBase === null || mergeBase === pin.mainSha };
}

/** What `--repin` decides: the new pin, or why it is refused. */
export type RepinResult = { ok: true; pin: BaselinePin } | { ok: false; reason: string };

/**
 * The pin `--repin` writes from a fresh measurement: `measured` bytes at `mergeBase`. Refused when
 * main has not been merged since `previous` and the baseline grew — landing commits may not grow it;
 * a trim lowers the pin either way.
 */
export function repinBaseline(
	previous: BaselinePin,
	measured: number,
	mergeBase: string,
	measuredAt: string,
): RepinResult {
	if (mergeBase === previous.mainSha && measured > previous.bytes) {
		return {
			ok: false,
			reason: `main has not been merged since the pin (${mergeBase.slice(0, 8)}), and the app ` +
				`baseline grew on this branch: ${previous.bytes} → ${measured} bytes ` +
				`(+${
					measured - previous.bytes
				}). Landing commits may not grow it: trim the growth instead.`,
		};
	}
	return { ok: true, pin: parseBaselinePin({ bytes: measured, measuredAt, mainSha: mergeBase }) };
}
// #endregion

// #region Island lists
/** Who an island renders for. */
export type Audience = "everyone" | "signed-in";

/**
 * Where an island mounts: `_app.tsx`, the public layout's landing branch, `LandingShell` itself, the
 * page, or the `PublicFooter` that `LandingShell` renders.
 */
export type Mount = "app" | "layout" | "shell" | "page" | "footer";

/**
 * What a budget line counts a chunk toward: the app baseline (capped against growth), the landing's
 * own JS (the 60 kB), a layout host or the footer (both reported).
 */
export type BudgetGroup = "baseline" | "landing" | "layout" | "footer";

/** The group each mount's islands (and the client entry) count toward. */
export const MOUNT_GROUPS: Readonly<Record<Mount | "entry", BudgetGroup>> = {
	entry: "baseline",
	app: "baseline",
	layout: "layout",
	shell: "landing",
	page: "landing",
	footer: "footer",
};

/** One island a landing page renders. */
export interface BudgetIsland {
	/** The module, repository-relative. */
	path: string;
	/** `"signed-in"` when it renders only for a signed-in visitor. */
	audience: Audience;
	/** A cap on its own weight in gzip bytes: its closure minus the client entry's (see {@link planPage}). */
	ownMax?: number;
}

/** The islands of one mount. */
export interface MountedIslands {
	mount: Mount;
	islands: readonly BudgetIsland[];
}

/** One landing page and the islands its controller renders. */
export interface BudgetPage {
	/** The URL path. */
	path: string;
	/** The page controller (`features/landing/routes/*.tsx`), repository-relative. */
	controller: string;
	/** The islands the controller's render meets. */
	islands: readonly BudgetIsland[];
}

/** The modules each shared list is checked against (`island-graph.test.ts`). */
export const ISLAND_SOURCES = {
	app: "apps/web/routes/_app.tsx",
	layout: "apps/web/routes/(public)/_layout.tsx",
	shell: "apps/web/features/landing/components/LandingShell.tsx",
	footer: "apps/web/features/marketing/components/PublicFooter.tsx",
} as const;

/** The islands `_app.tsx` renders on every page (the developer tools are stripped in production). */
export const APP_ISLANDS: readonly BudgetIsland[] = [
	{ path: "apps/web/features/theme/islands/DesignSystemRoot.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/shell/islands/CurrencyBridge.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/shell/islands/ServiceWorkerBridge.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/shell/islands/ImageFallbackBridge.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/shell/islands/OfflineBridge.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/shell/islands/WebVitalsBridge.island.tsx", audience: "everyone" },
	{
		path: "apps/web/features/explore/islands/ExploreHistoryTracker.island.tsx",
		audience: "everyone",
	},
];

/**
 * The islands the `(public)/_layout.tsx` landing branch mounts beside `LandingShell`. No ticket host
 * (the landing routes strip `?tkv=` with a 303, `strip-tkv.ts`), and the chat host's lazy stand-in
 * for a signed-in visitor: the real `ChatPopoutHost` is a lazy chunk behind it (Decision #286 (A)).
 */
export const LANDING_LAYOUT_ISLANDS: readonly BudgetIsland[] = [
	{ path: "apps/web/features/landing/islands/LazyChatHost.island.tsx", audience: "signed-in" },
];

/** The islands `LandingShell` renders itself: the header bar. */
export const LANDING_SHELL_ISLANDS: readonly BudgetIsland[] = [
	{ path: "apps/web/features/landing/islands/LandingHeader.island.tsx", audience: "everyone" },
];

/** The islands of the `PublicFooter` that `LandingShell` renders after `.lp-root`. */
export const LANDING_FOOTER_ISLANDS: readonly BudgetIsland[] = [
	{ path: "apps/web/features/marketing/islands/FooterLinkGroups.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/marketing/islands/NewsletterForm.island.tsx", audience: "everyone" },
	{ path: "apps/web/features/marketing/islands/RecentlyViewed.island.tsx", audience: "everyone" },
];

/** Every landing page with its controller's islands. */
export const LANDING_PAGES: readonly BudgetPage[] = [
	{
		path: "/",
		controller: "apps/web/features/landing/routes/LandingPage.tsx",
		islands: [
			{
				path: "apps/web/features/landing/islands/LandingBackground.island.tsx",
				audience: "everyone",
			},
			{
				path: "apps/web/features/marketing/islands/SchemaInjector.island.tsx",
				audience: "everyone",
			},
			{
				path: "apps/web/features/landing/islands/HeroSearch.island.tsx",
				audience: "everyone",
				ownMax: LANDING_JS_BUDGET.heroIsland,
			},
			{
				// The theatre's toggle and timeline wiring; its player is a lazy chunk (L2 target 12 kB).
				path: "apps/web/features/landing/islands/HeroTheatre.island.tsx",
				audience: "everyone",
				ownMax: 12 * KB,
			},
			{
				// How it works: the reading-line observer behind the sticky money flow (L3 target 8 kB).
				path: "apps/web/features/landing/islands/MoneyFlow.island.tsx",
				audience: "everyone",
				ownMax: 8 * KB,
			},
			{
				// The demo stage's tabs, URL state and live region (L3 target 8 kB). Each demo
				// (`components/demos/*.demo.tsx`) is a lazy chunk it imports for the open tab only,
				// capped at LANDING_JS_BUDGET.lazyChunk like every landing-owned lazy chunk.
				path: "apps/web/features/landing/islands/DemoHost.island.tsx",
				audience: "everyone",
				ownMax: 8 * KB,
			},
			{
				// Pricing's calculator (L4 target 6 kB). Mounted with or without a fee: it carries the
				// Pricing and "The numbers so far" stylesheets.
				path: "apps/web/features/landing/islands/PricingCalculator.island.tsx",
				audience: "everyone",
				ownMax: 6 * KB,
			},
			{
				// Ways to work's rails: their scroll buttons and end fades. Mounted with or without
				// rails: it carries the section's stylesheet.
				path: "apps/web/features/landing/islands/RailScroll.island.tsx",
				audience: "everyone",
				ownMax: 4 * KB,
			},
			{
				// `@projective/ui`'s MoneyView: its island module default-exports the same function
				// How it works and the demo posters render, and Fresh registers an island by that
				// identity, so every figure they print hydrates as one (`islandBindingsOf`).
				path: "packages/ui/display/islands/MoneyView.island.tsx",
				audience: "everyone",
			},
		],
	},
];

/** Every island `page` renders, by mount, in mount order: app, layout, shell, page, footer. */
export function pageMounts(page: BudgetPage): MountedIslands[] {
	return [
		{ mount: "app", islands: APP_ISLANDS },
		{ mount: "layout", islands: LANDING_LAYOUT_ISLANDS },
		{ mount: "shell", islands: LANDING_SHELL_ISLANDS },
		{ mount: "page", islands: page.islands },
		{ mount: "footer", islands: LANDING_FOOTER_ISLANDS },
	];
}

/** Every island `page` renders, flattened in mount order. */
export function pageIslands(page: BudgetPage): BudgetIsland[] {
	return pageMounts(page).flatMap((mounted) => mounted.islands);
}
// #endregion

// #region Manifest
/** One entry of Vite's client manifest (`_fresh/client/.vite/manifest.json`). */
export interface ManifestChunk {
	file: string;
	src?: string;
	name?: string;
	isEntry?: boolean;
	isDynamicEntry?: boolean;
	imports?: string[];
	dynamicImports?: string[];
	css?: string[];
}

/** Vite's client manifest: chunks by key (a module path relative to the Vite root, or `_<chunk>`). */
export type ClientManifest = Readonly<Record<string, ManifestChunk>>;

/** The suffix of the key (and `src`) of Fresh's virtual client entry. */
const CLIENT_ENTRY_SUFFIX = "fresh:client-entry";

/**
 * The manifest key of a repository-relative module: Vite keys a module by its path relative to its
 * `root` (`apps/web`, `vite.config.ts`), so a workspace package reads `../../packages/…`.
 */
export function manifestKeyOf(path: string, viteRoot = "apps/web"): string {
	const prefix = `${viteRoot}/`;
	if (path.startsWith(prefix)) return path.slice(prefix.length);
	const depth = viteRoot.split("/").filter(Boolean).length;
	return `${"../".repeat(depth)}${path}`;
}

/**
 * The key of Fresh's client entry.
 *
 * @throws When the manifest has none (not a Fresh client build).
 */
export function clientEntryKey(manifest: ClientManifest): string {
	for (const [key, chunk] of Object.entries(manifest)) {
		if (chunk.isEntry && (chunk.src ?? key).endsWith(CLIENT_ENTRY_SUFFIX)) return key;
	}
	throw new Error(`js-budget: the manifest has no ${CLIENT_ENTRY_SUFFIX} entry`);
}

/** True for a JavaScript chunk (manifest keys also name stylesheets and assets). */
function isJsChunk(chunk: ManifestChunk): boolean {
	return /\.m?js$/.test(chunk.file);
}

/**
 * The static-import closure of `roots`: each JavaScript chunk once, in first-reach order
 * (depth-first, a root before its imports), mapped to the root that reached it first.
 *
 * @throws When a key is missing from the manifest.
 */
export function staticClosure(
	manifest: ClientManifest,
	roots: readonly string[],
): Map<string, string> {
	const reached = new Map<string, string>();
	const visit = (key: string, root: string): void => {
		if (reached.has(key)) return;
		const chunk = manifest[key];
		if (chunk === undefined) throw new Error(`js-budget: "${key}" is not in the manifest`);
		if (!isJsChunk(chunk)) return;
		reached.set(key, root);
		for (const imported of chunk.imports ?? []) visit(imported, root);
	};
	for (const root of roots) visit(root, root);
	return reached;
}
// #endregion

// #region Plan
/** One module the page script imports: the client entry or a rendered island. */
export interface PlanRoot {
	key: string;
	mount: Mount | "entry";
	audience: Audience;
	/** The group its chunks count toward ({@link MOUNT_GROUPS}). */
	group: BudgetGroup;
}

/** Lazily loaded chunks behind one `import()` target, beyond what the page already loaded. */
export interface LazyGroup {
	/** The dynamic entry's key. */
	root: string;
	/** The lazy entry whose chunks import this one, or `null` when an initial chunk does. */
	parent: string | null;
	/** Its closure minus the page's initial chunks. */
	chunks: string[];
	/**
	 * Its gzip cap, or `null` for a chunk the landing does not own. The landing owns it when its
	 * source is under `features/landing/`, or when a landing-owned chunk (initial or lazy) imports it.
	 */
	max: number | null;
}

/** An island's own weight under an {@link BudgetIsland.ownMax} cap. */
export interface OwnWeight {
	/** The island's key. */
	island: string;
	/** Its closure minus the client entry's. */
	chunks: string[];
	max: number;
}

/** What one landing page loads for one audience. */
export interface PagePlan {
	page: string;
	audience: Audience;
	/** The client entry, then each island rendered for the audience, in mount order. */
	roots: PlanRoot[];
	/** Initial chunks, each mapped to the root that reached it first. */
	initial: Map<string, string>;
	/** Lazy groups reachable from the initial chunks, transitively. */
	lazy: LazyGroup[];
	/** Islands with an own-weight cap. */
	owned: OwnWeight[];
}

/** The static closure of the roots of one {@link BudgetGroup}, in first-reach order. */
function groupClosure(
	manifest: ClientManifest,
	roots: readonly PlanRoot[],
	group: BudgetGroup,
): string[] {
	return [
		...staticClosure(
			manifest,
			roots.filter((root) => root.group === group).map((root) => root.key),
		).keys(),
	];
}

/** The landing-owned initial chunks of `roots`: the landing roots' closure minus the baseline's. */
function landingOwnedChunks(manifest: ClientManifest, roots: readonly PlanRoot[]): Set<string> {
	const baseline = new Set(groupClosure(manifest, roots, "baseline"));
	return new Set(groupClosure(manifest, roots, "landing").filter((key) => !baseline.has(key)));
}

/** Raised when a declared island has no manifest entry: the build is stale or the list is wrong. */
export class MissingIslandsError extends Error {
	constructor(readonly keys: readonly string[]) {
		super(`js-budget: islands missing from the client manifest: ${keys.join(", ")}`);
		this.name = "MissingIslandsError";
	}
}

/**
 * What `page` loads for `audience`: the initial closure of the client entry plus every island that
 * renders for that audience, the lazy groups behind it, and the islands with their own cap.
 *
 * @param mounts The page's islands by mount ({@link pageMounts} for a real page).
 * @throws {MissingIslandsError} When a declared island is not in the manifest.
 */
export function planPage(
	manifest: ClientManifest,
	page: string,
	mounts: readonly MountedIslands[],
	audience: Audience,
): PagePlan {
	const entry = clientEntryKey(manifest);
	const rendered = mounts.flatMap(({ mount, islands }) =>
		islands
			.filter((island) => audience === "signed-in" || island.audience === "everyone")
			.map((island) => ({
				island,
				root: {
					key: manifestKeyOf(island.path),
					mount,
					audience: island.audience,
					group: MOUNT_GROUPS[mount],
				},
			}))
	);
	const missing = rendered.map(({ root }) => root.key).filter((key) => manifest[key] === undefined);
	if (missing.length > 0) throw new MissingIslandsError(missing);

	const roots: PlanRoot[] = [
		{ key: entry, mount: "entry", audience: "everyone", group: MOUNT_GROUPS.entry },
		...rendered.map(({ root }) => root),
	];
	const initial = staticClosure(manifest, roots.map((root) => root.key));
	const landing = landingOwnedChunks(manifest, roots);

	const lazy: LazyGroup[] = [];
	const queue: Array<{ key: string; parent: string | null; capped: boolean }> = [
		...initial.keys(),
	].flatMap((key) =>
		(manifest[key].dynamicImports ?? []).map((target) => ({
			key: target,
			parent: null,
			capped: landing.has(key),
		}))
	);
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		const { key, parent, capped } = next;
		if (initial.has(key) || lazy.some((group) => group.root === key)) continue;
		const chunks = [...staticClosure(manifest, [key]).keys()].filter((chunk) =>
			!initial.has(chunk)
		);
		if (chunks.length === 0) continue;
		const owned = capped || key.startsWith(LANDING_KEY_PREFIX);
		const max = owned ? LANDING_JS_BUDGET.lazyChunk : null;
		lazy.push({ root: key, parent, chunks, max });
		for (const chunk of chunks) {
			for (const target of manifest[chunk].dynamicImports ?? []) {
				queue.push({ key: target, parent: key, capped: owned });
			}
		}
	}

	const runtime = staticClosure(manifest, [entry]);
	const owned: OwnWeight[] = rendered.flatMap(({ island, root }) =>
		island.ownMax === undefined ? [] : [{
			island: root.key,
			chunks: [...staticClosure(manifest, [root.key]).keys()].filter((key) => !runtime.has(key)),
			max: island.ownMax,
		}]
	);

	return { page, audience, roots, initial, lazy, owned };
}

/** Every chunk file a set of plans names, for the sizes the report needs. */
export function planFiles(manifest: ClientManifest, plans: readonly PagePlan[]): string[] {
	const files = new Set<string>();
	for (const plan of plans) {
		for (const key of plan.initial.keys()) files.add(manifest[key].file);
		for (const group of plan.lazy) for (const key of group.chunks) files.add(manifest[key].file);
	}
	return [...files].sort();
}
// #endregion

// #region Report
/** A chunk's size on disk and gzipped. */
export interface ChunkSize {
	raw: number;
	gzip: number;
}

/** How a chunk loads on the page. */
export type ChunkLoad = "initial" | "signed-in" | "lazy";

/** One chunk-table row. */
export interface ChunkRow {
	file: string;
	raw: number;
	gzip: number;
	load: ChunkLoad;
	/** The group an initial chunk counts toward ({@link groupChunks}); `null` for a lazy chunk. */
	group: BudgetGroup | null;
	/** The root (island, client entry or lazy entry) that pulled the chunk in. */
	via: string;
}

/** What one root (the client entry or an island) costs the page, gzip bytes. */
export interface RootWeight {
	label: string;
	mount: Mount | "entry";
	audience: Audience;
	group: BudgetGroup;
	/** The chunks it reached first, in mount order (its share of the total). */
	added: number;
	/** The chunks no other root reaches (what dropping it would save). */
	exclusive: number;
}

/** One budget line. */
export interface Verdict {
	label: string;
	gzip: number;
	/** `null` for a figure that is reported but not capped. */
	max: number | null;
	ok: boolean;
	/**
	 * Why a line over its cap still passes: set only on the app baseline once main has moved since
	 * its pin ({@link baselineRule}), and only when it is over.
	 */
	waived?: string;
}

/** The app baseline's budget line. */
export const BASELINE_LABEL = "app baseline (client entry + _app islands)";

/** {@link Verdict.waived} for the app baseline after a main merge the pin predates. */
export const BASELINE_WAIVED = "main moved, re-pin";

/** One page's rows, root weights and verdicts. */
export interface PageReport {
	page: string;
	rows: ChunkRow[];
	roots: RootWeight[];
	verdicts: Verdict[];
	ok: boolean;
}

/** A root's short name: the module's file name, or `client-entry`. */
export function rootLabel(manifest: ClientManifest, key: string): string {
	if (key.endsWith(CLIENT_ENTRY_SUFFIX)) return "client-entry";
	const source = manifest[key]?.src ?? key;
	return source.slice(source.lastIndexOf("/") + 1);
}

/** The lazy groups behind `root`, transitively. */
function lazyBehind(groups: readonly LazyGroup[], root: string): number {
	const children = groups.filter((group) => group.parent === root);
	return children.reduce((count, child) => count + 1 + lazyBehind(groups, child.root), 0);
}

/** The groups in report order; a chunk a layout host and the footer share is labelled `layout`. */
const GROUP_ORDER: readonly BudgetGroup[] = ["baseline", "landing", "layout", "footer"];

/** A plan's initial chunks by {@link BudgetGroup}. */
export type GroupedChunks = Readonly<Record<BudgetGroup, ReadonlySet<string>>>;

/**
 * Splits a plan's initial chunks by {@link BudgetGroup}. The baseline is the static closure of the
 * client entry and the `_app.tsx` islands; landing-owned is the closure of the landing islands minus
 * the baseline, so a chunk a landing island shares with a footer island or a layout host counts
 * here; a layout host's and the footer's are each their closure minus both (a chunk those two share
 * appears in each).
 *
 * @param plan A plan whose roots carry every island (the signed-in plan, for a real page).
 */
export function groupChunks(manifest: ClientManifest, plan: PagePlan): GroupedChunks {
	const baseline = new Set(groupClosure(manifest, plan.roots, "baseline"));
	const landing = landingOwnedChunks(manifest, plan.roots);
	const beyond = (group: BudgetGroup): Set<string> =>
		new Set(
			groupClosure(manifest, plan.roots, group).filter((key) =>
				!baseline.has(key) && !landing.has(key)
			),
		);
	return { baseline, landing, layout: beyond("layout"), footer: beyond("footer") };
}

/**
 * The report for one page from its plan for everyone and for a signed-in visitor (Decision #286 (A)).
 *
 * Failing lines: the app baseline against its pin (while {@link BaselineRule.held}; over it after a
 * main merge the pin predates, it passes {@link Verdict.waived}), the landing-owned initial JS
 * against the 60 kB (every landing island counted, whoever it renders for), each island's
 * own-weight cap and each lazy chunk the landing owns. Reported lines: what the layout hosts and the
 * footer add beyond those two groups, the page totals for both audiences, and each lazy group the
 * landing does not own (once, counting the lazy groups behind it; the signed-in visitor's own lazy
 * groups apart).
 *
 * The chunk table runs initial, then signed-in only, then the chunks of capped lazy groups, each by
 * gzip size descending.
 *
 * @param sizes Each chunk file's raw and gzip size.
 * @param baseline How the app baseline is judged; the committed pin, held, by default.
 * @throws When a chunk file has no size.
 */
export function reportPage(
	manifest: ClientManifest,
	everyone: PagePlan,
	signedIn: PagePlan,
	sizes: ReadonlyMap<string, ChunkSize>,
	baseline: BaselineRule = { max: APP_BASELINE_PIN.bytes, held: true },
): PageReport {
	const sizeOf = (key: string): ChunkSize => {
		const size = sizes.get(manifest[key].file);
		if (size === undefined) throw new Error(`js-budget: no size for ${manifest[key].file}`);
		return size;
	};
	const sum = (keys: Iterable<string>): number => {
		let total = 0;
		for (const key of keys) total += sizeOf(key).gzip;
		return total;
	};

	const grouped = groupChunks(manifest, signedIn);
	const groupOf = (key: string): BudgetGroup => {
		const group = GROUP_ORDER.find((name) => grouped[name].has(key));
		if (group === undefined) throw new Error(`js-budget: "${key}" is in no budget group`);
		return group;
	};
	const row = (key: string, load: ChunkLoad, via: string): ChunkRow => ({
		file: manifest[key].file,
		...sizeOf(key),
		load,
		group: load === "lazy" ? null : groupOf(key),
		via: rootLabel(manifest, via),
	});
	const byGzip = (a: ChunkRow, b: ChunkRow) => b.gzip - a.gzip || a.file.localeCompare(b.file);

	const signedInOnly = [...signedIn.initial].filter(([key]) => !everyone.initial.has(key));
	const signedInLazy = signedIn.lazy.filter((group) =>
		!everyone.lazy.some((other) => other.root === group.root)
	);
	const capped = [...everyone.lazy, ...signedInLazy].filter((group) => group.max !== null);
	const rows = [
		...[...everyone.initial].map(([key, via]) => row(key, "initial", via)).sort(byGzip),
		...signedInOnly.map(([key, via]) => row(key, "signed-in", via)).sort(byGzip),
		...capped.flatMap((group) => group.chunks.map((key) => row(key, "lazy", group.root))).sort(
			byGzip,
		),
	];

	const exclusiveOf = (plan: PagePlan, key: string): number => {
		const others = staticClosure(
			manifest,
			plan.roots.map((root) => root.key).filter((other) => other !== key),
		);
		return sum([...plan.initial.keys()].filter((chunk) => !others.has(chunk)));
	};
	const roots: RootWeight[] = signedIn.roots.map((root) => {
		const plan = root.audience === "everyone" ? everyone : signedIn;
		const reached = root.audience === "everyone"
			? [...everyone.initial].filter(([, via]) => via === root.key)
			: signedInOnly.filter(([, via]) => via === root.key);
		return {
			label: rootLabel(manifest, root.key),
			mount: root.mount,
			audience: root.audience,
			group: root.group,
			added: sum(reached.map(([key]) => key)),
			exclusive: exclusiveOf(plan, root.key),
		};
	});

	const verdict = (label: string, gzip: number, max: number | null): Verdict => ({
		label,
		gzip,
		max,
		ok: max === null || gzip <= max,
	});
	const reportedLazy = (plan: PagePlan, groups: readonly LazyGroup[], prefix: string) =>
		groups
			.filter((group) => group.max === null && group.parent === null)
			.map((group) => {
				const behind = lazyBehind(plan.lazy, group.root);
				const more = behind === 0 ? "" : ` (+${behind} lazy behind it)`;
				const label = `${prefix}${rootLabel(manifest, group.root)}${more}`;
				return verdict(label, sum(group.chunks), null);
			});
	const baselineVerdict = (gzip: number): Verdict => {
		const line = verdict(BASELINE_LABEL, gzip, baseline.max);
		return line.ok || baseline.held ? line : { ...line, ok: true, waived: BASELINE_WAIVED };
	};
	const verdicts: Verdict[] = [
		baselineVerdict(sum(grouped.baseline)),
		verdict(
			"landing-owned (landing islands beyond the baseline)",
			sum(grouped.landing),
			LANDING_JS_BUDGET.landingOwned,
		),
		...signedIn.owned.map((own) =>
			verdict(`own weight, ${rootLabel(manifest, own.island)}`, sum(own.chunks), own.max)
		),
		...capped.map((group) =>
			verdict(`lazy, ${rootLabel(manifest, group.root)}`, sum(group.chunks), group.max)
		),
		verdict("layout hosts beyond the two above, signed in", sum(grouped.layout), null),
		verdict("footer islands beyond the two above", sum(grouped.footer), null),
		verdict("page total, everyone", sum(everyone.initial.keys()), null),
		verdict("page total, signed in", sum(signedIn.initial.keys()), null),
		...reportedLazy(everyone, everyone.lazy, "lazy, "),
		...reportedLazy(signedIn, signedInLazy, "lazy, signed in, "),
	];

	return {
		page: everyone.page,
		rows,
		roots,
		verdicts,
		ok: verdicts.every((line) => line.ok),
	};
}

/** Bytes as `12.3 kB`. */
export function formatKb(bytes: number): string {
	return `${(bytes / KB).toFixed(1)} kB`;
}

/** A plain-text table with a header row; the numeric columns (by index) are right-aligned. */
function table(head: string[], body: string[][], numeric: ReadonlySet<number>): string {
	const widths = head.map((cell, column) =>
		Math.max(cell.length, ...body.map((cells) => cells[column].length))
	);
	const line = (cells: string[]) =>
		cells.map((cell, column) =>
			numeric.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])
		).join("  ").trimEnd();
	return [line(head), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join("\n");
}

/** One page's report as text: the chunk table, the weight of each root, then the budget lines. */
export function formatPageReport(report: PageReport): string {
	const chunks = table(
		["chunk", "raw", "gzip", "load", "counts toward", "via"],
		report.rows.map((row) => [
			row.file,
			formatKb(row.raw),
			formatKb(row.gzip),
			row.load,
			row.group ?? "-",
			row.via,
		]),
		new Set([1, 2]),
	);
	const roots = table(
		["island", "mount", "counts toward", "renders for", "added", "exclusive"],
		report.roots.map((root) => [
			root.label,
			root.mount,
			root.group,
			root.audience,
			formatKb(root.added),
			formatKb(root.exclusive),
		]),
		new Set([4, 5]),
	);
	const verdicts = table(
		["budget", "gzip", "max", "result"],
		report.verdicts.map((line) => [
			line.label,
			formatKb(line.gzip),
			line.max === null ? "-" : formatKb(line.max),
			line.max === null ? "reported" : line.waived ?? (line.ok ? "ok" : "OVER"),
		]),
		new Set([1, 2]),
	);
	return [
		`${report.page}`,
		chunks,
		"Weight by island (added: chunks it reached first, in mount order; exclusive: chunks only it reaches)",
		roots,
		verdicts,
	].join("\n\n");
}
// #endregion
