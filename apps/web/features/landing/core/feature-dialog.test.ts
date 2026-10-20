/**
 * feature-dialog.test — the pure half of `/features`' "Try it" dialog, its `?section=` landing and
 * its chapter marker: the entries the island is handed, which presses it takes over, how a pressed
 * demo opens or falls back to its link, when the page scrolls, and which chapter the reader is in.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	chapterAt,
	entryFor,
	featureDemoEntries,
	isPlainPress,
	isSpaceKey,
	needsScroll,
	openDemo,
	type PressLike,
	readingLine,
	shouldLandOnSection,
} from "./feature-dialog.ts";
import { FEATURE_CATALOGUE, type FeatureEntry, featureTryHref } from "./features-catalogue.ts";
import { createModuleLoader } from "./demos/demo-loader.ts";
import type { DemoId } from "./demos/demo-contract.ts";

const PLAIN: PressLike = {
	button: 0,
	defaultPrevented: false,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
};

Deno.test("featureDemoEntries: the four demo rows in page order, each with its title, line and help", () => {
	const entries = featureDemoEntries();
	assertEquals(entries.map((entry) => [entry.feature, entry.demo]), [
		["work-board", "board"],
		["booking", "booking"],
		["payment-protection", "payments"],
		["team-pay", "splits"],
	]);
	const board = entries[0];
	assertEquals(board.title, "Work board");
	assertEquals(
		board.description,
		"Every job you post runs on a board. Work starts once it's paid for.",
	);
	assertEquals(board.helpHref, "/help/projects-and-stages/claim-and-start-a-ticket");
	assertEquals(entries[1].helpHref, null);
});

Deno.test("featureDemoEntries: a held or Coming soon row never becomes an entry, whatever its demo", () => {
	const rows: FeatureEntry[] = FEATURE_CATALOGUE.map((entry) =>
		entry.status === "live" ? entry : { ...entry, demo: "board" }
	);
	assertEquals(featureDemoEntries(rows).length, 4);
});

Deno.test("entryFor: the entry a trigger names, or null for an unknown or missing row", () => {
	const entries = featureDemoEntries();
	assertEquals(entryFor(entries, "team-pay")?.demo, "splits");
	assertEquals(entryFor(entries, "timeline"), null);
	assertEquals(entryFor(entries, null), null);
	assertEquals(entryFor(entries, undefined), null);
});

Deno.test("isPlainPress: only an unmodified main-button press nothing else handled", () => {
	assert(isPlainPress(PLAIN));
	assertFalse(isPlainPress({ ...PLAIN, button: 1 }));
	assertFalse(isPlainPress({ ...PLAIN, defaultPrevented: true }));
	for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
		assertFalse(isPlainPress({ ...PLAIN, [key]: true }), key);
	}
});

Deno.test("isSpaceKey: Space in both spellings, nothing else", () => {
	assert(isSpaceKey(" "));
	assert(isSpaceKey("Spacebar"));
	assertFalse(isSpaceKey("Enter"));
	assertFalse(isSpaceKey("s"));
});

Deno.test("shouldLandOnSection: a fresh visit with no fragment that has not scrolled", () => {
	const fresh = { navigationType: "navigate", hash: "", scrollY: 0 };
	assert(shouldLandOnSection(fresh));
	assert(shouldLandOnSection({ ...fresh, navigationType: "prerender" }));
	assertFalse(shouldLandOnSection({ ...fresh, navigationType: "reload" }));
	assertFalse(shouldLandOnSection({ ...fresh, navigationType: "back_forward" }));
	assertFalse(shouldLandOnSection({ ...fresh, hash: "#money" }));
	assertFalse(shouldLandOnSection({ ...fresh, scrollY: 240 }));
});

Deno.test("needsScroll: only a heading under the pinned chrome or past the fold", () => {
	const viewport = { height: 800, pinned: 114 };
	assertFalse(needsScroll({ top: 300, bottom: 360 }, viewport));
	assertFalse(needsScroll({ top: 114, bottom: 800 }, viewport));
	assert(needsScroll({ top: 100, bottom: 160 }, viewport));
	assert(needsScroll({ top: 1900, bottom: 1960 }, viewport));
	assert(needsScroll({ top: 760, bottom: 820 }, viewport));
});

Deno.test("openDemo: a chunk that fails after a pointer-down warm-up sends the press to its link", async () => {
	let fail!: (reason: unknown) => void;
	let imports = 0;
	const failing = () => {
		imports += 1;
		return new Promise<string>((_, no) => (fail = no));
	};
	const loader = createModuleLoader<DemoId, string>({
		board: failing,
		payments: failing,
		booking: failing,
		splits: failing,
	});
	const booking = entryFor(featureDemoEntries(), "booking")!;
	loader.load(booking.demo).catch(() => {});
	const shown: string[] = [];
	const navigated: string[] = [];
	const press = openDemo(booking, {
		load: loader.load,
		arrived: (module) => shown.push(module),
		stillShowing: () => true,
		fallbackHref: featureTryHref(booking.demo),
		navigate: (href) => navigated.push(href),
	});
	fail(new TypeError("Failed to fetch dynamically imported module"));
	await press;
	assertEquals(imports, 1, "the press joined the warm-up's import");
	assertEquals(shown, []);
	assertEquals(navigated, [featureTryHref("booking")]);
	assertEquals(navigated, ["/?demo=booking#demo"]);
});

Deno.test("openDemo: an arrived chunk is shown; a failure after the dialog moved on stays put", async () => {
	const entry = featureDemoEntries()[0];
	const shown: string[] = [];
	const navigated: string[] = [];
	await openDemo(entry, {
		load: () => Promise.resolve("BoardDemo"),
		arrived: (module) => shown.push(module),
		stillShowing: () => true,
		fallbackHref: featureTryHref(entry.demo),
		navigate: (href) => navigated.push(href),
	});
	assertEquals(shown, ["BoardDemo"]);
	await openDemo(entry, {
		load: () => Promise.reject(new Error("chunk 404")),
		arrived: (module) => shown.push(module),
		stillShowing: () => false,
		fallbackHref: featureTryHref(entry.demo),
		navigate: (href) => navigated.push(href),
	});
	assertEquals(navigated, []);
});

Deno.test("chapterAt: the chapter spanning the reader's line, none above the first or past the last", () => {
	const viewport = { height: 800, pinned: 114 };
	const line = readingLine(viewport);
	assertEquals(line, 114 + (800 - 114) / 4);
	const at = (offset: number) =>
		chapterAt(
			[
				{ id: "money", top: 114 - offset, bottom: 1400 - offset },
				{ id: "trust", top: 1400 - offset, bottom: 2100 - offset },
			],
			line,
		);
	assertEquals(at(0), "money", "a chapter link lands its section on the chrome's edge");
	assertEquals(at(1400), "trust");
	assertEquals(at(-200), null, "the page head is above every chapter");
	assertEquals(at(2100), null, "the final call to action is past the last");
	assertEquals(readingLine({ height: 100, pinned: 114 }), 114);
});
