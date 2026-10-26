import { assert, assertEquals } from "@std/assert";
import {
	type AvailabilityRuleDraft,
	type IsoDate,
	type OccurrenceSpan,
	type SavePresetInput,
	SCHEDULE_TEMPLATES,
} from "@projective/types/scheduling";
import type { ReadActor } from "../read-actor.ts";
import { listPresets, savePreset } from "./live-presets.ts";
import { bindListing } from "./live-preset-binding.ts";
import { compilePreset } from "./live-occurrences.ts";
import { presetPayload } from "./preset-model.ts";
import { fakePresetDoors, stubSchedulingClient, type StubStore } from "./scheduling-stub-client.ts";

/**
 * presets-service_test — the preset service over a stateful stub database: a save refuses hard issues
 * and carries soft ones, the "VIP Intensive" template compiles to the right instants across the
 * spring-forward week, and overriding a listing's availability twice rewrites one fork.
 */

// #region Fixtures
const OWNER: ReadActor & { accessToken: string } = {
	userId: "u-owner",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
};
const SCHEDULE = "5c4d7a10-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-03-23T10:00:00Z");

function store(): StubStore {
	return {
		schedules: [{
			id: SCHEDULE,
			owner_type: "user",
			owner_id: OWNER.userId,
			timezone: "Europe/London",
			is_published: true,
		}],
		blackout_dates: [],
	};
}

function stack(s: StubStore) {
	const stub = stubSchedulingClient(s, fakePresetDoors());
	return { ...stub, deps: { db: stub.client, service: stub.client, now: NOW } };
}

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

function input(rules: AvailabilityRuleDraft[]): SavePresetInput {
	return {
		name: "Weekdays",
		description: "",
		timezone: "Europe/London",
		isDefault: false,
		scope: "library",
		blueprintId: null,
		rules,
	};
}
// #endregion

// #region savePreset
Deno.test("savePreset: overlapping bands are a hard issue — a 422 naming the rule, nothing written", async () => {
	const { deps, calls } = stack(store());
	const result = await savePreset(
		input([rule({ id: "rule-1", bands: [{ start: 540, end: 720 }, { start: 660, end: 900 }] })]),
		OWNER,
		deps,
	);
	assertEquals(result.status, 422);
	assertEquals(result.errors, { "rules.0": "Two times in this rule overlap." });
	assertEquals(calls.map((c) => c.name), []);
});

Deno.test("savePreset: a recurrence RRULE cannot express is refused before the evaluator", async () => {
	const { deps, calls } = stack(store());
	const result = await savePreset(
		input([rule({ id: "rule-1", condition: { unlessWeekdays: [4] } })]),
		OWNER,
		deps,
	);
	assertEquals(result.status, 422);
	assertEquals(Object.keys(result.errors ?? {}), ["rules.0.condition"]);
	assertEquals(calls.length, 0);
});

Deno.test("savePreset: soft issues ride along; the save compiles and mirrors the new default", async () => {
	const s = store();
	const { deps, calls } = stack(s);
	const result = await savePreset(
		input([
			rule({ id: "rule-work" }),
			rule({ id: "rule-calls", layer: "call_window", bands: [{ start: 960, end: 1140 }] }),
		]),
		OWNER,
		deps,
	);
	assert(result.ok, result.message);
	assertEquals(result.data?.issues.map((i) => [i.kind, i.severity]), [[
		"call_outside_work",
		"warning",
	]]);
	assert((result.data?.compiled?.spans ?? 0) > 0);
	assertEquals(result.data?.mirrored, { full: true });
	assertEquals(result.data?.preset.isDefault, true);
	assertEquals(calls.map((c) => c.name), [
		"save_availability_preset",
		"replace_preset_occurrences",
		"save_owner_availability",
	]);
	const mirror = calls[2].args.p_payload as {
		published: boolean;
		rules: unknown[];
		call?: unknown;
	};
	assertEquals(mirror.published, true);
	assertEquals("call" in mirror, false);
	assertEquals(mirror.rules.length, 10);
});

Deno.test("savePreset: a zone other than the schedule's is a 422 on timezone", async () => {
	const { deps } = stack(store());
	const result = await savePreset(
		{ ...input([rule({ id: "r" })]), timezone: "Asia/Tokyo" },
		OWNER,
		deps,
	);
	assertEquals(result.status, 422);
	assertEquals(Object.keys(result.errors ?? {}), ["timezone"]);
});
// #endregion

// #region compileOccurrences
Deno.test("compile: VIP Intensive across the spring-forward week lands on the right instants", async () => {
	const s = store();
	const { client, calls } = stack(s);
	const vip = SCHEDULE_TEMPLATES.find((t) => t.key === "vip_intensive")!;
	const presetId = fakePresetDoors().save_availability_preset({
		p_schedule: SCHEDULE,
		p_preset: presetPayload({ ...vip, blueprintId: null, rules: [...vip.rules] }),
	}, s).data as string;

	const outcome = await compilePreset(presetId, { horizonDays: 13, now: NOW, db: client });
	const call = calls.find((c) => c.name === "replace_preset_occurrences")!;
	assertEquals(call.args.p_from, "2026-03-23T00:00:00.000Z");
	assertEquals(call.args.p_to, "2026-04-05T23:00:00.000Z");

	const spans = (call.args.p_spans as OccurrenceSpan[]).map((o) =>
		`${o.kind} ${o.startsAt}–${o.endsAt.slice(11, 16)}`
	);
	const day = (date: string, from: string, to: string) => [
		`working_hours ${date}T${from}:00.000Z–${to}`,
		`call_window ${date}T${from}:00.000Z–${to}`,
	];
	assertEquals(
		spans.sort(),
		[
			// GMT: Tuesday and Thursday before the clocks change.
			...day("2026-03-24", "07:00", "09:00"),
			...day("2026-03-24", "18:00", "20:00"),
			...day("2026-03-26", "07:00", "09:00"),
			...day("2026-03-26", "18:00", "20:00"),
			// BST from Sunday 29 March: the same wall clock is an hour earlier in UTC.
			...day("2026-03-31", "06:00", "08:00"),
			...day("2026-03-31", "17:00", "19:00"),
			...day("2026-04-02", "06:00", "08:00"),
			...day("2026-04-02", "17:00", "19:00"),
			// Alternate Saturdays from 10 January: 21 March is outside the window, 28 March is off-week.
			...day("2026-04-04", "09:00", "12:00"),
		].sort(),
	);
	assertEquals(outcome, { spans: 18, compiledThrough: "2026-04-05" });
});

Deno.test("compile: an archived preset is not compiled", async () => {
	const s = store();
	s.availability_presets = [{
		id: "gone",
		schedule_id: SCHEDULE,
		archived_at: "2026-01-01T00:00:00Z",
	}];
	const { client, calls } = stack(s);
	assertEquals(await compilePreset("gone", { now: NOW, db: client }), null);
	assertEquals(calls.length, 0);
});
// #endregion

// #region listPresets
Deno.test("listPresets: usage names the timed services on each preset and the owner on the default", async () => {
	const s = store();
	const { deps } = stack(s);
	const doors = fakePresetDoors();
	const general = doors.save_availability_preset({
		p_schedule: SCHEDULE,
		p_preset: presetPayload({
			...input([rule({ id: "rule-1" })]),
			name: "General",
			isDefault: true,
		}),
	}, s).data as string;
	const evenings = doors.save_availability_preset({
		p_schedule: SCHEDULE,
		p_preset: presetPayload({ ...input([rule({ id: "rule-2" })]), name: "Evenings" }),
	}, s).data as string;
	const bp = { freelancer_profile_id: OWNER.userId, owner_team_id: null };
	s.service_blueprints = [
		{
			...bp,
			id: "bp-1",
			title: "Coaching",
			delivery_model: "session",
			availability_preset_id: null,
		},
		{
			...bp,
			id: "bp-2",
			title: "Workshop",
			delivery_model: "group_session",
			availability_preset_id: evenings,
		},
		{ ...bp, id: "bp-3", title: "Logo", delivery_model: "one_off", availability_preset_id: null },
		{
			...bp,
			id: "bp-4",
			title: "Team's",
			delivery_model: "session",
			owner_team_id: "t-1",
			availability_preset_id: null,
		},
	];

	const result = await listPresets(OWNER, deps);
	assert(result.ok, result.message);
	assertEquals(result.data?.usage, {
		[general]: [{ kind: "profile", name: "" }, { kind: "service", name: "Coaching" }],
		[evenings]: [{ kind: "service", name: "Workshop" }],
	});
});
// #endregion

// #region bindListing
Deno.test("bindListing: override forks once, a second override rewrites that same fork", async () => {
	const s = store();
	s.service_blueprints = [{
		id: "bp-1",
		slug: "svc-coaching",
		freelancer_profile_id: OWNER.userId,
		owner_team_id: null,
		delivery_model: "session",
		availability_preset_id: null,
	}];
	s.listings = [{
		id: "l-1",
		owner_user_id: OWNER.userId,
		owner_team_id: null,
		kind: "service",
		service_blueprint_id: "bp-1",
		amount_cents: 0,
		view_count: 0,
		currency: "GBP",
	}];
	const { deps, calls } = stack(s);
	const library = fakePresetDoors().save_availability_preset({
		p_schedule: SCHEDULE,
		p_preset: presetPayload(input([rule({ id: "rule-1" })])),
	}, s).data as string;

	const ask = { listingId: "svc-coaching", mode: "override" as const, presetId: library };
	const first = await bindListing(ask, OWNER, deps);
	assert(first.ok, first.message);
	const forks = () => (s.availability_presets ?? []).filter((p) => p.scope === "service");
	assertEquals(forks().length, 1);
	const forkId = forks()[0].id as string;
	assertEquals(s.service_blueprints[0].availability_preset_id, forkId);
	assertEquals(first.data?.binding, { mode: "override", presetId: forkId, presetName: "Weekdays" });
	assertEquals(first.data?.preset?.rules.length, 1);

	const second = await bindListing(ask, OWNER, deps);
	assert(second.ok, second.message);
	assertEquals(forks().length, 1);
	const saves = calls.filter((c) => c.name === "save_availability_preset");
	assertEquals(saves.length, 2);
	assertEquals((saves[1].args.p_preset as { id?: string }).id, forkId);
	assertEquals(second.data?.binding, first.data?.binding);

	const third = await bindListing({ ...ask, presetId: forkId }, OWNER, deps);
	assertEquals(third.data?.binding, first.data?.binding);
	assertEquals(calls.filter((c) => c.name === "save_availability_preset").length, 2);

	const reverted = await bindListing(
		{ listingId: "svc-coaching", mode: "default", presetId: null },
		OWNER,
		deps,
	);
	assertEquals(s.service_blueprints[0].availability_preset_id, null);
	assertEquals(reverted.data?.binding, { mode: "default", presetId: null, presetName: "Weekdays" });
});

Deno.test("bindListing: a stranger's listing is a 404 and a non-session listing a 422", async () => {
	const s = store();
	s.service_blueprints = [{
		id: "bp-2",
		slug: "svc-logo",
		freelancer_profile_id: OWNER.userId,
		owner_team_id: null,
		delivery_model: "one_off",
		availability_preset_id: null,
	}];
	s.listings = [{
		id: "l-2",
		owner_user_id: OWNER.userId,
		owner_team_id: null,
		kind: "service",
		service_blueprint_id: "bp-2",
	}];
	const { deps } = stack(s);
	const notTimed = await bindListing(
		{ listingId: "svc-logo", mode: "default", presetId: null },
		OWNER,
		deps,
	);
	assertEquals(notTimed.status, 422);
	const stranger = await bindListing(
		{ listingId: "svc-logo", mode: "default", presetId: null },
		{ ...OWNER, userId: "u-other" },
		deps,
	);
	assertEquals(stranger.status, 404);
});
// #endregion
