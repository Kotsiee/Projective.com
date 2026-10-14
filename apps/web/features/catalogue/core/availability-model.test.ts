import { assert, assertEquals } from "@std/assert";
import type { ListingAvailabilityBinding } from "@projective/types/catalogue";
import {
	type AvailabilityPreset,
	type IsoDate,
	SCHEDULE_TEMPLATES,
} from "@projective/types/scheduling";
import {
	bandsLabel,
	bindingView,
	effectivePreset,
	libraryPresets,
	mirroredNote,
	saveInputOf,
	schedulerPresetOf,
	starterPreset,
	stripDays,
	UNSAVED_PRESET_ID,
	upcomingWindowCount,
} from "./availability-model.ts";

function preset(id: string, patch: Partial<AvailabilityPreset> = {}): AvailabilityPreset {
	const [general] = SCHEDULE_TEMPLATES;
	return {
		id,
		name: id,
		description: "",
		timezone: "Europe/London",
		isDefault: false,
		scope: "library",
		blueprintId: null,
		archivedAt: null,
		rules: general.rules,
		...patch,
	};
}

const TODAY = "2026-10-14" as IsoDate;
const DEFAULT = preset("general", { isDefault: true, name: "General" });
const VIP = preset("vip", { name: "VIP" });
const FORK = preset("fork", { scope: "service", blueprintId: "bp-1", name: "General (custom)" });
const ARCHIVED = preset("old", { archivedAt: "2026-09-01T00:00:00Z" });
const ALL = [VIP, FORK, ARCHIVED, DEFAULT];

Deno.test("the library lists live library presets, the default first", () => {
	assertEquals(libraryPresets(ALL).map((p) => p.id), ["general", "vip"]);
});

Deno.test("a listing books against its binding, else the default, else nothing", () => {
	const bound: ListingAvailabilityBinding = { mode: "preset", presetId: "vip", presetName: "VIP" };
	assertEquals(effectivePreset(bound, ALL)?.id, "vip");
	assertEquals(
		effectivePreset({ mode: "default", presetId: null, presetName: "General" }, ALL)?.id,
		"general",
	);
	assertEquals(effectivePreset(null, ALL)?.id, "general");
	assertEquals(effectivePreset(null, [VIP]), null);
});

Deno.test("the binding line names a linked or a forked binding", () => {
	assertEquals(bindingView({ mode: "default", presetId: null, presetName: "General" }, DEFAULT), {
		mode: "linked",
		presetName: "General",
		sentence: "Uses General, your default hours.",
	});
	assertEquals(
		bindingView({ mode: "preset", presetId: "vip", presetName: "VIP" }, VIP)?.sentence,
		"Uses VIP.",
	);
	assertEquals(
		bindingView({ mode: "override", presetId: "fork", presetName: "General (custom)" }, FORK)?.mode,
		"forked",
	);
	assertEquals(bindingView(null, null), null);
});

Deno.test("saveInputOf creates an unsaved preset, re-scopes a fork, and refuses a broken rule", () => {
	const starter = starterPreset("Europe/London");
	assertEquals(starter.id, UNSAVED_PRESET_ID);
	const created = saveInputOf(starter);
	assert(created.ok);
	assertEquals(created.input.id, undefined);
	assertEquals(created.input.isDefault, true);

	const asLibrary = saveInputOf(schedulerPresetOf(FORK), {
		create: true,
		scope: "library",
		blueprintId: null,
		name: "Mornings",
	});
	assert(asLibrary.ok);
	assertEquals(
		[asLibrary.input.id, asLibrary.input.scope, asLibrary.input.blueprintId, asLibrary.input.name],
		[undefined, "library", null, "Mornings"],
	);

	const intoFork = saveInputOf(schedulerPresetOf(DEFAULT), {
		id: "fork",
		scope: "service",
		blueprintId: "bp-1",
		isDefault: false,
	});
	assert(intoFork.ok);
	assertEquals([intoFork.input.id, intoFork.input.isDefault], ["fork", false]);

	const broken = schedulerPresetOf(DEFAULT);
	broken.rules = [{ ...broken.rules[0], endsOn: "2025-01-01" }];
	const refused = saveInputOf(broken);
	assert(!refused.ok);
	assertEquals(refused.message, "The end date is before the start date.");
});

Deno.test("upcoming windows count working-hours spans in the next 30 days", () => {
	assertEquals(upcomingWindowCount(DEFAULT, TODAY), 22);
	assertEquals(upcomingWindowCount({ timezone: "Europe/London", rules: [] }, TODAY), 0);
});

Deno.test("the strip shows each day's working hours in the preset's zone", () => {
	const days = stripDays(DEFAULT, TODAY, 5);
	assertEquals(days.map((d) => `${d.weekday} ${d.day} ${d.hours}`), [
		"Wed 14 09:00–17:30",
		"Thu 15 09:00–17:30",
		"Fri 16 09:00–17:30",
		"Sat 17 Off",
		"Sun 18 Off",
	]);
	assertEquals(
		bandsLabel([{ start: 600, end: 720 }, { start: 840, end: 1440 }]),
		"10:00–12:00, 14:00–24:00",
	);
});

Deno.test("the mirror note speaks only when the profile copy is partial", () => {
	assertEquals(mirroredNote(null), null);
	assertEquals(mirroredNote({ full: true }), null);
	assert(mirroredNote({ full: false })?.includes("weekly part"));
});
