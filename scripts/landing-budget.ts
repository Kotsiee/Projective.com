/**
 * `deno task budget:landing` — the landing pages' JavaScript budget (`flows/LANDING.md` §7) measured
 * on a production build: run `deno task build` first (`deno task build && deno task budget:landing`).
 *
 * Reads Vite's client manifest (`apps/web/_fresh/client/.vite/manifest.json`, which the client build
 * writes and `vite.config.ts` `flattenManifestCss` rewrites), works out each landing page's initial
 * JS and its lazy chunks from the declared island lists (`@features/landing/core/js-budget.ts`),
 * gzips every chunk with `CompressionStream`, and prints one report per page: the chunk table, the
 * weight of each island, and the budget lines. No server is started. Development builds are
 * meaningless here: the dev server serves modules unbundled.
 *
 * It warns when a landing source or a declared island changed after the build, and refuses a build
 * that lacks a declared island.
 *
 * Exit codes: 0 within budget · 1 over budget · 2 no usable build (none yet, or a declared island is
 * missing from it).
 */
import {
	type ChunkSize,
	type ClientManifest,
	formatPageReport,
	LANDING_PAGES,
	MissingIslandsError,
	pageIslands,
	pageMounts,
	type PagePlan,
	planFiles,
	planPage,
	reportPage,
} from "@features/landing/core/js-budget.ts";

// #region Paths
const ROOT = new URL("../", import.meta.url);
const CLIENT_DIR = new URL("apps/web/_fresh/client/", ROOT);
const MANIFEST = new URL(".vite/manifest.json", CLIENT_DIR);
/** Sources whose edits a build must postdate (besides every declared island). */
const WATCHED_DIR = new URL("apps/web/features/landing/", ROOT);
/** Files under {@link WATCHED_DIR} no build reads: tests, the budget's modules, the contrast audit. */
const NOT_BUILT = /(\.test\.tsx?|\/core\/(?:js-budget|island-graph|lp-contrast)\.ts)$/;
// #endregion

// #region Helpers
/** The gzip size of `bytes` (CompressionStream's default level). */
async function gzipSize(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
	return (await new Response(stream).arrayBuffer()).byteLength;
}

/** A file's modification time, or `null` when it cannot be read. */
async function mtimeOf(url: URL): Promise<{ path: string; mtime: number } | null> {
	try {
		const mtime = (await Deno.stat(url)).mtime?.getTime();
		return mtime === undefined ? null : { path: decodeURIComponent(url.pathname), mtime };
	} catch {
		return null;
	}
}

/** The newest modification time of a build input under `dir` (recursive), with its file. */
async function newestUnder(dir: URL): Promise<{ path: string; mtime: number } | null> {
	let newest: { path: string; mtime: number } | null = null;
	for await (const entry of Deno.readDir(dir)) {
		const url = new URL(entry.isDirectory ? `${entry.name}/` : entry.name, dir);
		if (!entry.isDirectory && NOT_BUILT.test(url.pathname)) continue;
		const found = entry.isDirectory ? await newestUnder(url) : await mtimeOf(url);
		if (found !== null && (newest === null || found.mtime > newest.mtime)) newest = found;
	}
	return newest;
}

/** Repository-relative form of a file URL path, for messages. */
function relative(path: string): string {
	const root = decodeURIComponent(ROOT.pathname);
	return path.startsWith(root) ? path.slice(root.length) : path;
}
// #endregion

// #region Main
if (Deno.args.length > 0) {
	console.error("Usage: deno task budget:landing (after `deno task build`)");
	Deno.exit(2);
}

let manifest: ClientManifest;
let builtAt: number;
try {
	manifest = JSON.parse(await Deno.readTextFile(MANIFEST)) as ClientManifest;
	builtAt = (await Deno.stat(MANIFEST)).mtime?.getTime() ?? 0;
} catch (error) {
	if (!(error instanceof Deno.errors.NotFound)) throw error;
	console.error(
		`No production build at ${relative(decodeURIComponent(MANIFEST.pathname))}.\n` +
			"Run `deno task build` first.",
	);
	Deno.exit(2);
}

const plans: Array<{ everyone: PagePlan; signedIn: PagePlan }> = [];
try {
	for (const page of LANDING_PAGES) {
		const mounts = pageMounts(page);
		plans.push({
			everyone: planPage(manifest, page.path, mounts, "everyone"),
			signedIn: planPage(manifest, page.path, mounts, "signed-in"),
		});
	}
} catch (error) {
	if (!(error instanceof MissingIslandsError)) throw error;
	console.error(
		`${error.message}\nThe build predates these islands (rebuild), or the lists in ` +
			"apps/web/features/landing/core/js-budget.ts name a module that is no island.",
	);
	Deno.exit(2);
}

const sizes = new Map<string, ChunkSize>();
for (const file of planFiles(manifest, plans.flatMap((plan) => [plan.everyone, plan.signedIn]))) {
	const bytes = await Deno.readFile(new URL(file, CLIENT_DIR));
	sizes.set(file, { raw: bytes.byteLength, gzip: await gzipSize(bytes) });
}

const watched = [
	await newestUnder(WATCHED_DIR),
	...await Promise.all(
		LANDING_PAGES.flatMap(pageIslands).map((island) => mtimeOf(new URL(island.path, ROOT))),
	),
];
const stale = watched.flatMap((found) =>
	found !== null && found.mtime > builtAt ? [relative(found.path)] : []
);

console.log(
	`Landing JS budget · production build of ${new Date(builtAt).toISOString()} · ` +
		"sizes in kB (1,000 bytes), gzip at CompressionStream's default level\n",
);
if (stale.length > 0) {
	console.warn(
		`Warning: the build is older than ${[...new Set(stale)].join(", ")}. ` +
			"Rebuild for current numbers.\n",
	);
}

const reports = plans.map(({ everyone, signedIn }) =>
	reportPage(manifest, everyone, signedIn, sizes)
);
console.log(reports.map(formatPageReport).join("\n\n"));

const over = reports.flatMap((report) =>
	report.verdicts.filter((verdict) => !verdict.ok).map((verdict) =>
		`${report.page} ${verdict.label}`
	)
);
if (over.length > 0) {
	console.error(`\nOver budget: ${over.join("; ")}.`);
	Deno.exit(1);
}
console.log("\nWithin budget.");
// #endregion
