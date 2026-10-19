/**
 * js-budget.test — the manifest walk behind `deno task budget:landing`, over a fixture manifest:
 * client-entry lookup, static closures counted once, lazy groups beyond the initial chunks, the
 * per-audience island filter, the budget groups of Decision #286 (A) (the baseline's pin, held
 * until main moves and re-pinned after each main merge as Decision #289 rules, the landing-owned
 * 60 kB, the reported layout hosts, footer and totals), own-weight caps, the weight of each island
 * and the verdicts.
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
	APP_BASELINE_PIN,
	BASELINE_LABEL,
	BASELINE_PIN_PATH,
	BASELINE_WAIVED,
	type BaselinePin,
	baselineRule,
	type ChunkSize,
	clientEntryKey,
	type ClientManifest,
	formatKb,
	formatPageReport,
	groupChunks,
	KB,
	LANDING_JS_BUDGET,
	manifestKeyOf,
	MissingIslandsError,
	MOUNT_GROUPS,
	type MountedIslands,
	parseBaselinePin,
	planFiles,
	planPage,
	repinBaseline,
	reportPage,
	staticClosure,
	type Verdict,
} from "./js-budget.ts";

// #region Fixture
const ENTRY = "../../fresh:client-entry";
const HEADER = "features/site/islands/Header.island.tsx";
const BACKGROUND = "features/landing/islands/Background.island.tsx";
const CHAT = "features/chat/islands/Chat.island.tsx";
const TOAST = "../../packages/ui/feedback/islands/Toast.tsx";
const GL = "features/landing/core/gl.ts";
const GL_EXTRA = "features/landing/core/gl-extra.ts";
const EMOJI = "features/chat/core/emoji.ts";
const SOUND = "../../packages/ui/feedback/core/sound.ts";
const CODEC = "../../packages/ui/feedback/core/codec.ts";

/**
 * A client manifest in Vite's shape: shared chunks, a stylesheet key, a landing lazy chunk with
 * another behind it, and an app lazy chunk with another behind it.
 */
const MANIFEST: ClientManifest = {
	[ENTRY]: {
		file: "assets/client-entry.js",
		name: "client-entry",
		src: ENTRY,
		isEntry: true,
		imports: ["_preact.js", "_signals.js"],
		css: ["assets/client-entry.css"],
	},
	"_preact.js": { file: "assets/preact.js" },
	"_signals.js": { file: "assets/signals.js", imports: ["_preact.js"] },
	"_shared.js": { file: "assets/shared.js", imports: ["_preact.js"] },
	"_math.js": { file: "assets/math.js" },
	"_chat-core.js": { file: "assets/chat-core.js" },
	"_header.css": { file: "assets/header.css", src: "_header.css" },
	[HEADER]: {
		file: "assets/header.js",
		src: HEADER,
		isEntry: true,
		imports: ["_preact.js", "_shared.js", "_header.css"],
	},
	[BACKGROUND]: {
		file: "assets/background.js",
		src: BACKGROUND,
		isEntry: true,
		imports: ["_shared.js", "_signals.js"],
		dynamicImports: [GL],
	},
	[GL]: {
		file: "assets/gl.js",
		src: GL,
		isDynamicEntry: true,
		imports: ["_shared.js", "_math.js"],
		dynamicImports: [GL_EXTRA],
	},
	[GL_EXTRA]: {
		file: "assets/gl-extra.js",
		src: GL_EXTRA,
		isDynamicEntry: true,
		imports: ["_math.js"],
	},
	[CHAT]: {
		file: "assets/chat.js",
		src: CHAT,
		isEntry: true,
		imports: ["_shared.js", "_chat-core.js"],
		dynamicImports: [EMOJI],
	},
	[EMOJI]: { file: "assets/emoji.js", src: EMOJI, isDynamicEntry: true },
	[TOAST]: {
		file: "assets/toast.js",
		src: TOAST,
		isEntry: true,
		imports: ["_preact.js"],
		dynamicImports: [SOUND],
	},
	[SOUND]: { file: "assets/sound.js", src: SOUND, isDynamicEntry: true, dynamicImports: [CODEC] },
	[CODEC]: { file: "assets/codec.js", src: CODEC, isDynamicEntry: true },
};

/**
 * The fixture page's islands by mount: Header is the app baseline, Chat a layout host that renders
 * for a signed-in visitor only, Background the landing's own, Toast the footer's.
 */
const MOUNTS: MountedIslands[] = [
	{
		mount: "app",
		islands: [{ path: "apps/web/features/site/islands/Header.island.tsx", audience: "everyone" }],
	},
	{
		mount: "layout",
		islands: [{ path: "apps/web/features/chat/islands/Chat.island.tsx", audience: "signed-in" }],
	},
	{
		mount: "page",
		islands: [{
			path: "apps/web/features/landing/islands/Background.island.tsx",
			audience: "everyone",
			ownMax: 2 * KB,
		}],
	},
	{
		mount: "footer",
		islands: [{ path: "packages/ui/feedback/islands/Toast.tsx", audience: "everyone" }],
	},
];

/** Gzip sizes per file (raw is twice gzip); the gl chunk alone breaks the lazy cap. */
const GZIP: Record<string, number> = {
	"assets/client-entry.js": 10_000,
	"assets/preact.js": 4_000,
	"assets/signals.js": 3_000,
	"assets/header.js": 2_000,
	"assets/shared.js": 1_000,
	"assets/background.js": 500,
	"assets/toast.js": 300,
	"assets/chat.js": 30_000,
	"assets/chat-core.js": 15_000,
	"assets/gl.js": 36_000,
	"assets/math.js": 1_000,
	"assets/gl-extra.js": 2_000,
	"assets/emoji.js": 9_000,
	"assets/sound.js": 50_000,
	"assets/codec.js": 70_000,
};

const SIZES: ReadonlyMap<string, ChunkSize> = new Map(
	Object.entries(GZIP).map(([file, gzip]) => [file, { raw: gzip * 2, gzip }]),
);

const everyonePlan = () => planPage(MANIFEST, "/", MOUNTS, "everyone");
const signedInPlan = () => planPage(MANIFEST, "/", MOUNTS, "signed-in");
const fixtureReport = () => reportPage(MANIFEST, everyonePlan(), signedInPlan(), SIZES);
// #endregion

// #region Manifest walk
Deno.test("manifestKeyOf keys app modules from the Vite root and packages through ../../", () => {
	assertEquals(
		manifestKeyOf("apps/web/features/a/islands/A.island.tsx"),
		"features/a/islands/A.island.tsx",
	);
	assertEquals(manifestKeyOf("packages/ui/feedback/islands/Toast.tsx"), TOAST);
});

Deno.test("clientEntryKey finds Fresh's virtual entry, and refuses a manifest without one", () => {
	assertEquals(clientEntryKey(MANIFEST), ENTRY);
	assertThrows(() => clientEntryKey({ [HEADER]: MANIFEST[HEADER] }), Error, "fresh:client-entry");
});

Deno.test("staticClosure counts a shared chunk once, credits the first root, skips stylesheets", () => {
	const closure = staticClosure(MANIFEST, [ENTRY, HEADER, BACKGROUND]);
	assertEquals([...closure], [
		[ENTRY, ENTRY],
		["_preact.js", ENTRY],
		["_signals.js", ENTRY],
		[HEADER, HEADER],
		["_shared.js", HEADER],
		[BACKGROUND, BACKGROUND],
	]);
});

Deno.test("staticClosure names a key the manifest lacks", () => {
	assertThrows(() => staticClosure(MANIFEST, ["_gone.js"]), Error, "_gone.js");
});
// #endregion

// #region Plan
Deno.test("planPage for everyone leaves signed-in islands out and groups lazy chunks beyond the initial set", () => {
	const plan = everyonePlan();
	assertEquals(plan.roots.map((root) => [root.key, root.mount, root.group]), [
		[ENTRY, "entry", "baseline"],
		[HEADER, "app", "baseline"],
		[BACKGROUND, "page", "landing"],
		[TOAST, "footer", "footer"],
	]);
	assertEquals([...plan.initial.keys()], [
		ENTRY,
		"_preact.js",
		"_signals.js",
		HEADER,
		"_shared.js",
		BACKGROUND,
		TOAST,
	]);
	assertEquals(plan.lazy, [
		{ root: GL, parent: null, chunks: [GL, "_math.js"], max: LANDING_JS_BUDGET.lazyChunk },
		{ root: SOUND, parent: null, chunks: [SOUND], max: null },
		{
			root: GL_EXTRA,
			parent: GL,
			chunks: [GL_EXTRA, "_math.js"],
			max: LANDING_JS_BUDGET.lazyChunk,
		},
		{ root: CODEC, parent: SOUND, chunks: [CODEC], max: null },
	]);
	assertEquals(plan.owned, [{
		island: BACKGROUND,
		chunks: [BACKGROUND, "_shared.js"],
		max: 2 * KB,
	}]);
});

Deno.test("planPage for a signed-in visitor adds their islands, and their lazy chunks are uncapped", () => {
	const plan = signedInPlan();
	assert(plan.initial.has(CHAT) && plan.initial.has("_chat-core.js"));
	assertEquals(plan.initial.get("_chat-core.js"), CHAT);
	assertEquals(plan.lazy.find((group) => group.root === EMOJI), {
		root: EMOJI,
		parent: null,
		chunks: [EMOJI],
		max: null,
	});
});

Deno.test("planPage caps a lazy chunk a landing island imports, wherever its source lives", () => {
	const manifest: ClientManifest = {
		...MANIFEST,
		[BACKGROUND]: { ...MANIFEST[BACKGROUND], dynamicImports: [GL, EMOJI] },
	};
	const plan = planPage(manifest, "/", MOUNTS, "everyone");
	assertEquals(plan.lazy.find((group) => group.root === EMOJI)?.max, LANDING_JS_BUDGET.lazyChunk);
	assertEquals(plan.lazy.find((group) => group.root === SOUND)?.max, null);
});

Deno.test("planPage refuses an island the build does not have", () => {
	const error = assertThrows(
		() =>
			planPage(MANIFEST, "/", [...MOUNTS, {
				mount: "page",
				islands: [{
					path: "apps/web/features/landing/islands/HeroSearch.island.tsx",
					audience: "everyone",
				}],
			}], "everyone"),
		MissingIslandsError,
	);
	assertEquals(error.keys, ["features/landing/islands/HeroSearch.island.tsx"]);
});

Deno.test("planFiles lists each chunk file once across plans", () => {
	const files = planFiles(MANIFEST, [everyonePlan(), signedInPlan()]);
	assertEquals(files, [...new Set(files)]);
	assertEquals(files.length, Object.keys(GZIP).length);
});
// #endregion

// #region Groups
Deno.test("the ruled caps: landing-owned 60 kB, the hero 20 kB, lazy 35 kB", () => {
	assertEquals(LANDING_JS_BUDGET, {
		landingOwned: 60 * KB,
		heroIsland: 20 * KB,
		lazyChunk: 35 * KB,
	});
});

Deno.test("MOUNT_GROUPS counts the entry and _app as baseline, the shell and page as landing", () => {
	assertEquals(MOUNT_GROUPS, {
		entry: "baseline",
		app: "baseline",
		layout: "layout",
		shell: "landing",
		page: "landing",
		footer: "footer",
	});
});

Deno.test("groupChunks splits the initial chunks: baseline, landing beyond it, the rest beyond both", () => {
	const grouped = groupChunks(MANIFEST, signedInPlan());
	assertEquals([...grouped.baseline], [ENTRY, "_preact.js", "_signals.js", HEADER, "_shared.js"]);
	assertEquals([...grouped.landing], [BACKGROUND]);
	assertEquals([...grouped.layout], [CHAT, "_chat-core.js"]);
	assertEquals([...grouped.footer], [TOAST]);
});

Deno.test("groupChunks counts a chunk a landing island shares with the footer as landing-owned", () => {
	const mounts: MountedIslands[] = [
		{
			mount: "page",
			islands: [{
				path: "apps/web/features/landing/islands/Background.island.tsx",
				audience: "everyone",
			}],
		},
		{
			mount: "footer",
			islands: [{ path: "apps/web/features/site/islands/Header.island.tsx", audience: "everyone" }],
		},
	];
	const grouped = groupChunks(MANIFEST, planPage(MANIFEST, "/", mounts, "signed-in"));
	assertEquals([...grouped.baseline], [ENTRY, "_preact.js", "_signals.js"]);
	assertEquals([...grouped.landing], [BACKGROUND, "_shared.js"]);
	assertEquals([...grouped.footer], [HEADER]);
});
// #endregion

// #region Report
/** The fixture report's verdicts by label. */
function verdictsOf(sizes: ReadonlyMap<string, ChunkSize> = SIZES): Record<string, Verdict> {
	const report = reportPage(MANIFEST, everyonePlan(), signedInPlan(), sizes);
	return Object.fromEntries(report.verdicts.map((verdict) => [verdict.label, verdict]));
}

/** {@link SIZES} with one file's gzip size replaced. */
function resized(file: string, gzip: number): ReadonlyMap<string, ChunkSize> {
	return new Map([...SIZES, [file, { raw: gzip * 2, gzip }]]);
}

const BASELINE = BASELINE_LABEL;
const LANDING = "landing-owned (landing islands beyond the baseline)";

Deno.test("reportPage fails the baseline cap, the landing-owned 60 kB, own weight and landing lazy chunks", () => {
	const report = fixtureReport();
	const verdicts = verdictsOf();
	assertEquals(verdicts[BASELINE], {
		label: BASELINE,
		gzip: 20_000,
		max: APP_BASELINE_PIN.bytes,
		ok: true,
	});
	assertEquals(verdicts[LANDING], {
		label: LANDING,
		gzip: 500,
		max: LANDING_JS_BUDGET.landingOwned,
		ok: true,
	});
	assertEquals(verdicts["own weight, Background.island.tsx"].gzip, 1_500);
	assertEquals(verdicts["own weight, Background.island.tsx"].ok, true);
	assertEquals(verdicts["lazy, gl.ts"].gzip, 37_000);
	assertEquals(verdicts["lazy, gl.ts"].ok, false);
	assertEquals(verdicts["lazy, gl-extra.ts"].ok, true);
	assertEquals(report.ok, false);
});

Deno.test("reportPage reports the layout hosts, the footer, both totals and the lazy chunks it does not own", () => {
	const verdicts = verdictsOf();
	const reported = (label: string, gzip: number) => ({ label, gzip, max: null, ok: true });
	assertEquals(
		verdicts["layout hosts beyond the two above, signed in"],
		reported("layout hosts beyond the two above, signed in", 45_000),
	);
	assertEquals(
		verdicts["footer islands beyond the two above"],
		reported("footer islands beyond the two above", 300),
	);
	assertEquals(verdicts["page total, everyone"], reported("page total, everyone", 20_800));
	assertEquals(verdicts["page total, signed in"], reported("page total, signed in", 65_800));
	assertEquals(
		verdicts["lazy, sound.ts (+1 lazy behind it)"],
		reported("lazy, sound.ts (+1 lazy behind it)", 50_000),
	);
	assertEquals(verdicts["lazy, signed in, emoji.ts"], reported("lazy, signed in, emoji.ts", 9_000));
	assert(!Object.keys(verdicts).some((label) => label.includes("codec.ts")));
});

Deno.test("reportPage holds the baseline at its cap and the landing to 60 kB, inclusive", () => {
	// The fixture's baseline is the 10 kB client entry plus 10 kB more: the entry may take the rest.
	const room = APP_BASELINE_PIN.bytes - 10_000;
	assertEquals(verdictsOf(resized("assets/client-entry.js", room))[BASELINE].ok, true);
	assertEquals(verdictsOf(resized("assets/client-entry.js", room + 1))[BASELINE].ok, false);
	assertEquals(verdictsOf(resized("assets/background.js", 60_000))[LANDING].ok, true);
	assertEquals(verdictsOf(resized("assets/background.js", 60_001))[LANDING].ok, false);
});

Deno.test("reportPage never fails a signed-in visitor's total, however heavy", () => {
	const heavy = verdictsOf(resized("assets/chat.js", 500_000));
	assertEquals(heavy["page total, signed in"].gzip, 535_800);
	assertEquals(heavy["page total, signed in"].ok, true);
	assertEquals(heavy[LANDING].ok, true);
});

Deno.test("reportPage rows run initial, signed-in, then landing lazy chunks, each heaviest first", () => {
	const report = fixtureReport();
	assertEquals(report.rows.map((row) => row.load), [
		...Array(7).fill("initial"),
		"signed-in",
		"signed-in",
		"lazy",
		"lazy",
		"lazy",
		"lazy",
	]);
	assertEquals(report.rows[0], {
		file: "assets/client-entry.js",
		raw: 20_000,
		gzip: 10_000,
		load: "initial",
		group: "baseline",
		via: "client-entry",
	});
	const groupOf = (file: string) => report.rows.find((row) => row.file === file)?.group;
	assertEquals(groupOf("assets/shared.js"), "baseline");
	assertEquals(groupOf("assets/background.js"), "landing");
	assertEquals(groupOf("assets/chat-core.js"), "layout");
	assertEquals(groupOf("assets/toast.js"), "footer");
	assertEquals(groupOf("assets/gl.js"), null);
	assertEquals(
		report.rows.find((row) => row.file === "assets/shared.js")?.via,
		"Header.island.tsx",
	);
	assert(!report.rows.some((row) => row.file === "assets/sound.js"));
});

Deno.test("reportPage weighs each island: first-reach share and what only it pulls in", () => {
	const weights = fixtureReport().roots.map((root) => [
		root.label,
		root.group,
		root.added,
		root.exclusive,
	]);
	assertEquals(weights, [
		["client-entry", "baseline", 17_000, 10_000],
		["Header.island.tsx", "baseline", 3_000, 2_000],
		["Chat.island.tsx", "layout", 45_000, 45_000],
		["Background.island.tsx", "landing", 500, 500],
		["Toast.tsx", "footer", 300, 300],
	]);
});

Deno.test("formatPageReport prints the tables, marks a broken cap OVER and the reported lines", () => {
	const text = formatPageReport(fixtureReport());
	assertStringIncludes(text, "assets/client-entry.js");
	assertStringIncludes(text, "Weight by island");
	assertStringIncludes(text, "counts toward");
	const pinned = formatKb(APP_BASELINE_PIN.bytes).replace(".", "\\.");
	assert(
		new RegExp(`app baseline \\(client entry \\+ _app islands\\)\\s+20\\.0 kB\\s+${pinned}\\s+ok`)
			.test(text),
	);
	assert(
		/landing-owned \(landing islands beyond the baseline\)\s+0\.5 kB\s+60\.0 kB\s+ok/.test(text),
	);
	assert(/lazy, gl\.ts\s+37\.0 kB\s+35\.0 kB\s+OVER/.test(text));
	assert(/page total, signed in\s+65\.8 kB\s+-\s+reported/.test(text));
	assert(/lazy, sound\.ts \(\+1 lazy behind it\)\s+50\.0 kB\s+-\s+reported/.test(text));
});
// #endregion

// #region Baseline pin
/** Two main commits: the one pinned, and a later one merged after the pin. */
const MAIN_A = "a".repeat(40);
const MAIN_B = "b".repeat(40);
/** The fixture baseline's 20 kB, pinned at {@link MAIN_A}. */
const PIN: BaselinePin = { bytes: 20_000, measuredAt: "2026-10-19T09:00:00.000Z", mainSha: MAIN_A };

Deno.test("the committed pin parses: whole bytes, a date and main's full commit id", async () => {
	const file = JSON.parse(
		await Deno.readTextFile(new URL(`../../../../../${BASELINE_PIN_PATH}`, import.meta.url)),
	);
	assertEquals(parseBaselinePin(file), APP_BASELINE_PIN);
	assert(Number.isInteger(APP_BASELINE_PIN.bytes) && APP_BASELINE_PIN.bytes > 0);
	assert(/^[0-9a-f]{40}$/.test(APP_BASELINE_PIN.mainSha));
	assertStringIncludes(file.$comment, "--repin");
});

Deno.test("parseBaselinePin refuses a pin that is not whole bytes, a date and a commit id", () => {
	assertEquals(parseBaselinePin({ ...PIN, $comment: "x" }), PIN);
	assertThrows(() => parseBaselinePin({ ...PIN, bytes: 1.5 }), Error, "bytes");
	assertThrows(() => parseBaselinePin({ ...PIN, bytes: 0 }), Error, "bytes");
	assertThrows(() => parseBaselinePin({ ...PIN, measuredAt: "yesterday" }), Error, "measuredAt");
	assertThrows(() => parseBaselinePin({ ...PIN, mainSha: "abc123" }), Error, "mainSha");
	assertThrows(() => parseBaselinePin(null), Error, "bytes");
});

Deno.test("baselineRule holds the pin until main moves, and holds it when the merge base is unknown", () => {
	assertEquals(baselineRule(PIN, MAIN_A), { max: 20_000, held: true });
	assertEquals(baselineRule(PIN, MAIN_B), { max: 20_000, held: false });
	assertEquals(baselineRule(PIN, null), { max: 20_000, held: true });
});

Deno.test("reportPage fails a held baseline one byte over its pin, and waives it once main moved", () => {
	const over = resized("assets/client-entry.js", 10_001);
	const report = (sizes: ReadonlyMap<string, ChunkSize>, mergeBase: string | null) =>
		reportPage(MANIFEST, everyonePlan(), signedInPlan(), sizes, baselineRule(PIN, mergeBase));
	const line = (sizes: ReadonlyMap<string, ChunkSize>, mergeBase: string | null) =>
		report(sizes, mergeBase).verdicts.find((verdict) => verdict.label === BASELINE);

	assertEquals(line(SIZES, MAIN_A), { label: BASELINE, gzip: 20_000, max: 20_000, ok: true });
	assertEquals(line(over, MAIN_A), { label: BASELINE, gzip: 20_001, max: 20_000, ok: false });
	assertEquals(line(over, null)?.ok, false);
	assertEquals(line(over, MAIN_B), {
		label: BASELINE,
		gzip: 20_001,
		max: 20_000,
		ok: true,
		waived: BASELINE_WAIVED,
	});
	// Within the pin nothing is waived, whichever main the branch has merged.
	assertEquals(line(SIZES, MAIN_B)?.waived, undefined);
	// A waived baseline never hides another line: gl.ts stays over its 35 kB.
	assertEquals(report(over, MAIN_B).ok, false);
	assert(
		/app baseline .*20\.0 kB\s+main moved, re-pin/.test(formatPageReport(report(over, MAIN_B))),
	);
});

Deno.test("repinBaseline takes main's size after a main merge, and a trim at any time", () => {
	const at = "2026-10-20T10:00:00.000Z";
	assertEquals(repinBaseline(PIN, 21_500, MAIN_B, at), {
		ok: true,
		pin: { bytes: 21_500, measuredAt: at, mainSha: MAIN_B },
	});
	assertEquals(repinBaseline(PIN, 19_000, MAIN_A, at), {
		ok: true,
		pin: { bytes: 19_000, measuredAt: at, mainSha: MAIN_A },
	});
	assertEquals(repinBaseline(PIN, 20_000, MAIN_A, at).ok, true);
});

Deno.test("repinBaseline refuses to grow the pin without a main merge: landing commits may not grow it", () => {
	const result = repinBaseline(PIN, 20_001, MAIN_A, "2026-10-20T10:00:00.000Z");
	assertEquals(result.ok, false);
	if (!result.ok) {
		assertStringIncludes(result.reason, "main has not been merged since the pin");
		assertStringIncludes(result.reason, "20000 → 20001 bytes (+1)");
	}
});
// #endregion
