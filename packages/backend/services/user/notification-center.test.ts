import { assertEquals } from "@std/assert";
import { NotificationCenterSchema, NotificationCenterUpdateSchema } from "@projective/types/comms";
import {
	activeSnooze,
	buildCenter,
	type CatalogRow,
	categoriesFromRows,
	categoryPatches,
	clockTime,
	DEFAULT_CENTER_PREFS,
	defaultCenter,
	isEmptyPlan,
	isKnownTimeZone,
	planUpdate,
	prefsFieldErrors,
	prefsFromRow,
	prefsPatch,
	type PrefsRow,
	resetPatch,
	summariseCatalog,
	writeFailure,
} from "./notification-center.ts";

const NOW = new Date("2026-10-06T12:00:00Z");

const ROW: PrefsRow = {
	in_app: true,
	push: true,
	email: false,
	sms: false,
	timezone: "Europe/London",
	quiet_hours_enabled: true,
	quiet_hours_start: "22:00:00",
	quiet_hours_end: "07:30:00",
	muted_until: "2026-10-07T09:00:00+00:00",
	digest_frequency: "daily",
};

// #region Row → centre
Deno.test("clockTime — trims a stored time to HH:MM and refuses non-times", () => {
	assertEquals(clockTime("22:00:00"), "22:00");
	assertEquals(clockTime("07:05"), "07:05");
	assertEquals(clockTime(null), null);
	assertEquals(clockTime("25:00:00"), null);
	assertEquals(clockTime("soon"), null);
});

Deno.test("activeSnooze — a lapsed or malformed deadline reads as no snooze", () => {
	assertEquals(activeSnooze("2026-10-07T09:00:00+00:00", NOW), "2026-10-07T09:00:00+00:00");
	assertEquals(activeSnooze("2026-10-05T09:00:00+00:00", NOW), null);
	assertEquals(activeSnooze("not a date", NOW), null);
	assertEquals(activeSnooze(null, NOW), null);
});

Deno.test("prefsFromRow — maps a stored row, camelCase and HH:MM", () => {
	assertEquals(prefsFromRow(ROW, NOW), {
		inApp: true,
		push: true,
		email: false,
		sms: false,
		timezone: "Europe/London",
		quietHoursEnabled: true,
		quietHoursStart: "22:00",
		quietHoursEnd: "07:30",
		mutedUntil: "2026-10-07T09:00:00+00:00",
		digestFrequency: "daily",
	});
});

Deno.test("prefsFromRow — no row is the column defaults; NULLs fall back to them too", () => {
	assertEquals(prefsFromRow(null, NOW), DEFAULT_CENTER_PREFS);
	const blank = prefsFromRow({
		in_app: null,
		push: null,
		email: null,
		sms: null,
		timezone: " ",
		quiet_hours_enabled: null,
		quiet_hours_start: null,
		quiet_hours_end: null,
		muted_until: null,
		digest_frequency: "hourly",
	}, NOW);
	assertEquals(blank, DEFAULT_CENTER_PREFS);
});

Deno.test("categoriesFromRows — all eight categories in order, absent rows as nulls", () => {
	const rows = categoriesFromRows([
		{ category: "messages", in_app: false, push: null, email: true, sms: null },
		{ category: "not_a_category", in_app: true, push: true, email: true, sms: true },
	]);
	assertEquals(rows.map((row) => row.category), [
		"money",
		"work",
		"messages",
		"schedule",
		"discovery",
		"account",
		"system",
		"marketing",
	]);
	assertEquals(rows[2], { category: "messages", inApp: false, push: null, email: true, sms: null });
	assertEquals(rows[0], { category: "money", inApp: null, push: null, email: null, sms: null });
});

Deno.test("summariseCatalog — counts per category, union of MANDATORY channels only", () => {
	const catalog: CatalogRow[] = [
		{ category: "money", mandatory: true, default_channels: ["in_app", "email"] },
		{ category: "money", mandatory: true, default_channels: ["push", "in_app", "webhook"] },
		{ category: "money", mandatory: false, default_channels: ["sms"] },
		{ category: "work", mandatory: false, default_channels: ["in_app", "email"] },
	];
	const summary = summariseCatalog(catalog);
	assertEquals(summary.length, 8);
	assertEquals(summary[0], {
		category: "money",
		mandatory: 2,
		total: 3,
		channels: ["in_app", "push", "email"],
	});
	assertEquals(summary[1], { category: "work", mandatory: 0, total: 1, channels: [] });
	assertEquals(summary[7], { category: "marketing", mandatory: 0, total: 0, channels: [] });
});

Deno.test("buildCenter / defaultCenter — both satisfy the contract; only the live one claims live", () => {
	const live = buildCenter({ prefs: ROW, categories: [], catalog: [] }, NOW);
	assertEquals(NotificationCenterSchema.safeParse(live).success, true);
	assertEquals(live.live, true);
	assertEquals(live.required.length, 8);

	const fallback = defaultCenter();
	assertEquals(NotificationCenterSchema.safeParse(fallback).success, true);
	assertEquals(fallback.live, false);
	assertEquals(fallback.required, []);
	assertEquals(fallback.categories.length, 8);
	assertEquals(fallback.prefs, DEFAULT_CENTER_PREFS);
});
// #endregion

// #region Update → patches
Deno.test("prefsPatch — only the fields sent, snake_case, null kept as a real value", () => {
	assertEquals(prefsPatch(undefined), {});
	assertEquals(
		prefsPatch({ push: true, quietHoursEnabled: false, quietHoursStart: null, mutedUntil: null }),
		{ push: true, quiet_hours_enabled: false, quiet_hours_start: null, muted_until: null },
	);
	assertEquals(prefsPatch({ timezone: " Asia/Tokyo " }), { timezone: "Asia/Tokyo" });
});

Deno.test("resetPatch — each named channel's column set to null", () => {
	assertEquals(resetPatch(undefined), {});
	assertEquals(resetPatch(["push", "sms"]), { push: null, sms: null });
});

Deno.test("categoryPatches — omitted channels untouched, explicit null written, duplicates merged", () => {
	assertEquals(
		categoryPatches([
			{ category: "work", push: false },
			{ category: "messages", email: null },
			{ category: "work", inApp: true, push: true },
			{ category: "money" },
		]),
		[
			{ category: "work", columns: { push: true, in_app: true } },
			{ category: "messages", columns: { email: null } },
		],
	);
});

Deno.test("planUpdate — a parsed body expands to its three steps; an empty one is empty", () => {
	const body = NotificationCenterUpdateSchema.parse({
		prefs: { push: true },
		resetChannels: ["push"],
		categories: [{ category: "work", push: false }],
	});
	const plan = planUpdate(body);
	assertEquals(plan, {
		prefs: { push: true },
		reset: { push: null },
		categories: [{ category: "work", columns: { push: false } }],
	});
	assertEquals(isEmptyPlan(plan), false);
	assertEquals(isEmptyPlan(planUpdate(NotificationCenterUpdateSchema.parse({}))), true);
	assertEquals(
		isEmptyPlan(
			planUpdate(NotificationCenterUpdateSchema.parse({ categories: [{ category: "work" }] })),
		),
		true,
	);
});
// #endregion

// #region Validation and write errors
Deno.test("isKnownTimeZone — named zones pass; offsets and inventions do not", () => {
	assertEquals(isKnownTimeZone("UTC"), true);
	assertEquals(isKnownTimeZone("Europe/London"), true);
	assertEquals(isKnownTimeZone("+05:00"), false);
	assertEquals(isKnownTimeZone("Mars/Base"), false);
});

Deno.test("prefsFieldErrors — keyed to the request path", () => {
	assertEquals(prefsFieldErrors({ timezone: "UTC", mutedUntil: "2026-10-07T09:00:00Z" }), {});
	assertEquals(Object.keys(prefsFieldErrors({ timezone: "+01:00", mutedUntil: "tomorrow-ish" })), [
		"prefs.timezone",
		"prefs.mutedUntil",
	]);
	assertEquals(prefsFieldErrors(undefined), {});
});

Deno.test("writeFailure — the quiet-hours CHECK is a 422 with a sentence on the start field", () => {
	const result = writeFailure({
		code: "23514",
		message:
			'new row for relation "notification_prefs" violates check constraint "notification_prefs_quiet_hours_complete"',
	});
	assertEquals(result.status, 422);
	assertEquals(result.message, "Quiet hours need a start and an end.");
	assertEquals(result.errors, { "prefs.quietHoursStart": "Quiet hours need a start and an end." });
});

Deno.test("writeFailure — session problems are 401; anything unknown is an outage, never a success", () => {
	assertEquals(writeFailure({ code: "42501" }).status, 401);
	assertEquals(writeFailure({ code: "PGRST301" }).status, 401);
	assertEquals(writeFailure({ code: "22007" }).status, 422);
	for (const code of ["23503", "P0001", undefined]) {
		const result = writeFailure({ code });
		assertEquals(result.ok, false);
		assertEquals(result.status, 503);
	}
});
// #endregion
