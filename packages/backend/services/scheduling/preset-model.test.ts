import { assertEquals, assertThrows } from "@std/assert";
import {
	type AvailabilityPreset,
	type AvailabilityRuleDraft,
	type IsoDate,
	SCHEDULE_TEMPLATES,
} from "@projective/types/scheduling";
import { RESTRICTED_REFUSAL } from "@projective/types/auth";
import {
	compileWindow,
	forkInput,
	mirrorProjection,
	needsRecompile,
	presetFromRows,
	presetPayload,
	presetRefusal,
	type RuleRow,
} from "./preset-model.ts";

/**
 * preset-model_test — the pure half of presets: the weekly mirror (full and partial), the door
 * payload and its round trip back through the stored rows, the fork, the compile window and what a
 * door's refusal means.
 */

// #region Fixtures
const TODAY = "2026-10-14" as IsoDate;

function rule(
	over: Partial<AvailabilityRuleDraft> & Pick<AvailabilityRuleDraft, "id">,
): AvailabilityRuleDraft {
	return {
		layer: "working_hours",
		effect: "add",
		pattern: { type: "weekly", days: [1, 2, 3, 4, 5], interval: 1 },
		condition: { unlessWeekdays: [] },
		bands: [{ start: 540, end: 1020 }],
		startsOn: "2026-01-05" as IsoDate,
		endsOn: null,
		priority: 50,
		label: "",
		active: true,
		...over,
	};
}

const template = (key: string) => {
	const t = SCHEDULE_TEMPLATES.find((x) => x.key === key)!;
	return { timezone: t.timezone, rules: t.rules };
};
// #endregion

// #region Mirror
Deno.test("mirror: an all-weekly preset mirrors fully, calls clipped to working hours", () => {
	const { bands, full } = mirrorProjection(template("general"), TODAY);
	assertEquals(full, true);
	assertEquals(bands.filter((b) => b.weekday === 3), [
		{ weekday: 3, startMinute: 540, endMinute: 1050, kind: "working_hours" },
		{ weekday: 3, startMinute: 600, endMinute: 720, kind: "call_window" },
		{ weekday: 3, startMinute: 840, endMinute: 960, kind: "call_window" },
	]);
	assertEquals(bands.some((b) => b.weekday === 0 || b.weekday === 6), false);
});

Deno.test("mirror: a bi-weekly rule is left out and the projection is partial", () => {
	const { bands, full } = mirrorProjection(template("vip_intensive"), TODAY);
	assertEquals(full, false);
	assertEquals(bands.some((b) => b.weekday === 6), false);
	assertEquals(bands.filter((b) => b.weekday === 2).length, 4);
});

Deno.test("mirror: overlapping weekly rules merge; future, ending and non-add rules are partial", () => {
	const merged = mirrorProjection({
		timezone: "UTC",
		rules: [
			rule({ id: "a", bands: [{ start: 540, end: 720 }] }),
			rule({ id: "b", bands: [{ start: 660, end: 900 }] }),
		],
	}, TODAY);
	assertEquals(merged.full, true);
	assertEquals(merged.bands.filter((b) => b.weekday === 1), [
		{ weekday: 1, startMinute: 540, endMinute: 900, kind: "working_hours" },
	]);

	for (
		const richer of [
			rule({ id: "f", startsOn: "2027-01-04" as IsoDate }),
			rule({ id: "e", endsOn: "2027-01-01" as IsoDate }),
			rule({ id: "s", effect: "subtract", bands: [] }),
			rule({ id: "m", pattern: { type: "monthly_date", days: [1], interval: 1 } }),
		]
	) {
		const out = mirrorProjection({ timezone: "UTC", rules: [rule({ id: "w" }), richer] }, TODAY);
		assertEquals(out.full, false, richer.id);
		assertEquals(out.bands.length, 5, richer.id);
	}
});

Deno.test("mirror: an inactive rule neither mirrors nor makes it partial", () => {
	const out = mirrorProjection({
		timezone: "UTC",
		rules: [
			rule({ id: "w" }),
			rule({ id: "off", active: false, pattern: { type: "weekly", days: [6], interval: 2 } }),
		],
	}, TODAY);
	assertEquals(out.full, true);
	assertEquals(out.bands.length, 5);
});
// #endregion

// #region Payload
Deno.test("payload: snake_case, canonical RRULEs, client ids dropped and uuids kept", () => {
	const keep = "0b0f6a52-7c43-4d0e-9a2f-3f0a7d6c1e11";
	const body = presetPayload({
		name: "General",
		description: "",
		timezone: "Europe/London",
		isDefault: true,
		scope: "library",
		blueprintId: null,
		rules: [
			rule({ id: "rule-1" }),
			rule({
				id: keep,
				effect: "subtract",
				pattern: { type: "monthly_date", days: [12], interval: 1 },
				condition: { unlessWeekdays: [4, 5] },
				bands: [],
			}),
		],
	});
	const rules = body.rules as Array<Record<string, unknown>>;
	assertEquals(body.is_default, true);
	assertEquals("id" in body, false);
	assertEquals("id" in rules[0], false);
	assertEquals(rules[0].rrule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
	assertEquals(rules[0].bands, [{ start_minute: 540, end_minute: 1020 }]);
	assertEquals(rules[1].id, keep);
	assertEquals(rules[1].rrule, "FREQ=MONTHLY;BYMONTHDAY=12;BYDAY=SU,MO,TU,WE,SA");
	assertEquals(rules[1].unless_weekdays, [4, 5]);
});

Deno.test("rows: a saved preset reads back as the drafts that were saved", () => {
	const drafts = [
		rule({
			id: "11111111-1111-4111-8111-111111111111",
			bands: [{ start: 360, end: 720 }, { start: 840, end: 1140 }],
		}),
		rule({
			id: "22222222-2222-4222-8222-222222222222",
			effect: "replace",
			pattern: { type: "monthly_date", days: [21], interval: 1 },
			bands: [{ start: 900, end: 1020 }],
			priority: 70,
			label: "Short day",
		}),
		rule({
			id: "33333333-3333-4333-8333-333333333333",
			effect: "subtract",
			pattern: { type: "once", date: "2026-12-25" as IsoDate },
			startsOn: "2026-12-25" as IsoDate,
			bands: [],
		}),
	];
	const payload = presetPayload({
		name: "Split",
		description: "",
		timezone: "UTC",
		isDefault: false,
		scope: "library",
		blueprintId: null,
		rules: drafts,
	});
	const ruleRows: RuleRow[] = (payload.rules as Array<Record<string, unknown>>).map((
		r,
		position,
	) => ({
		id: r.id as string,
		preset_id: "p",
		kind: r.kind as RuleRow["kind"],
		effect: r.effect as RuleRow["effect"],
		rrule: r.rrule as string,
		starts_on: r.starts_on as string,
		ends_on: r.ends_on as string | null,
		priority: r.priority as number,
		unless_weekdays: r.unless_weekdays as number[],
		label: r.label as string,
		is_active: r.is_active as boolean,
		position,
	}));
	const bandRows = (payload.rules as Array<
		{ id: string; bands: Array<{ start_minute: number; end_minute: number }> }
	>)
		.flatMap((r) => r.bands.map((b, position) => ({ rule_id: r.id, position, ...b })));
	const preset = presetFromRows(
		{
			id: "p",
			schedule_id: "s",
			scope: "library",
			blueprint_id: null,
			name: "Split",
			description: "",
			is_default: false,
			compiled_from: null,
			compiled_through: null,
			archived_at: null,
		},
		ruleRows,
		bandRows,
		"UTC",
	);
	assertEquals(preset.rules, drafts);
});

Deno.test("rows: a stored RRULE no pattern expresses is refused, never approximated", () => {
	assertThrows(() =>
		presetFromRows(
			{
				id: "p",
				schedule_id: "s",
				scope: "library",
				blueprint_id: null,
				name: "x",
				description: "",
				is_default: false,
				compiled_from: null,
				compiled_through: null,
				archived_at: null,
			},
			[{
				id: "r",
				preset_id: "p",
				kind: "working_hours",
				effect: "add",
				rrule: "FREQ=DAILY;INTERVAL=3",
				starts_on: "2026-01-01",
				ends_on: null,
				priority: 50,
				unless_weekdays: [],
				label: "",
				is_active: true,
				position: 0,
			}],
			[],
			"UTC",
		)
	);
});
// #endregion

// #region Fork
Deno.test("fork: the source's rules under fresh client ids, scoped to the service", () => {
	const source: AvailabilityPreset = {
		id: "lib",
		name: "General",
		description: "Weekdays",
		timezone: "Europe/London",
		isDefault: true,
		scope: "library",
		blueprintId: null,
		rules: [rule({ id: "11111111-1111-4111-8111-111111111111" })],
		archivedAt: null,
	};
	const created = forkInput(source, "bp-1", null);
	assertEquals(created.scope, "service");
	assertEquals(created.blueprintId, "bp-1");
	assertEquals(created.isDefault, false);
	assertEquals("id" in created, false);
	assertEquals(created.rules.map((r) => r.id), ["rule-1"]);
	assertEquals(forkInput(source, "bp-1", "fork-1").id, "fork-1");
});
// #endregion

// #region Window
Deno.test("window: today to today + horizon in local dates, local midnights as instants", () => {
	const w = compileWindow("2026-03-23" as IsoDate, 13, "Europe/London");
	assertEquals(w.range, { from: "2026-03-23", to: "2026-04-05" });
	assertEquals(new Date(w.from).toISOString(), "2026-03-23T00:00:00.000Z");
	assertEquals(new Date(w.to).toISOString(), "2026-04-05T23:00:00.000Z");
	assertEquals(needsRecompile(null, TODAY), true);
	assertEquals(needsRecompile("2027-01-11", TODAY), true);
	assertEquals(needsRecompile("2027-01-12", TODAY), false);
});
// #endregion

// #region Refusals
Deno.test("refusals: field-keyed 422s, 403s, 404 and the minor's refusal", () => {
	const name = presetRefusal({
		code: "22023",
		message: "name: another preset in this library has that name",
	});
	assertEquals(name.status, 422);
	assertEquals(name.errors, { name: "Another preset in this library has that name" });
	const band = presetRefusal({
		code: "22023",
		message: "rules.2.bands.0: a band ends after it starts, within one day",
	});
	assertEquals(Object.keys(band.errors ?? {}), ["rules.2.bands.0"]);
	assertEquals(
		Object.keys(
			presetRefusal({ code: "23514", message: "availability_preset_id: that preset is archived" })
				.errors ?? {},
		),
		["availabilityPresetId"],
	);
	assertEquals(
		presetRefusal({ code: "42501", message: "schedule: you cannot edit this schedule" }).status,
		403,
	);
	assertEquals(presetRefusal({ code: "P0002", message: "preset: no such preset" }).status, 404);
	const minor = presetRefusal({
		code: "PM403",
		message: "scheduling: availability presets unlock at 18",
	});
	assertEquals([minor.status, minor.message], [403, RESTRICTED_REFUSAL]);
	assertThrows(() => presetRefusal({ code: "08006", message: "connection lost" }));
});
// #endregion
