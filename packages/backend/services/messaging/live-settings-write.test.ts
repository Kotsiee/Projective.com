import { assert, assertEquals } from "@std/assert";
import type {
	AutoResponseRule,
	MessagingSettings,
	NotificationPreferences,
} from "@projective/types/messaging";
import {
	INDEFINITE_SNOOZE_UNTIL,
	parseClockTime,
	planCategory,
	planMute,
	planPrefs,
	planSettingsWrite,
	type SettingsWritePlan,
	type StoredSettings,
} from "./live-settings-write.ts";
import {
	AUTO_RESPONSE_CAP,
	type AutoResponseRow,
	muteAllFrom,
	type PrefsRow,
	projectSettings,
	rulesFrom,
	silencedKeysFrom,
	TYPE_KEY_MENTION,
	TYPE_KEY_NEW_MESSAGE,
	type TypeMuteRow,
} from "./live-settings.ts";

/*
 * The write path is held to one property: whatever it writes reads back, through the READER's own
 * projection (`projectSettings`), as what was saved — or, where storage cannot hold the combination,
 * as something that never silences a toggle the person left on. The database is simulated as rows;
 * the column semantics the simulation needs (upsert merges, NULL inherits, `time` renders `HH:MM:SS`)
 * are the ones the reader already decodes.
 */

// #region Simulated storage

const NOW = Date.parse("2026-10-06T12:00:00Z");
const LATER = "2026-10-09T12:00:00+00:00";
const EARLIER = "2026-10-01T12:00:00+00:00";
const LEGACY_ACTIVE = '["2026-10-06 00:00:00+00","2026-10-07 00:00:00+00")';
const SERVICE_UUID = "6f1d3c2a-9b8e-4f70-a1b2-c3d4e5f60718";

/** The four tables, as rows. */
interface World {
	prefs: PrefsRow | null;
	category: { in_app: boolean | null } | null;
	mutes: TypeMuteRow[];
	rules: AutoResponseRow[];
}

/** A `notification_prefs` row holding the column defaults. */
function defaultPrefsRow(): PrefsRow {
	return {
		in_app: true,
		sound: true,
		muted_until: null,
		quiet_hours_enabled: false,
		quiet_hours_start: null,
		quiet_hours_end: null,
		quiet_hours: null,
		read_receipts: true,
		show_typing_indicator: true,
		auto_responses_enabled: false,
	};
}

/** PostgREST renders a `time` column with seconds; a stored `HH:MM` comes back as `HH:MM:00`. */
function asStoredTime(value: unknown): string | null {
	return typeof value === "string" ? `${value}:00` : null;
}

/** The reader's window: oldest first, `id` tiebreak, capped. */
function windowOf(rules: readonly AutoResponseRow[]): AutoResponseRow[] {
	return [...rules]
		.sort((a, b) =>
			(a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id)
		)
		.slice(0, AUTO_RESPONSE_CAP);
}

function storedOf(world: World): StoredSettings {
	return {
		prefs: world.prefs
			? {
				in_app: world.prefs.in_app,
				muted_until: world.prefs.muted_until,
				quiet_hours: world.prefs.quiet_hours,
			}
			: null,
		categoryInApp: world.category?.in_app ?? null,
		mutes: world.mutes,
		rules: windowOf(world.rules),
	};
}

let minted = 0;

/** Apply a plan the way PostgREST would. */
function apply(world: World, plan: SettingsWritePlan, nowMs: number): World {
	const prefs: PrefsRow = { ...(world.prefs ?? defaultPrefsRow()) };
	for (const [column, value] of Object.entries(plan.prefs)) {
		const stored = column === "quiet_hours_start" || column === "quiet_hours_end"
			? asStoredTime(value)
			: value;
		(prefs as unknown as Record<string, unknown>)[column] = stored;
	}

	let category = world.category;
	if (plan.category.kind === "set") category = { in_app: plan.category.inApp };
	if (plan.category.kind === "inherit") {
		assert(category, "an inherit write targets an existing row");
		category = { in_app: null };
	}

	let mutes = [...world.mutes];
	for (const { typeKey, write } of plan.mutes) {
		mutes = mutes.filter((row) => row.type_key !== typeKey);
		if (write.kind === "upsert") {
			mutes.push({ type_key: typeKey, muted_until: write.mutedUntil, channels: write.channels });
		}
	}

	const removed = new Set(plan.rules.remove);
	const updates = new Map(plan.rules.update.map((u) => [u.id, u.columns]));
	const rules: AutoResponseRow[] = world.rules
		.filter((row) => !removed.has(row.id))
		.map((row) => {
			const columns = updates.get(row.id);
			return columns ? { ...row, ...columns } : row;
		});
	for (const columns of plan.rules.insert) {
		minted += 1;
		rules.push({
			id: `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`,
			created_at: new Date(nowMs + minted).toISOString(),
			...columns,
		});
	}

	return { prefs, category, mutes, rules };
}

/** Read the world back through the reader's projection. */
function readBack(world: World, nowMs: number): MessagingSettings {
	const keyed = world.mutes.filter((row) =>
		row.type_key === TYPE_KEY_NEW_MESSAGE || row.type_key === TYPE_KEY_MENTION
	);
	return projectSettings({
		prefs: world.prefs,
		rules: rulesFrom(windowOf(world.rules)),
		categoryInApp: world.category?.in_app ?? null,
		silencedKeys: silencedKeysFrom(keyed, nowMs),
		nowMs,
	});
}

function planOrFail(world: World, settings: MessagingSettings): SettingsWritePlan {
	const result = planSettingsWrite(settings, storedOf(world), NOW);
	assert("plan" in result, `expected a plan, got ${JSON.stringify(result)}`);
	return result.plan;
}

function save(world: World, settings: MessagingSettings): World {
	return apply(world, planOrFail(world, settings), NOW);
}

function notifications(part: Partial<NotificationPreferences> = {}): NotificationPreferences {
	return {
		newMessage: true,
		mentions: true,
		groupActivity: true,
		serviceInquiries: true,
		sound: true,
		muteAll: false,
		quietHoursEnabled: false,
		quietStart: "",
		quietEnd: "",
		...part,
	};
}

function settingsOf(part: Partial<MessagingSettings> = {}): MessagingSettings {
	return {
		autoResponsesEnabled: false,
		autoResponses: [],
		notifications: notifications(),
		readReceipts: true,
		showTypingIndicator: true,
		...part,
	};
}

function rule(part: Partial<AutoResponseRule> = {}): AutoResponseRule {
	return {
		id: "ar-custom-1",
		enabled: true,
		name: "First reply",
		trigger: "any",
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		keyword: null,
		statusCondition: null,
		startsAt: null,
		endsAt: null,
		message: "Thanks — I'll reply within a day.",
		aiAssist: false,
		...part,
	};
}

function ruleRow(part: Partial<AutoResponseRow> & { id: string }): AutoResponseRow {
	return {
		enabled: true,
		name: "Stored rule",
		trigger: "any",
		service_id: null,
		product_id: null,
		keyword: null,
		status_condition: null,
		starts_at: null,
		ends_at: null,
		message: "Stored body",
		ai_assist: false,
		created_at: "2026-09-01T00:00:00.000Z",
		...part,
	};
}

const EMPTY: World = { prefs: null, category: null, mutes: [], rules: [] };

// #endregion

// #region Round trips

Deno.test("every representable save reads back exactly, from any starting state", () => {
	const starts: Record<string, World> = {
		"no prefs row": EMPTY,
		"global inbox off": { ...EMPTY, prefs: { ...defaultPrefsRow(), in_app: false } },
		"push-only mute + a running snooze + legacy quiet hours": {
			prefs: { ...defaultPrefsRow(), muted_until: LATER, quiet_hours: LEGACY_ACTIVE },
			category: { in_app: false },
			mutes: [{ type_key: TYPE_KEY_NEW_MESSAGE, muted_until: LATER, channels: ["push"] }],
			rules: [],
		},
	};
	// The reader's image: the category C, two mute bits under it, and group = inquiries = C.
	const events: Partial<NotificationPreferences>[] = [
		{ newMessage: true, mentions: true, groupActivity: true, serviceInquiries: true },
		{ newMessage: false, mentions: true, groupActivity: true, serviceInquiries: true },
		{ newMessage: true, mentions: false, groupActivity: true, serviceInquiries: true },
		{ newMessage: false, mentions: false, groupActivity: true, serviceInquiries: true },
		{ newMessage: false, mentions: false, groupActivity: false, serviceInquiries: false },
	];
	const quiet: Partial<NotificationPreferences>[] = [
		{ quietHoursEnabled: false, quietStart: "", quietEnd: "" },
		{ quietHoursEnabled: false, quietStart: "21:15", quietEnd: "" },
		{ quietHoursEnabled: true, quietStart: "22:00", quietEnd: "07:30" },
	];

	for (const [label, start] of Object.entries(starts)) {
		for (const event of events) {
			for (const hours of quiet) {
				for (const muteAll of [false, true]) {
					for (const flag of [false, true]) {
						const wanted = settingsOf({
							autoResponsesEnabled: flag,
							readReceipts: !flag,
							showTypingIndicator: flag,
							notifications: notifications({ ...event, ...hours, muteAll, sound: !flag }),
						});
						const after = save(start, wanted);
						assertEquals(readBack(after, NOW), wanted, `${label} · ${JSON.stringify(wanted)}`);

						// Saving the same settings again changes nothing but the prefs row it always upserts.
						const again = planOrFail(after, wanted);
						assertEquals(again.category, { kind: "keep" }, label);
						assertEquals(again.mutes, [], label);
						assertEquals(again.rules, { update: [], insert: [], remove: [] }, label);
					}
				}
			}
		}
	}
});

Deno.test("no save silences an event toggle the person left on", () => {
	for (let bits = 0; bits < 16; bits += 1) {
		const event = {
			newMessage: (bits & 1) !== 0,
			mentions: (bits & 2) !== 0,
			groupActivity: (bits & 4) !== 0,
			serviceInquiries: (bits & 8) !== 0,
		};
		const back = readBack(save(EMPTY, settingsOf({ notifications: notifications(event) })), NOW)
			.notifications;
		for (const [field, on] of Object.entries(event)) {
			if (on) {
				assert(back[field as keyof typeof event], `${field} silenced by ${JSON.stringify(event)}`);
			}
		}
		if (bits === 0) {
			assertEquals(
				[back.newMessage, back.mentions, back.groupActivity, back.serviceInquiries],
				[false, false, false, false],
			);
		}
	}
});

Deno.test("group activity and service inquiries share one switch: one on keeps both on", () => {
	const back = readBack(
		save(EMPTY, settingsOf({ notifications: notifications({ groupActivity: false }) })),
		NOW,
	).notifications;
	assertEquals([back.groupActivity, back.serviceInquiries], [true, true]);
});

Deno.test("auto-responses replace-set: update, insert, delete — and the reader sees the result", () => {
	const world: World = {
		...EMPTY,
		rules: [
			ruleRow({ id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Greeting" }),
			ruleRow({
				id: "aaaaaaaa-0000-4000-8000-000000000002",
				trigger: "keyword",
				keyword: "launch film",
				created_at: "2026-09-02T00:00:00.000Z",
			}),
		],
	};
	const shown = readBack(world, NOW).autoResponses;
	const edited = [
		{ ...shown[0], message: "  Edited body  " },
		rule({
			id: "ar-custom-3",
			trigger: "service",
			serviceId: SERVICE_UUID.toUpperCase(),
			serviceName: "Brand film",
		}),
	];

	const plan = planOrFail(world, settingsOf({ autoResponses: edited }));
	assertEquals(plan.rules.update.map((u) => u.id), [shown[0].id]);
	assertEquals(plan.rules.insert.length, 1);
	assertEquals(plan.rules.remove, [shown[1].id]);

	const back = readBack(apply(world, plan, NOW), NOW).autoResponses;
	assertEquals(back.length, 2);
	assertEquals(back[0], { ...shown[0], message: "Edited body" });
	assertEquals(back[1].serviceId, SERVICE_UUID);
	// A service NAME has no column; the reader returns it null, so the round trip drops it.
	assertEquals(back[1].serviceName, null);
	assert(back[1].id !== "ar-custom-3", "a new rule takes a database id");
});

Deno.test("an unchanged rule is not rewritten", () => {
	const world: World = {
		...EMPTY,
		rules: [ruleRow({ id: "aaaaaaaa-0000-4000-8000-000000000001" })],
	};
	const plan = planOrFail(world, readBack(world, NOW));
	assertEquals(plan.rules, { update: [], insert: [], remove: [] });
});

Deno.test("rows the modal never showed are never deleted", () => {
	const world: World = {
		...EMPTY,
		rules: [
			ruleRow({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
			// An empty body: the reader drops it, so the save's silence about it means nothing.
			ruleRow({ id: "aaaaaaaa-0000-4000-8000-000000000002", message: "   " }),
		],
	};
	const plan = planOrFail(world, settingsOf({ autoResponses: [] }));
	assertEquals(plan.rules.remove, ["aaaaaaaa-0000-4000-8000-000000000001"]);
});

// #endregion

// #region Event toggles

Deno.test("planCategory writes only to change the effective value, and inherits when it can", () => {
	assertEquals(planCategory(true, null, true), { kind: "keep" });
	assertEquals(planCategory(false, true, false), { kind: "inherit" });
	assertEquals(planCategory(false, null, true), { kind: "set", inApp: false });
	assertEquals(planCategory(true, false, true), { kind: "inherit" });
	assertEquals(planCategory(true, null, false), { kind: "set", inApp: true });
});

Deno.test("planMute touches only the inbox transport", () => {
	const all = { type_key: TYPE_KEY_NEW_MESSAGE, muted_until: null, channels: null };
	assertEquals(planMute(all, true, NOW), {
		kind: "upsert",
		mutedUntil: null,
		channels: ["push", "email", "sms", "webhook"],
	});
	assertEquals(planMute({ ...all, channels: ["in_app"] }, true, NOW), { kind: "delete" });
	assertEquals(planMute({ ...all, muted_until: LATER, channels: ["in_app", "push"] }, true, NOW), {
		kind: "upsert",
		mutedUntil: LATER,
		channels: ["push"],
	});
	assertEquals(planMute({ ...all, muted_until: EARLIER }, true, NOW), { kind: "keep" });
	assertEquals(planMute(undefined, true, NOW), { kind: "keep" });

	assertEquals(planMute(undefined, false, NOW), {
		kind: "upsert",
		mutedUntil: null,
		channels: ["in_app"],
	});
	assertEquals(planMute({ ...all, muted_until: LATER, channels: ["push"] }, false, NOW), {
		kind: "upsert",
		mutedUntil: LATER,
		channels: ["push", "in_app"],
	});
	assertEquals(planMute({ ...all, muted_until: EARLIER, channels: ["push"] }, false, NOW), {
		kind: "upsert",
		mutedUntil: null,
		channels: ["in_app"],
	});
	assertEquals(planMute(all, false, NOW), { kind: "keep" });
});

Deno.test("with the category going off, existing mutes are left alone", () => {
	const world: World = {
		...EMPTY,
		mutes: [{ type_key: TYPE_KEY_MENTION, muted_until: null, channels: ["push"] }],
	};
	const plan = planOrFail(
		world,
		settingsOf({
			notifications: notifications({
				newMessage: false,
				mentions: false,
				groupActivity: false,
				serviceInquiries: false,
			}),
		}),
	);
	assertEquals(plan.mutes, []);
	assertEquals(plan.category, { kind: "set", inApp: false });
});

// #endregion

// #region notification_prefs

Deno.test("muteAll: an indefinite snooze that the reader decodes, and a running one is kept", () => {
	const errors: Record<string, string> = {};
	const on = (muteAll: boolean) => settingsOf({ notifications: notifications({ muteAll }) });

	assertEquals(planPrefs(on(true), null, NOW, errors).muted_until, INDEFINITE_SNOOZE_UNTIL);
	assert(muteAllFrom(INDEFINITE_SNOOZE_UNTIL, NOW));
	// As PostgREST renders it back.
	assert(muteAllFrom("9999-12-31T23:59:59+00:00", NOW));

	const running = { in_app: true, muted_until: LATER, quiet_hours: null };
	assert(!("muted_until" in planPrefs(on(true), running, NOW, errors)));
	assertEquals(planPrefs(on(false), running, NOW, errors).muted_until, null);

	const lapsed = { ...running, muted_until: EARLIER };
	assert(!("muted_until" in planPrefs(on(false), lapsed, NOW, errors)));
	assertEquals(errors, {});
});

Deno.test("quiet hours: the completeness CHECK is a 422 before Postgres sees it", () => {
	const result = planSettingsWrite(
		settingsOf({
			notifications: notifications({ quietHoursEnabled: true, quietStart: "", quietEnd: "06:00" }),
		}),
		storedOf(EMPTY),
		NOW,
	);
	assert("errors" in result);
	assertEquals(Object.keys(result.errors), ["notifications.quietStart"]);

	const garbled = planSettingsWrite(
		settingsOf({
			notifications: notifications({
				quietHoursEnabled: true,
				quietStart: "24:00",
				quietEnd: "ab",
			}),
		}),
		storedOf(EMPTY),
		NOW,
	);
	assert("errors" in garbled);
	assertEquals(Object.keys(garbled.errors).sort(), [
		"notifications.quietEnd",
		"notifications.quietStart",
	]);
});

Deno.test("quiet hours: a legacy-only window round-trips, and turning quiet hours off clears it", () => {
	const legacy: World = {
		...EMPTY,
		prefs: { ...defaultPrefsRow(), quiet_hours: LEGACY_ACTIVE },
	};
	const shown = readBack(legacy, NOW);
	assertEquals(
		[shown.notifications.quietHoursEnabled, shown.notifications.quietStart],
		[true, ""],
	);

	const kept = planOrFail(legacy, shown);
	assert(!("quiet_hours" in kept.prefs), "the legacy range is not touched");
	assertEquals(readBack(apply(legacy, kept, NOW), NOW), shown);

	const off = { ...shown, notifications: { ...shown.notifications, quietHoursEnabled: false } };
	const cleared = planOrFail(legacy, off);
	assertEquals(cleared.prefs.quiet_hours, null);
	assertEquals(readBack(apply(legacy, cleared, NOW), NOW).notifications.quietHoursEnabled, false);
});

Deno.test("parseClockTime mirrors the reader's clock format", () => {
	assertEquals(parseClockTime(""), null);
	assertEquals(parseClockTime("  "), null);
	assertEquals(parseClockTime("9:05"), "09:05");
	assertEquals(parseClockTime("07:30"), "07:30");
	assertEquals(parseClockTime("23:59"), "23:59");
	assertEquals(parseClockTime("24:00"), "invalid");
	assertEquals(parseClockTime("12:60"), "invalid");
	assertEquals(parseClockTime("ab"), "invalid");
});

// #endregion

// #region Rule validation

Deno.test("a rule the tables cannot hold is refused with a field error, not stored", () => {
	const result = planSettingsWrite(
		settingsOf({
			autoResponses: [
				rule({ id: "ar-custom-1", trigger: "service", serviceId: "not-a-uuid" }),
				rule({ id: "ar-custom-2", trigger: "keyword", keyword: "   " }),
				rule({ id: "ar-custom-3", message: "   " }),
				rule({ id: "ar-custom-3" }),
				rule({ id: "ar-custom-5", trigger: "product", productId: "not-a-uuid" }),
				rule({ id: "ar-custom-6", trigger: "status", statusCondition: null }),
				rule({
					id: "ar-custom-7",
					trigger: "status",
					statusCondition: "holiday",
					startsAt: "2026-12-20T00:00:00.000Z",
				}),
				rule({
					id: "ar-custom-8",
					startsAt: "2026-12-20T00:00:00.000Z",
					endsAt: "2026-12-19T00:00:00.000Z",
				}),
			],
		}),
		storedOf(EMPTY),
		NOW,
	);
	assert("errors" in result);
	assertEquals(Object.keys(result.errors).sort(), [
		"autoResponses.0.serviceId",
		"autoResponses.1.keyword",
		"autoResponses.2.message",
		"autoResponses.3.id",
		"autoResponses.4.productId",
		"autoResponses.5.statusCondition",
		"autoResponses.6.startsAt",
		"autoResponses.7.endsAt",
	]);
});

Deno.test("a service or product rule with no id answers every inquiry of its kind", () => {
	const result = planSettingsWrite(
		settingsOf({
			autoResponses: [
				rule({ id: "ar-custom-1", trigger: "service", serviceId: null }),
				rule({ id: "ar-custom-2", trigger: "project_invitation" }),
				rule({
					id: "ar-custom-3",
					trigger: "status",
					statusCondition: "holiday",
					startsAt: "2026-12-20T09:00:00+01:00",
					endsAt: "2027-01-02T09:00:00+01:00",
				}),
			],
		}),
		storedOf(EMPTY),
		NOW,
	);
	assert("plan" in result);
	assertEquals(
		result.plan.rules.insert.map((c) => [c.trigger, c.service_id, c.status_condition, c.starts_at]),
		[
			["service", null, null, null],
			["project_invitation", null, null, null],
			["status", null, "holiday", "2026-12-20T08:00:00.000Z"],
		],
	);
});

Deno.test("only the trigger's own scope column is written", () => {
	const plan = planOrFail(
		EMPTY,
		settingsOf({
			autoResponses: [rule({ trigger: "any", serviceId: SERVICE_UUID, keyword: "stray" })],
		}),
	);
	assertEquals(plan.rules.insert[0].service_id, null);
	assertEquals(plan.rules.insert[0].keyword, null);
});

Deno.test("more rules than the reader's window is refused", () => {
	const many = Array.from(
		{ length: AUTO_RESPONSE_CAP + 1 },
		(_, index) => rule({ id: `ar-custom-${index + 1}` }),
	);
	const result = planSettingsWrite(settingsOf({ autoResponses: many }), storedOf(EMPTY), NOW);
	assert("errors" in result);
	assert("autoResponses" in result.errors);
});

// #endregion
