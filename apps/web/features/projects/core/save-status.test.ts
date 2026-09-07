import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { relativeTime, resolveSaveStatus, type SaveStatusInput } from "./save-status.ts";

/**
 * The ORDERING is what these tests exist for.
 *
 * Every branch of `resolveSaveStatus` is one sentence, and any of them would look reasonable on
 * screen in isolation. What can only be got wrong is which one wins when two apply at once — and the
 * consequence of getting it wrong is telling somebody their work is safe when it is not, or nagging
 * them to save something that is already handled. A test per branch would pass with the branches in
 * any order; these pin the precedence.
 */

const BASE: SaveStatusInput = {
	saving: false,
	dirty: false,
	queued: false,
	online: true,
	archived: false,
	autoSave: false,
	savedAt: null,
	now: Date.UTC(2026, 8, 7, 12, 0, 0),
};

const at = (input: Partial<SaveStatusInput>) => resolveSaveStatus({ ...BASE, ...input });

Deno.test("archived outranks every other state", () => {
	// Everything else is true at once. Archived still wins, because nothing below it can happen on a
	// project whose writes are all refused — reporting "unsaved changes" would name a state the owner
	// has no way to leave.
	const status = at({ archived: true, saving: true, dirty: true, queued: true, online: false });
	assertEquals(status.tone, "archived");
	assertStringIncludes(status.label, "Archived");
});

Deno.test("saving outranks offline", () => {
	// A request genuinely is on the wire. The connection may have dropped since it left, and that is
	// reported when it comes back rather than guessed at while it is still in flight.
	assertEquals(at({ saving: true, online: false, dirty: true }).tone, "pending");
});

Deno.test("queued outranks plain dirtiness", () => {
	// The distinction the module exists for: "unsaved changes" asks the owner to act, "saved on this
	// device" tells them it is handled. Getting this the wrong way round nags about safe work.
	const status = at({ queued: true, dirty: true, online: true });
	assertEquals(status.tone, "offline");
	assertStringIncludes(status.label, "will sync");
});

Deno.test("queued is reported even once the connection is back", () => {
	// The flush is asynchronous, so there is a real window where the browser is online and the write
	// has not gone yet. Reporting "all changes saved" in that window would be false.
	assertEquals(at({ queued: true, online: true }).tone, "offline");
});

Deno.test("offline while dirty is reported as offline, not as unsaved", () => {
	// The reason the edit has not gone is not something the owner can fix by pressing Save, so the
	// sentence names the actual obstacle.
	const status = at({ online: false, dirty: true });
	assertEquals(status.tone, "offline");
	assertStringIncludes(status.label, "held on this device");
});

Deno.test("offline with nothing outstanding still says so", () => {
	assertEquals(at({ online: false }).label, "Offline");
});

Deno.test("dirty and online is the ordinary unsaved state", () => {
	const status = at({ dirty: true });
	assertEquals(status.tone, "pending");
	assertEquals(status.label, "Unsaved changes");
});

Deno.test("auto-save reports when the last save landed", () => {
	const status = at({ autoSave: true, savedAt: BASE.now - 4 * 60_000 });
	assertEquals(status.tone, "saved");
	assertEquals(status.label, "Last updated 4 minutes ago");
});

Deno.test("auto-save with no save yet reports the mode, never a timestamp", () => {
	// Inventing one from the page load would be a claim about the server that nothing here can make.
	const status = at({ autoSave: true, savedAt: null });
	assertEquals(status.tone, "saved");
	assertStringIncludes(status.label, "Auto-save on");
});

Deno.test("a dirty form under auto-save still reports unsaved rather than a stale timestamp", () => {
	// Auto-save fires on blur, so a field being typed into is genuinely not saved yet. Showing "last
	// updated 2 minutes ago" over unsent keystrokes would be the most misleading line on the surface.
	assertEquals(at({ autoSave: true, dirty: true, savedAt: BASE.now - 120_000 }).tone, "pending");
});

Deno.test("without auto-save the timestamp is not offered", () => {
	// There is a Save button on screen saying the same thing by being absent; a second report of it
	// would be the redundancy the auto-save line exists to replace.
	assertEquals(at({ savedAt: BASE.now - 60_000 }).label, "All changes saved");
});

Deno.test("relativeTime crosses its thresholds in the right direction", () => {
	const now = BASE.now;
	assertEquals(relativeTime(now, now), "just now");
	assertEquals(relativeTime(now - 44_000, now), "just now");
	assertEquals(relativeTime(now - 60_000, now), "1 minute ago");
	assertEquals(relativeTime(now - 5 * 60_000, now), "5 minutes ago");
	assertEquals(relativeTime(now - 60 * 60_000, now), "1 hour ago");
	assertEquals(relativeTime(now - 5 * 60 * 60_000, now), "5 hours ago");
});

Deno.test("relativeTime switches to an absolute clock once 'ago' stops helping", () => {
	// Past a day the relative form is a quantity the reader has to convert; the absolute one is what
	// they were going to convert it into. The exact rendering is the platform's, so this asserts only
	// that it is no longer the relative form.
	const label = relativeTime(BASE.now - 3 * 24 * 60 * 60_000, BASE.now);
	assertEquals(label.includes("ago"), false);
});

Deno.test("a future instant reads as 'just now' rather than a negative interval", () => {
	// Only reachable via a clock correction. "in 4 minutes" would describe a save that has not
	// happened.
	assertEquals(relativeTime(BASE.now + 4 * 60_000, BASE.now), "just now");
});
