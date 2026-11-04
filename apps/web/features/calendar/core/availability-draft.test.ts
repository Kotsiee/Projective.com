import { assertEquals } from "@std/assert";
import type { Preset as SchedulerPreset } from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { AvailabilityPreset } from "@projective/types/scheduling";
import {
	drafts,
	resetAvailability,
	seedPresets,
	working,
} from "@features/catalogue/core/availability-store.ts";
import {
	discardDraft,
	draftKeyOf,
	draftRestored,
	parseDraft,
	pendingOf,
	restoreDraft,
	syncDraft,
} from "./availability-draft.ts";

function stored(id: string, name: string): AvailabilityPreset {
	return {
		id,
		slug: `avp-${id.padEnd(8, "0")}`,
		name,
		description: "",
		timezone: "Europe/London",
		isDefault: id === "a",
		scope: "library",
		blueprintId: null,
		rules: [],
		archivedAt: null,
	};
}

function edited(p: AvailabilityPreset, label: string): SchedulerPreset {
	const { slug: _slug, ...rest } = p;
	return { ...rest, description: label };
}

Deno.test("parseDraft keeps well-formed templates and refuses anything else", () => {
	assertEquals(parseDraft(null), null);
	assertEquals(parseDraft("{not json"), null);
	assertEquals(parseDraft(JSON.stringify({ presets: [] })), null);
	const good = edited(stored("a", "A"), "x");
	const raw = JSON.stringify({
		openId: "a",
		presets: { a: good, b: { id: "b", name: "B" }, c: { ...good, id: "other" } },
	});
	assertEquals(parseDraft(raw), { openId: "a", presets: { a: good } });
});

Deno.test("pendingOf adds the open template only while it differs from storage", () => {
	const a = edited(stored("a", "A"), "x");
	const b = edited(stored("b", "B"), "y");
	assertEquals(pendingOf(a, { b }, () => true), { a, b });
	assertEquals(pendingOf(a, { b }, () => false), { b });
	assertEquals(pendingOf(null, {}, () => true), {});
});

Deno.test("a draft is written on edit, restored on the next visit and dropped on discard", () => {
	const owner = "test-owner";
	const key = draftKeyOf(owner);
	localStorage.removeItem(key);
	resetAvailability();
	seedPresets({ presets: [stored("a", "A"), stored("b", "B")], usage: {}, schedule: null });

	const stop = syncDraft(owner);
	working.value = edited(stored("a", "A"), "changed");
	assertEquals(parseDraft(localStorage.getItem(key))?.openId, "a");
	stop();

	// A new visit: an archived template's draft is not restored; the open one is.
	resetAvailability();
	seedPresets({ presets: [stored("a", "A")], usage: {}, schedule: null });
	const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
	raw.presets.b = edited(stored("b", "B"), "gone");
	localStorage.setItem(key, JSON.stringify(raw));
	assertEquals(restoreDraft(owner), "a");
	assertEquals(Object.keys(drafts.value), ["a"]);
	assertEquals(draftRestored.value, true);

	const again = syncDraft(owner);
	discardDraft();
	assertEquals(localStorage.getItem(key), null);
	assertEquals(draftRestored.value, false);
	again();
	resetAvailability();
});
