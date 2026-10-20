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
 * The client entry is gzipped with the build id Fresh embeds in it (the commit that was built)
 * replaced by a fixed stand-in (`BUILD_ID_STANDIN`, Decision #302 (E)), so a reading never moves with
 * the commit's hash.
 *
 * The lines follow Decision #286 (A): the landing-owned initial JS fails past 60 kB, the hero's own
 * weight and each landing lazy chunk keep their caps; the layout hosts, the footer and the page
 * totals for a guest and a signed-in visitor are reported and never fail. The app baseline (client
 * entry + `_app.tsx` islands) follows Decision #289 ("Re-pin on each main merge"): it is held to the
 * committed pin (`core/js-budget-baseline.json`) while `git merge-base HEAD main` still equals the
 * pin's `mainSha`; once main has been merged since, main's growth is reported, never failing, until
 * `--repin` writes main's measured size as the new pin (see {@link USAGE}).
 *
 * It warns when a landing source or a declared island changed after the build, and refuses a build
 * that lacks a declared island.
 *
 * Exit codes: 0 within budget (or re-pinned) · 1 over budget, or a re-pin refused because the
 * branch grew the baseline · 2 no usable build (none yet, a declared island missing from it, or for
 * `--repin` a build older than HEAD, the baseline's sources or any watched landing source), a
 * working tree with uncommitted changes under the built paths on `--repin` (the pin must measure a
 * committed tree: a lazy landing chunk can move bytes into the shared baseline chunks), an
 * unresolvable merge base on `--repin`, or a bad argument.
 */
import {
	APP_BASELINE_PIN,
	APP_ISLANDS,
	BASELINE_LABEL,
	BASELINE_PIN_PATH,
	type BaselinePin,
	baselineRule,
	type ChunkSize,
	clientEntryKey,
	type ClientManifest,
	formatKb,
	formatPageReport,
	LANDING_PAGES,
	MissingIslandsError,
	normalizeBuildId,
	pageIslands,
	pageMounts,
	type PagePlan,
	planFiles,
	planPage,
	repinBaseline,
	reportPage,
} from "@features/landing/core/js-budget.ts";

// #region Paths a re-pin needs committed
/** What the build reads: a re-pin refuses while any of it has uncommitted changes. */
const CLEAN_PATHS = ["apps", "packages", "vite.config.ts", "deno.json", "deno.lock"] as const;
// #endregion

// #region Usage
/** `--help`: the options and the re-pin procedure (`flows/LANDING.md` §7, Decision #289). */
const USAGE = `Usage: deno task budget:landing [--repin | --help]   (after \`deno task build\`)

Measures the landing pages' JavaScript on the production build and exits 1 over budget.

  --repin   Re-pin the app baseline (client entry + _app islands) at its measured size, then
            report as usual. Writes ${BASELINE_PIN_PATH}
            ({ bytes, measuredAt, mainSha }, mainSha = git merge-base HEAD main).
  --help    Print this text.

The app baseline (Decision #289, "Re-pin on each main merge"):
  - Held: while git merge-base HEAD main equals the pin's mainSha (no main merge since the pin),
    one byte over the pin fails. Landing commits may not grow it.
  - Main moved: after main is merged into the branch, the merge base changes; the baseline is then
    reported against the pin and never fails ("main moved, re-pin"). Main's growth is main's.
  - Re-pin after every main merge, in the merge itself or the commit right after it:
        deno task build && deno task budget:landing --repin
    then commit ${BASELINE_PIN_PATH}.
    --repin refuses (exit 1) when main has not been merged since the pin and the baseline grew,
    and (exit 2) when the working tree has uncommitted changes under any of
        ${CLEAN_PATHS.join(" ")}
    (re-pin a committed tree only: landing code shares chunks with the baseline, so uncommitted
    work would be pinned as main's), when the build is older than HEAD, the baseline's sources or
    any landing source, or when the merge base cannot be resolved. A smaller baseline lowers the
    pin at any time.
  - If git cannot resolve the merge base, the pin is held.
`;
// #endregion

// #region Paths
const ROOT = new URL("../", import.meta.url);
const CLIENT_DIR = new URL("apps/web/_fresh/client/", ROOT);
const MANIFEST = new URL(".vite/manifest.json", CLIENT_DIR);
const PIN_FILE = new URL(BASELINE_PIN_PATH, ROOT);
/** The client entry's source; with the `_app` islands, what the baseline is built from. */
const CLIENT_SOURCE = "apps/web/client.ts";
/** Sources whose edits a build must postdate (besides every declared island). */
const WATCHED_DIR = new URL("apps/web/features/landing/", ROOT);
/**
 * Files under {@link WATCHED_DIR} no build reads: tests, the budget's modules and pin, the contrast
 * audit.
 */
const NOT_BUILT =
	/(\.test\.tsx?|\/core\/(?:js-budget|island-graph|lp-contrast)\.ts|\/core\/js-budget-baseline\.json)$/;
/** The pin file's `$comment`, written with every re-pin. */
const PIN_COMMENT =
	"The app baseline's pin (client entry + _app islands, gzip bytes), Decision #289. " +
	"Written by `deno task build && deno task budget:landing --repin` after each merge of main into " +
	"the landing branch; never edited by hand. See flows/LANDING.md §7.";
/** The branch the baseline is pinned against, then its remote-tracking fallback. */
const MAIN_REFS = ["main", "origin/main"] as const;
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

/** `git <args>`'s trimmed output in the repository, or `null` when git fails or is missing. */
async function git(...args: string[]): Promise<string | null> {
	try {
		const out = await new Deno.Command("git", { args, cwd: ROOT, stdout: "piped", stderr: "null" })
			.output();
		return out.success ? new TextDecoder().decode(out.stdout).trim() : null;
	} catch {
		return null;
	}
}

/** `git merge-base HEAD main` (else against `origin/main`), or `null` when neither resolves. */
async function mainMergeBase(): Promise<string | null> {
	for (const ref of MAIN_REFS) {
		const sha = await git("merge-base", "HEAD", ref);
		if (sha !== null && /^[0-9a-f]{40}$/.test(sha)) return sha;
	}
	return null;
}

/** A commit id's short form, for messages. */
function short(sha: string): string {
	return sha.slice(0, 8);
}
// #endregion

// #region Arguments
const args = new Set(Deno.args);
if (args.has("--help") || args.has("-h")) {
	console.log(USAGE);
	Deno.exit(0);
}
const repin = args.delete("--repin");
if (args.size > 0) {
	console.error(`Unknown argument ${[...args].join(", ")}.\n\n${USAGE}`);
	Deno.exit(2);
}
// #endregion

// #region Measure
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

// The client entry is gzipped with its embedded build id replaced by a fixed stand-in, so the
// held baseline is measured on the code alone, never on the hash of the commit that was built.
const entryFile = manifest[clientEntryKey(manifest)].file;
const sizes = new Map<string, ChunkSize>();
for (const file of planFiles(manifest, plans.flatMap((plan) => [plan.everyone, plan.signedIn]))) {
	const bytes = await Deno.readFile(new URL(file, CLIENT_DIR));
	const measured = file === entryFile
		? new TextEncoder().encode(normalizeBuildId(new TextDecoder().decode(bytes)))
		: bytes;
	sizes.set(file, { raw: bytes.byteLength, gzip: await gzipSize(measured) });
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
// #endregion

// #region Baseline pin
const mergeBase = await mainMergeBase();
let pin: BaselinePin = APP_BASELINE_PIN;

if (repin) {
	const baselineSources = await Promise.all(
		[CLIENT_SOURCE, ...APP_ISLANDS.map((island) => island.path)].map((path) =>
			mtimeOf(new URL(path, ROOT))
		),
	);
	const staleBaseline = baselineSources.flatMap((found) =>
		found !== null && found.mtime > builtAt ? [relative(found.path)] : []
	);
	const head = await git("log", "-1", "--format=%H %ct", "HEAD");
	const [headSha, headSeconds] = head?.split(" ") ?? [];
	if (mergeBase === null || headSha === undefined) {
		console.error(
			`Cannot re-pin: git merge-base HEAD ${MAIN_REFS.join(" / ")} does not resolve. ` +
				"Re-pin in a checkout with main.",
		);
		Deno.exit(2);
	}
	const dirty = await git("status", "--porcelain", "--", ...CLEAN_PATHS);
	if (dirty === null || dirty !== "") {
		const paths = (dirty ?? "").split("\n").filter((line) => line.trim() !== "");
		console.error(
			`Cannot re-pin: ${
				dirty === null
					? "git status did not run"
					: `${paths.length} uncommitted change(s) under ${CLEAN_PATHS.join(", ")}`
			}${
				paths.length > 0
					? ` (${paths.slice(0, 5).map((line) => line.trim()).join("; ")}${
						paths.length > 5 ? "; …" : ""
					})`
					: ""
			}. ` +
				"Re-pin a committed tree: commit or set the work aside, then " +
				"`deno task build && deno task budget:landing --repin`.",
		);
		Deno.exit(2);
	}
	const behindSources = [...new Set([...staleBaseline, ...stale])];
	if (Number(headSeconds) * 1000 > builtAt || behindSources.length > 0) {
		const behind = behindSources.length > 0
			? behindSources.join(", ")
			: `HEAD (${short(headSha)}, committed ${new Date(Number(headSeconds) * 1000).toISOString()})`;
		console.error(
			`Cannot re-pin: the build is older than ${behind}. ` +
				"Run `deno task build && deno task budget:landing --repin`.",
		);
		Deno.exit(2);
	}
	const measured = Math.max(
		...plans.map(({ everyone, signedIn }) =>
			reportPage(manifest, everyone, signedIn, sizes).verdicts.find((line) =>
				line.label === BASELINE_LABEL
			)?.gzip ?? 0
		),
	);
	const result = repinBaseline(
		APP_BASELINE_PIN,
		measured,
		mergeBase,
		new Date(builtAt).toISOString(),
	);
	if (!result.ok) {
		console.error(`Re-pin refused: ${result.reason}`);
		Deno.exit(1);
	}
	pin = result.pin;
	await Deno.writeTextFile(
		PIN_FILE,
		`${JSON.stringify({ $comment: PIN_COMMENT, ...pin }, null, "\t")}\n`,
	);
	console.log(
		`Re-pinned the app baseline at ${pin.bytes} bytes (${formatKb(pin.bytes)}), main ` +
			`${short(pin.mainSha)}; was ${APP_BASELINE_PIN.bytes} bytes at main ` +
			`${short(APP_BASELINE_PIN.mainSha)}. Commit ${BASELINE_PIN_PATH}.\n`,
	);
}

const rule = baselineRule(pin, repin ? pin.mainSha : mergeBase);
// #endregion

// #region Report
const reports = plans.map(({ everyone, signedIn }) =>
	reportPage(manifest, everyone, signedIn, sizes, rule)
);
console.log(reports.map(formatPageReport).join("\n\n"));

const pinLine = `the pin, ${pin.bytes} bytes measured ${pin.measuredAt} at main ${
	short(pin.mainSha)
}`;
if (mergeBase === null) {
	console.warn(
		`\nThe app baseline is held to ${pinLine}: git merge-base HEAD main does not resolve here.`,
	);
} else if (!rule.held) {
	console.warn(
		`\nmain moved since the pin; run --repin. The merge base is now ${short(mergeBase)}, so the ` +
			`app baseline is reported against ${pinLine}, never failing: ` +
			"`deno task build && deno task budget:landing --repin`, then commit the pin.",
	);
} else {
	console.log(`\nThe app baseline is held to ${pinLine} (no main merge since).`);
}

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
