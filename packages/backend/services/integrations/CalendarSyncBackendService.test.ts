/**
 * Calendar sync through a faked `fetch` that answers as PostgREST and as each provider: the pure
 * mappings, a read and its lapsed cursor, and the idempotent writes. What the definers do with these
 * calls is `supabase/probes/calendar_sync.sql`.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import type { ConnectionSecretRow } from "@projective/types/integrations";
import {
	googleChange,
	googleCopy,
	graphChange,
	graphCopy,
	type MirrorEvent,
	rruleOf,
} from "./calendar-adapters.ts";
import {
	CalendarSyncBackendService as Service,
	settle,
	syncWindow,
} from "./CalendarSyncBackendService.ts";
import { seal } from "./token-vault.ts";

// #region Kit
const CONNECTION = "c0a8012e-0000-4000-8000-000000000001";
const MIRROR = "1b671a64-40d5-491e-99b0-da01ff1f3341";
const MIRROR_B = "2b671a64-40d5-491e-99b0-da01ff1f3342";
const CLAIMED = "2026-11-04T10:00:00.123456+00:00";
const DIRTY = "2026-11-04T09:59:00.654321+00:00";
const GOOGLE_EVENTS = "/calendar/v3/calendars/primary/events";
const GRAPH_DELTA = "/v1.0/me/calendarView/delta";
const OUT_EVENTS = "/calendar/v3/calendars/out-cal/events";

const ENV: Record<string, string | undefined> = {
	USE_MOCKS: undefined,
	VITE_USE_MOCKS: undefined,
	INTEGRATIONS_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://postgrest.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
	ENCRYPTION_KEY: "ab".repeat(32),
	APP_URL: "https://app.example.test",
};

interface Call {
	host: string;
	/** `<schema>.rpc.<function>`, or a provider's path. */
	name: string;
	method: string;
	url: URL;
	headers: Headers;
	// deno-lint-ignore no-explicit-any
	json: any;
}

type DbRoute = (call: Call) => unknown;
type ProviderRoute = (call: Call) => Response;

const json = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});

async function world(
	routes: { db?: Record<string, DbRoute>; provider?: ProviderRoute; env?: typeof ENV },
	body: (calls: Call[]) => Promise<void>,
) {
	const calls: Call[] = [];
	const env = { ...ENV, ...routes.env };
	const saved = Object.keys(env).map((name) => [name, Deno.env.get(name)] as const);
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	for (const [name, value] of Object.entries(env)) apply(name, value);

	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const text = await request.text();
		const isDb = url.host === "postgrest.fake";
		const schema = request.headers.get("accept-profile") ?? request.headers.get("content-profile");
		const path = url.pathname.replace(/^\/rest\/v1\//, "").replace("/", ".");
		const call: Call = {
			host: url.host,
			name: isDb ? `${schema}.${path}` : url.pathname,
			method: request.method,
			url,
			headers: request.headers,
			json: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : null,
		};
		calls.push(call);
		if (!isDb) return (routes.provider ?? (() => json({}, 500)))(call);
		const route = routes.db?.[call.name];
		if (!route) throw new Error(`unrouted database call: ${call.method} ${call.name}`);
		return json(route(call));
	};
	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [name, value] of saved) apply(name, value);
	}
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const toProvider = (calls: Call[]) => calls.filter((c) => c.host !== "postgrest.fake");

async function secretRow(): Promise<ConnectionSecretRow> {
	return {
		...await seal(CONNECTION, { access_token: "the-access", refresh_token: "the-refresh" }),
		connection_id: CONNECTION,
		token_type: "bearer",
		access_token_expires_at: "2099-01-01T00:00:00.000Z",
		refresh_token_expires_at: null,
		encryption_alg: "aes-256-gcm",
		rotated_at: null,
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: "2026-10-01T00:00:00.000Z",
	};
}

/** A live token, as `fn_claim_connection_token` answers one. */
const tokenRoute = (secret: ConnectionSecretRow) => () => ({
	provider_slug: "google",
	auth_config: {},
	secret,
	refresh: false,
});

function syncClaim(overrides: Record<string, unknown> = {}) {
	return {
		connection_id: CONNECTION,
		provider_slug: "google",
		resource: "calendar:primary",
		claimed_at: CLAIMED,
		cursor: "cursor-1",
		has_channel: true,
		...overrides,
	};
}

const EVENT: MirrorEvent = {
	title: "Design review",
	tentative: false,
	all_day: false,
	starts_at: "2026-11-05T09:00:00+00:00",
	ends_at: "2026-11-05T10:00:00+00:00",
	start_date: "2026-11-05",
	end_date: "2026-11-06",
	room_slug: "rom-abcdefghjk",
};

/** A call's copy as `scheduling.claim_event_mirrors` says it, pinned by `calendar_sync.sql` §13. */
const CALL: MirrorEvent = { ...EVENT, title: "A call on Projective" };

function mirrorClaim(overrides: Record<string, unknown> = {}) {
	return {
		mirror_id: MIRROR,
		connection_id: CONNECTION,
		provider_slug: "google",
		calendar_id: "out-cal",
		external_event_id: null,
		version: null,
		dirty_at: DIRTY,
		claimed_at: CLAIMED,
		event: EVENT,
		...overrides,
	};
}

const syncDb = (
	secret: ConnectionSecretRow,
	claims: unknown[],
	extra: Record<string, DbRoute> = {},
) => ({
	"integrations.rpc.fn_claim_calendar_syncs": () => claims,
	"integrations.rpc.fn_claim_connection_token": tokenRoute(secret),
	"integrations.rpc.fn_apply_busy_sync": () => true,
	"integrations.rpc.fn_release_calendar_sync": () => null,
	...extra,
});

const pushDb = (
	secret: ConnectionSecretRow,
	claims: unknown[],
	extra: Record<string, DbRoute> = {},
) => ({
	"scheduling.rpc.claim_event_mirrors": () => claims,
	"integrations.rpc.fn_claim_connection_token": tokenRoute(secret),
	"scheduling.rpc.finish_event_mirror": () => null,
	"scheduling.rpc.fail_event_mirror": () => null,
	...extra,
});

/** Run with sealed tokens: a seal needs the world's key. */
function withSecret(run: (secret: ConnectionSecretRow) => Promise<void>) {
	return world({}, async () => await run(await secretRow()));
}
// #endregion

// #region What comes in
Deno.test("google: a span keeps its times and what its owner reads, and never a guest", () => {
	assertEquals(
		googleChange({
			id: "e1",
			status: "confirmed",
			summary: "Salary talk",
			description: "private",
			location: "The boardroom",
			recurringEventId: "series-1",
			attendees: [{ email: "boss@example.com" }],
			organizer: { email: "boss@example.com" },
			start: { dateTime: "2026-11-05T09:00:00+01:00" },
			end: { dateTime: "2026-11-05T10:00:00+01:00" },
		}),
		{
			id: "e1",
			title: "Salary talk",
			location: "The boardroom",
			description: "private",
			series_id: "series-1",
			starts_at: "2026-11-05T08:00:00.000Z",
			ends_at: "2026-11-05T09:00:00.000Z",
		},
	);
});

Deno.test("google: a meeting comes from Meet's own field, else the conference's video entry", () => {
	const at = {
		id: "m",
		start: { dateTime: "2026-11-05T09:00:00Z" },
		end: { dateTime: "2026-11-05T10:00:00Z" },
	};
	const joinOf = (raw: Record<string, unknown>) => {
		const change = googleChange({ ...at, ...raw });
		return change && "join_url" in change ? change.join_url : undefined;
	};
	assertEquals(
		joinOf({ hangoutLink: "https://meet.google.com/abc" }),
		"https://meet.google.com/abc",
	);
	assertEquals(
		joinOf({
			conferenceData: {
				entryPoints: [
					{ entryPointType: "phone", uri: "tel:+1-555-0100" },
					{ entryPointType: "video", uri: "https://us02web.zoom.us/j/123" },
				],
			},
		}),
		"https://us02web.zoom.us/j/123",
	);
	assertEquals(joinOf({}), undefined);
});

Deno.test("google: the rule is the RRULE line, whatever else the series says", () => {
	assertEquals(
		rruleOf(["EXDATE;TZID=Europe/London:20261105T220000", "RRULE:FREQ=WEEKLY;BYDAY=MO"]),
		"FREQ=WEEKLY;BYDAY=MO",
	);
	assertEquals(rruleOf(["RDATE:20261105"]), null);
	assertEquals(rruleOf(undefined), null);
});

Deno.test("google: whole days stay dates, and what holds no time is gone", () => {
	assertEquals(
		googleChange({ id: "d", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } }),
		{ id: "d", start_date: "2026-11-05", end_date: "2026-11-06" },
	);
	assertEquals(googleChange({ id: "c", status: "cancelled" }), { id: "c", gone: true });
	assertEquals(
		googleChange({
			id: "t",
			transparency: "transparent",
			start: { dateTime: "2026-11-05T09:00:00Z" },
			end: { dateTime: "2026-11-05T10:00:00Z" },
		}),
		{ id: "t", gone: true },
	);
});

Deno.test("google: what cannot be read changes nothing", () => {
	assertEquals(googleChange(null), null);
	assertEquals(googleChange({ id: 7 }), null);
	assertEquals(googleChange({ id: "no-times" }), null);
	assertEquals(
		googleChange({
			id: "backwards",
			start: { dateTime: "2026-11-05T10:00:00Z" },
			end: { dateTime: "2026-11-05T09:00:00Z" },
		}),
		null,
	);
});

Deno.test("graph: seven decimals in UTC parse, and what its owner reads comes with them", () => {
	assertEquals(
		graphChange({
			id: "g1",
			subject: "Salary talk",
			location: { displayName: "The boardroom" },
			seriesMasterId: "master-1",
			onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/1" },
			attendees: [{ emailAddress: { address: "boss@example.com" } }],
			showAs: "busy",
			start: { dateTime: "2026-11-05T09:00:00.0000000", timeZone: "UTC" },
			end: { dateTime: "2026-11-05T10:30:00.0000000", timeZone: "UTC" },
		}),
		{
			id: "g1",
			title: "Salary talk",
			location: "The boardroom",
			series_id: "master-1",
			join_url: "https://teams.microsoft.com/l/meetup-join/1",
			starts_at: "2026-11-05T09:00:00.000Z",
			ends_at: "2026-11-05T10:30:00.000Z",
		},
	);
});

Deno.test("graph: removed, cancelled, free and elsewhere are gone; out of office and tentative hold", () => {
	const at = {
		start: { dateTime: "2026-11-05T09:00:00.0000000" },
		end: { dateTime: "2026-11-05T10:00:00.0000000" },
	};
	assertEquals(graphChange({ id: "r", "@removed": { reason: "deleted" } }), {
		id: "r",
		gone: true,
	});
	assertEquals(graphChange({ id: "c", isCancelled: true, ...at }), { id: "c", gone: true });
	assertEquals(graphChange({ id: "f", showAs: "free", ...at }), { id: "f", gone: true });
	assertEquals(graphChange({ id: "w", showAs: "workingElsewhere", ...at }), {
		id: "w",
		gone: true,
	});
	assert("starts_at" in graphChange({ id: "o", showAs: "oof", ...at })!);
	assert("starts_at" in graphChange({ id: "t", showAs: "tentative", ...at })!);
	assertEquals(
		graphChange({
			id: "day",
			isAllDay: true,
			showAs: "busy",
			start: { dateTime: "2026-11-05T00:00:00.0000000" },
			end: { dateTime: "2026-11-07T00:00:00.0000000" },
		}),
		{ id: "day", start_date: "2026-11-05", end_date: "2026-11-07" },
	);
	assertEquals(graphChange({ id: "partial", showAs: "busy" }), null);
});

Deno.test("settle: the last word on an event wins, and each id is sent once", () => {
	const { busy, gone } = settle([
		{ id: "a", starts_at: "2026-11-05T09:00:00Z", ends_at: "2026-11-05T10:00:00Z" },
		{ id: "b", starts_at: "2026-11-05T09:00:00Z", ends_at: "2026-11-05T10:00:00Z" },
		{ id: "a", gone: true },
		{ id: "b", starts_at: "2026-11-05T11:00:00Z", ends_at: "2026-11-05T12:00:00Z" },
	]);
	assertEquals(gone, ["a"]);
	assertEquals(busy, [{
		id: "b",
		starts_at: "2026-11-05T11:00:00Z",
		ends_at: "2026-11-05T12:00:00Z",
	}]);
});

Deno.test("syncWindow: a read reaches past the longest booking horizon", () => {
	const now = Date.parse("2026-11-04T00:00:00Z");
	const window = syncWindow(now);
	assertEquals(window.from, "2026-11-03T00:00:00.000Z");
	assert(Date.parse(window.to) - now >= 365 * 86_400_000);
});
// #endregion

// #region What goes out
Deno.test("a copy carries a title, the time and the /meet address, and nothing else", () => {
	const google = googleCopy(EVENT, "https://app.example.test");
	assertEquals(Object.keys(google).sort(), ["description", "end", "start", "status", "summary"]);
	assertEquals(
		google.description,
		"Join on Projective: https://app.example.test/meet/rom-abcdefghjk",
	);
	const graph = graphCopy(EVENT, "https://app.example.test");
	assertEquals(
		Object.keys(graph).sort(),
		["body", "end", "isAllDay", "showAs", "start", "subject"],
	);
	assertEquals(graph.body.content, google.description);
	assertEquals(graph.start, { dateTime: "2026-11-05T09:00:00", timeZone: "UTC" });
});

Deno.test("a copy with no room or title says so plainly, and a tentative one is tentative", () => {
	const event = { ...EVENT, title: " ", room_slug: null, tentative: true };
	const google = googleCopy(event, "https://app.example.test");
	assertEquals(google.summary, "Projective event");
	assertEquals(google.description, "");
	assertEquals(google.status, "tentative");
	assertEquals(graphCopy(event, "https://app.example.test").showAs, "tentative");
});

Deno.test("a whole day goes out as days in the schedule's zone", () => {
	const event = { ...EVENT, all_day: true };
	const google = googleCopy(event, "https://app.example.test");
	assertEquals(google.start, { date: "2026-11-05" });
	assertEquals(google.end, { date: "2026-11-06" });
	const graph = graphCopy(event, "https://app.example.test");
	assertEquals(graph.isAllDay, true);
	assertEquals(graph.start.dateTime, "2026-11-05T00:00:00");
	assertEquals(graph.end.dateTime, "2026-11-06T00:00:00");
});

Deno.test("a call's copy is its title, time and /meet address, whatever else a claim carried", () => {
	const call = {
		...CALL,
		agenda: "Secret agenda",
		attendees: ["Ada Lovelace"],
		meeting_url: "https://zoom.example/j/secret",
	};
	const address = "Join on Projective: https://app.example.test/meet/rom-abcdefghjk";
	assertEquals(googleCopy(call, "https://app.example.test"), {
		summary: "A call on Projective",
		description: address,
		status: "confirmed",
		start: { dateTime: CALL.starts_at },
		end: { dateTime: CALL.ends_at },
	});
	assertEquals(graphCopy(call, "https://app.example.test"), {
		subject: "A call on Projective",
		body: { contentType: "text", content: address },
		showAs: "busy",
		isAllDay: false,
		start: { dateTime: "2026-11-05T09:00:00", timeZone: "UTC" },
		end: { dateTime: "2026-11-05T10:00:00", timeZone: "UTC" },
	});
});

Deno.test("a call with no room goes out as a title and a time", () => {
	const call = { ...CALL, room_slug: null };
	assertEquals(googleCopy(call, "https://app.example.test").description, "");
	assertEquals(graphCopy(call, "https://app.example.test").body.content, "");
});
// #endregion

// #region Reading
Deno.test("sync: an incremental read uses the cursor alone and lands in one call", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim()]),
			provider: () =>
				json({
					items: [
						{
							id: "kept",
							summary: "Salary talk",
							start: { dateTime: "2026-11-05T09:00:00Z" },
							end: { dateTime: "2026-11-05T10:00:00Z" },
						},
						{ id: "went", status: "cancelled" },
					],
					nextSyncToken: "cursor-2",
				}),
		}, async (calls) => {
			const res = await Service.syncDue();
			assertEquals(res.data, { claimed: 1, done: 1, expired: 0, failed: 0 });
			const [read] = named(calls, GOOGLE_EVENTS);
			assertEquals(read.headers.get("authorization"), "Bearer the-access");
			assertEquals(read.url.searchParams.get("syncToken"), "cursor-1");
			assertEquals(read.url.searchParams.get("singleEvents"), "true");
			assertFalse(read.url.searchParams.has("timeMin"), "timeMin is incompatible with syncToken");
			const fields = read.url.searchParams.get("fields") ?? "";
			for (
				const wanted of [
					"summary",
					"location",
					"description",
					"recurringEventId",
					"hangoutLink",
					"conferenceData",
				]
			) {
				assert(fields.includes(wanted));
			}
			assertFalse(fields.includes("attendees"));
			const [apply] = named(calls, "integrations.rpc.fn_apply_busy_sync");
			assertEquals(apply.json.p_full, false);
			assertEquals(apply.json.p_cursor, "cursor-2");
			assertEquals(apply.json.p_claimed_at, CLAIMED);
			assertEquals(apply.json.p_gone, ["went"]);
			assertEquals(apply.json.p_busy, [{
				id: "kept",
				title: "Salary talk",
				starts_at: "2026-11-05T09:00:00.000Z",
				ends_at: "2026-11-05T10:00:00.000Z",
			}]);
		})
	));

Deno.test("sync: a series' repeat is read once from its master, and a miss costs only the sentence", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim()]),
			provider: (call) => {
				if (call.url.pathname.endsWith("/events/daily")) {
					return json({ recurrence: ["RRULE:FREQ=DAILY"] });
				}
				if (call.url.pathname.endsWith("/events/broken")) return json({}, 500);
				const at = (id: string, day: number, recurringEventId?: string) => ({
					id,
					recurringEventId,
					start: { dateTime: `2026-11-0${day}T09:00:00Z` },
					end: { dateTime: `2026-11-0${day}T10:00:00Z` },
				});
				return json({
					items: [at("d1", 5, "daily"), at("d2", 6, "daily"), at("b1", 7, "broken"), at("one", 8)],
					nextSyncToken: "cursor-2",
				});
			},
		}, async (calls) => {
			assertEquals((await Service.syncDue()).data?.done, 1);
			assertEquals(named(calls, `${GOOGLE_EVENTS}/daily`).length, 1);
			assertEquals(
				named(calls, `${GOOGLE_EVENTS}/daily`)[0].url.searchParams.get("fields"),
				"recurrence",
			);
			const [apply] = named(calls, "integrations.rpc.fn_apply_busy_sync");
			assertEquals(
				apply.json.p_busy.map((
					b: { id: string; recurrence_rule?: string },
				) => [b.id, b.recurrence_rule]),
				[["d1", "FREQ=DAILY"], ["d2", "FREQ=DAILY"], ["b1", undefined], ["one", undefined]],
			);
		})
	));

Deno.test("sync: a first read covers the window and is a full one", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim({ cursor: null })]),
			provider: (call) =>
				call.url.searchParams.get("pageToken")
					? json({ items: [], nextSyncToken: "cursor-1" })
					: json({ items: [], nextPageToken: "page-2" }),
		}, async (calls) => {
			await Service.syncDue();
			const reads = named(calls, GOOGLE_EVENTS);
			assertEquals(reads.length, 2, "it pages to the end before anything lands");
			assert(
				reads.every((r) =>
					r.url.searchParams.has("timeMin") && !r.url.searchParams.has("syncToken")
				),
			);
			assertEquals(named(calls, "integrations.rpc.fn_apply_busy_sync")[0].json.p_full, true);
		})
	));

Deno.test("sync: Google's 410 throws the cursor away and reads the window whole", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim()]),
			provider: (call) =>
				call.url.searchParams.has("syncToken")
					? json({ error: { code: 410 } }, 410)
					: json({ items: [], nextSyncToken: "fresh" }),
		}, async (calls) => {
			assertEquals((await Service.syncDue()).data?.done, 1);
			const reads = named(calls, GOOGLE_EVENTS);
			assertEquals(reads.length, 2);
			assert(reads[0].url.searchParams.has("syncToken"));
			assert(reads[1].url.searchParams.has("timeMin"));
			const [apply] = named(calls, "integrations.rpc.fn_apply_busy_sync");
			assertEquals(apply.json.p_full, true);
			assertEquals(apply.json.p_cursor, "fresh");
			assertEquals(named(calls, "integrations.rpc.fn_release_calendar_sync").length, 0);
		})
	));

Deno.test("sync: an expired delta link on Graph does the same, and the new link is the cursor", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [
				syncClaim({
					provider_slug: "outlook",
					cursor: "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=old",
				}),
			]),
			provider: (call) => {
				if (call.url.searchParams.has("$deltatoken")) return json({}, 410);
				if (call.url.searchParams.has("$skiptoken")) {
					return json({
						value: [{ id: "g", "@removed": { reason: "deleted" } }],
						"@odata.deltaLink":
							"https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=new",
					});
				}
				return json({
					value: [{
						id: "h",
						subject: "Salary talk",
						start: { dateTime: "2026-11-05T09:00:00.0000000" },
						end: { dateTime: "2026-11-05T10:00:00.0000000" },
					}],
					"@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=2",
				});
			},
		}, async (calls) => {
			assertEquals((await Service.syncDue()).data?.done, 1);
			const reads = named(calls, GRAPH_DELTA);
			assertEquals(reads.length, 3);
			assert(reads[1].url.searchParams.has("startDateTime"));
			const [apply] = named(calls, "integrations.rpc.fn_apply_busy_sync");
			assertEquals(apply.json.p_full, true);
			assertStringIncludes(apply.json.p_cursor, "$deltatoken=new");
			assertEquals(apply.json.p_busy.map((b: { title: string }) => b.title), ["Salary talk"]);
		})
	));

Deno.test("sync: a paging link that leaves Graph is not followed with a token", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim({ provider_slug: "outlook", cursor: null })]),
			provider: () => json({ value: [], "@odata.nextLink": "https://evil.example/steal" }),
		}, async (calls) => {
			assertEquals((await Service.syncDue()).data?.failed, 1);
			assertEquals(toProvider(calls).length, 1);
			assertEquals(calls.some((c) => c.host === "evil.example"), false);
			assertEquals(named(calls, "integrations.rpc.fn_apply_busy_sync").length, 0);
		})
	));

Deno.test("sync: a refusal is recorded in the provider's words only, and one bad calendar stops nothing", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [
				syncClaim(),
				syncClaim({ resource: "calendar:other", cursor: "cursor-2" }),
			]),
			provider: (call) =>
				call.url.searchParams.get("syncToken") === "cursor-1"
					? json({ error: { message: "the-access is bad" } }, 403)
					: json({ items: [], nextSyncToken: "x" }),
		}, async (calls) => {
			const res = await Service.syncDue();
			assertEquals(res.data, { claimed: 2, done: 1, expired: 0, failed: 1 });
			const released = named(calls, "integrations.rpc.fn_release_calendar_sync");
			assertEquals(released.length, 1);
			assertEquals(released[0].json.p_error, "google answered 403");
			assertEquals(released[0].json.p_claimed_at, CLAIMED);
			assertEquals(
				named(calls, "integrations.rpc.fn_apply_busy_sync")[0].json.p_resource,
				"calendar:other",
			);
		})
	));

Deno.test("sync: no token to hand gives the claim back with no error and calls no provider", () =>
	world({
		db: syncDb({} as ConnectionSecretRow, [syncClaim()], {
			"integrations.rpc.fn_claim_connection_token": () => ({ busy: true }),
		}),
	}, async (calls) => {
		assertEquals((await Service.syncDue()).data?.failed, 1);
		assertEquals(toProvider(calls).length, 0);
		assertEquals(named(calls, "integrations.rpc.fn_release_calendar_sync")[0].json.p_error, null);
	}));

Deno.test("sync: a calendar with no channel gets one, on a token of its own", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [syncClaim({ has_channel: false })], {
				"integrations.rpc.fn_register_channel": () => true,
			}),
			provider: (call) =>
				call.url.pathname.endsWith("/watch")
					? json({ id: "channel-1", resourceId: "resource-1", expiration: "1893456000000" })
					: json({ items: [], nextSyncToken: "x" }),
		}, async (calls) => {
			await Service.syncDue();
			const [watch] = named(calls, `${GOOGLE_EVENTS}/watch`);
			assertEquals(watch.json.address, "https://app.example.test/api/integrations/webhooks/google");
			assert(watch.json.token.length >= 32);
			const [registered] = named(calls, "integrations.rpc.fn_register_channel");
			assertEquals(registered.json.p_external_channel_id, "channel-1");
			assertEquals(registered.json.p_verification_token, watch.json.token);
		})
	));

Deno.test("sync: a Graph channel asks for changes on the mailbox's events, with its lifecycle too", () =>
	withSecret((secret) =>
		world({
			db: syncDb(secret, [
				syncClaim({ provider_slug: "outlook", cursor: null, has_channel: false }),
			], {
				"integrations.rpc.fn_register_channel": () => true,
			}),
			provider: (call) =>
				call.url.pathname === "/v1.0/subscriptions"
					? json({ id: "sub-1", expirationDateTime: "2026-11-06T00:00:00Z" })
					: json({
						value: [],
						"@odata.deltaLink": "https://graph.microsoft.com/v1.0/d?$deltatoken=x",
					}),
		}, async (calls) => {
			await Service.syncDue();
			const [created] = named(calls, "/v1.0/subscriptions");
			assertEquals(created.json.resource, "/me/events");
			assertEquals(created.json.lifecycleNotificationUrl, created.json.notificationUrl);
			assertEquals(
				named(calls, "integrations.rpc.fn_register_channel")[0].json.p_verification_token,
				created.json.clientState,
			);
		})
	));

Deno.test("sync: a channel that will not open leaves the read standing, and a plain http app opens none", () =>
	withSecret(async (secret) => {
		await world({
			db: syncDb(secret, [syncClaim({ has_channel: false })]),
			provider: (call) =>
				call.url.pathname.endsWith("/watch")
					? json({}, 403)
					: json({ items: [], nextSyncToken: "x" }),
		}, async (calls) => {
			assertEquals((await Service.syncDue()).data?.done, 1);
			assertEquals(named(calls, "integrations.rpc.fn_release_calendar_sync").length, 0);
		});
		await world({
			env: { APP_URL: "http://localhost:3000" },
			db: syncDb(secret, [syncClaim({ has_channel: false })]),
			provider: () => json({ items: [], nextSyncToken: "x" }),
		}, async (calls) => {
			await Service.syncDue();
			assertEquals(named(calls, `${GOOGLE_EVENTS}/watch`).length, 0);
		});
	}));

Deno.test("sync: refused while the integrations gate is off", () =>
	world({ env: { INTEGRATIONS_BACKEND_LIVE: "false" } }, async (calls) => {
		assertEquals((await Service.syncDue()).status, 503);
		assertEquals((await Service.pushDue()).status, 503);
		assertEquals(calls.length, 0);
	}));
// #endregion

// #region Writing
Deno.test("push: the calendar is made once for a batch, and each copy lands on a known id", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [
				mirrorClaim({ calendar_id: null }),
				mirrorClaim({ calendar_id: null, mirror_id: MIRROR_B }),
			], { "integrations.rpc.fn_set_outbound_calendar": () => "out-cal" }),
			provider: (call) =>
				call.url.pathname === "/calendar/v3/calendars"
					? json({ id: "made-here" })
					: json({ id: call.json.id, etag: "etag-1" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 2);
			const made = named(calls, "/calendar/v3/calendars");
			assertEquals(made.length, 1);
			assertEquals(made[0].json.summary, "Projective");
			assertEquals(
				named(calls, "integrations.rpc.fn_set_outbound_calendar")[0].json.p_calendar_id,
				"made-here",
			);
			const inserts = named(calls, OUT_EVENTS);
			assertEquals(inserts[0].json.id, MIRROR.replaceAll("-", ""));
			assertEquals(inserts[1].json.id, MIRROR_B.replaceAll("-", ""));
			const [finished] = named(calls, "scheduling.rpc.finish_event_mirror");
			assertEquals(finished.json.p_external_event_id, MIRROR.replaceAll("-", ""));
			assertEquals(finished.json.p_version, "etag-1");
			assertEquals(finished.json.p_dirty_at, DIRTY);
			assertEquals(finished.json.p_claimed_at, CLAIMED);
		})
	));

Deno.test("push: a retry after a lost answer finds the copy there and replaces it, once", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim()]),
			provider: (call) =>
				call.method === "POST"
					? json({ error: "duplicate" }, 409)
					: json({ id: "x", etag: "etag-2" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 1);
			const id = MIRROR.replaceAll("-", "");
			assertEquals(named(calls, `${OUT_EVENTS}/${id}`)[0].method, "PUT");
			assertEquals(named(calls, OUT_EVENTS).length, 1);
		})
	));

Deno.test("push: a copy deleted at the provider comes back on the next change", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim({ external_event_id: "known-id", version: "etag-1" })]),
			provider: (call) =>
				call.method === "PUT" ? json({}, 404) : json({ id: "known-id", etag: "etag-2" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 1);
			assertEquals(named(calls, OUT_EVENTS)[0].json.id, "known-id");
		})
	));

Deno.test("push: a Graph create is idempotent, and a change is a PATCH that overwrites", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [
				mirrorClaim({ provider_slug: "outlook" }),
				mirrorClaim({
					provider_slug: "outlook",
					mirror_id: MIRROR_B,
					external_event_id: "AAMk=/1",
				}),
			]),
			provider: () => json({ id: "AAMk=/1", changeKey: "ck-1" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 2);
			const [create] = named(calls, "/v1.0/me/calendars/out-cal/events");
			assertEquals(create.json.transactionId, MIRROR);
			const patch = calls.find((c) => c.method === "PATCH")!;
			assertEquals(patch.url.pathname, "/v1.0/me/events/AAMk%3D%2F1");
			assertEquals(
				patch.headers.get("if-match"),
				null,
				"a provider edit is overwritten, never compared",
			);
			assertEquals(named(calls, "scheduling.rpc.finish_event_mirror")[0].json.p_version, "ck-1");
		})
	));

Deno.test("push: a Graph copy deleted at the provider is made under a new transaction", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [
				mirrorClaim({ provider_slug: "outlook", external_event_id: "AAMk", version: "ck-1" }),
			]),
			provider: (call) =>
				call.method === "PATCH" ? json({}, 404) : json({ id: "AAMl", changeKey: "ck-2" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 1);
			const [create] = named(calls, "/v1.0/me/calendars/out-cal/events");
			assert(create.json.transactionId !== MIRROR);
			assertEquals(create.json.transactionId.length, 64);
		})
	));

Deno.test("push: an event that went takes its copy with it, and one already gone is not a failure", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [
				mirrorClaim({ event: null, external_event_id: "gone-1" }),
				mirrorClaim({ event: null, mirror_id: MIRROR_B, external_event_id: "gone-2" }),
			]),
			provider: (call) =>
				call.url.pathname.endsWith("gone-2") ? json({}, 410) : new Response(null, { status: 204 }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 2);
			assertEquals(toProvider(calls).map((c) => c.method), ["DELETE", "DELETE"]);
			const finished = named(calls, "scheduling.rpc.finish_event_mirror");
			assertEquals(finished[0].json.p_external_event_id, null);
			assertEquals(finished[1].json.p_external_event_id, null);
		})
	));

Deno.test("push: an agreed call goes out on the one queue, and one that moved or went comes off", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [
				mirrorClaim({ event: CALL }),
				mirrorClaim({ event: null, mirror_id: MIRROR_B, external_event_id: "moved-call" }),
			]),
			provider: (call) =>
				call.method === "DELETE"
					? new Response(null, { status: 204 })
					: json({ id: call.json.id, etag: "etag-1" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 2);
			const [written] = named(calls, OUT_EVENTS);
			assertEquals(written.json.summary, "A call on Projective");
			assertStringIncludes(written.json.description, "/meet/rom-abcdefghjk");
			assertEquals(named(calls, `${OUT_EVENTS}/moved-call`)[0].method, "DELETE");
			assertEquals(
				named(calls, "scheduling.rpc.finish_event_mirror").map((c) => c.json.p_external_event_id),
				[MIRROR.replaceAll("-", ""), null],
			);
		})
	));

Deno.test("push: a copy never written has nothing to remove, and a calendar is not made for it", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim({ event: null, calendar_id: null })]),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.done, 1);
			assertEquals(toProvider(calls).length, 0);
			assertEquals(named(calls, "scheduling.rpc.finish_event_mirror").length, 1);
		})
	));

Deno.test("push: a Projective calendar the person deleted is forgotten and everything queued again", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim(), mirrorClaim({ mirror_id: MIRROR_B })], {
				"integrations.rpc.fn_reset_outbound_calendar": () => null,
			}),
			provider: () => json({}, 404),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data?.failed, 1);
			assertEquals(named(calls, "integrations.rpc.fn_reset_outbound_calendar").length, 1);
			assertEquals(
				named(calls, OUT_EVENTS).length,
				1,
				"the reset took the rest of the batch with it",
			);
			assertEquals(named(calls, "scheduling.rpc.fail_event_mirror").length, 0);
		})
	));

Deno.test("push: a refusal backs one copy off in the provider's words, and the next still goes", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim(), mirrorClaim({ mirror_id: MIRROR_B })]),
			provider: (call) =>
				call.json.id === MIRROR.replaceAll("-", "")
					? json({ error: "the-access" }, 429)
					: json({ id: "b", etag: "e" }),
		}, async (calls) => {
			assertEquals((await Service.pushDue()).data, { claimed: 2, done: 1, expired: 0, failed: 1 });
			const [failed] = named(calls, "scheduling.rpc.fail_event_mirror");
			assertEquals(failed.json.p_error, "google answered 429");
			assertEquals(failed.json.p_mirror, MIRROR);
		})
	));

Deno.test("push: with no token the claims are left to lapse and no copy is marked failed", () =>
	world({
		db: pushDb({} as ConnectionSecretRow, [mirrorClaim()], {
			"integrations.rpc.fn_claim_connection_token": () => null,
		}),
	}, async (calls) => {
		assertEquals((await Service.pushDue()).data?.failed, 1);
		assertEquals(toProvider(calls).length, 0);
		assertEquals(named(calls, "scheduling.rpc.fail_event_mirror").length, 0);
		assertEquals(named(calls, "scheduling.rpc.finish_event_mirror").length, 0);
	}));

Deno.test("push: a name a person already uses on Outlook is left to them", () =>
	withSecret((secret) =>
		world({
			db: pushDb(secret, [mirrorClaim({ provider_slug: "outlook", calendar_id: null })], {
				"integrations.rpc.fn_set_outbound_calendar": () => "ours",
			}),
			provider: (call) => {
				if (call.url.pathname !== "/v1.0/me/calendars") return json({ id: "x", changeKey: "k" });
				return call.json.name === "Projective" ? json({}, 409) : json({ id: "ours" });
			},
		}, async (calls) => {
			await Service.pushDue();
			assertEquals(named(calls, "/v1.0/me/calendars").map((c) => c.json.name), [
				"Projective",
				"Projective events",
			]);
			assertEquals(calls.some((c) => c.method === "GET" && c.host !== "postgrest.fake"), false);
		})
	));
// #endregion
