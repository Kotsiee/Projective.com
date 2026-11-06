/// <reference lib="dom" />
import { assertEquals } from "@std/assert";
import {
	canGoBack,
	canGoForward,
	pinFilesEntry,
	pushFilesEntry,
	syncFilesEntry,
} from "./files-history.ts";

/** A browser history small enough to read: entries and a cursor. */
function fakeHistory(start: unknown = null) {
	const entries: unknown[] = [start];
	let at = 0;
	const fake = {
		get state() {
			return entries[at];
		},
		replaceState: (state: unknown) => void (entries[at] = state),
		pushState: (state: unknown) => {
			entries.length = at + 1;
			entries.push(state);
			at += 1;
		},
		go: (delta: number) => {
			at += delta;
			syncFilesEntry();
		},
	};
	Object.defineProperty(globalThis, "history", { value: fake, configurable: true });
	return fake;
}

Deno.test("back stops at the folder the hub opened on, and forward needs a back first", () => {
	const browser = fakeHistory();
	pinFilesEntry();
	assertEquals([canGoBack.value, canGoForward.value], [false, false]);

	pushFilesEntry("/files/a");
	pushFilesEntry("/files/a/b");
	assertEquals([canGoBack.value, canGoForward.value], [true, false]);

	browser.go(-1);
	assertEquals([canGoBack.value, canGoForward.value], [true, true]);
	browser.go(-1);
	assertEquals([canGoBack.value, canGoForward.value], [false, true]);
});

Deno.test("pushing after a back drops what lay ahead", () => {
	const browser = fakeHistory();
	pinFilesEntry();
	pushFilesEntry("/files/a");
	browser.go(-1);
	pushFilesEntry("/files/b");
	assertEquals([canGoBack.value, canGoForward.value], [true, false]);
});

Deno.test("every entry stays in this document, the first included", () => {
	const browser = fakeHistory({ fClientNav: true, fromFresh: 1 });
	pinFilesEntry();
	assertEquals(browser.state, { fClientNav: false, fromFresh: 1, fhIndex: 0 });
	pushFilesEntry("/files/a");
	assertEquals(browser.state, { fClientNav: false, fhIndex: 1 });
});

Deno.test("a reload deep in the visit keeps Back, and cannot know what lay ahead", () => {
	fakeHistory({ fhIndex: 3 });
	pinFilesEntry();
	assertEquals([canGoBack.value, canGoForward.value], [true, false]);
});
