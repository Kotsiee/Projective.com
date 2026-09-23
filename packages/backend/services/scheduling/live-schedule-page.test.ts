import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import { readSchedulePage, type SchedulePageMeta } from "./live-schedule-page.ts";

/**
 * The PUBLIC schedule page — `/[handle]/availability` and a session listing's schedule — tested for
 * what it may never disclose.
 *
 * These are the platform's most exposed calendar reads: guest-reachable pages about OTHER people. The
 * page is built from bare busy spans (`scheduling.get_free_busy`) and the published bands, so a
 * roster, a room, a price or a negotiation has no field to arrive through. That is a property of the
 * CONSTRUCTION, and these tests pin it against a stub client, so they need no database and run where
 * every other unit test runs.
 */

// #region Stub client
interface Answers {
	tables: Record<string, unknown>;
	rpc: Record<string, unknown>;
	/** A table or RPC name whose read fails, to prove a failure is never passed off as an answer. */
	fail?: string;
}

/**
 * A client that answers each table or RPC with a fixed result, whatever the query chain in front of
 * it. Every builder method returns the builder, and the builder is thenable, so it answers both
 * `await …maybeSingle()` and a plain `await …order()` the way PostgREST does.
 */
function stubClient(answers: Answers): SupabaseClient {
	const resultFor = (name: string, value: unknown) =>
		answers.fail === name
			? { data: null, error: { message: `${name} is unavailable` } }
			: { data: value ?? null, error: null };

	const query = (table: string) => {
		const result = resultFor(table, answers.tables[table]);
		const chain: Record<string, unknown> = {};
		for (const method of ["select", "eq", "neq", "lt", "gt", "in", "order"]) {
			chain[method] = () => chain;
		}
		chain.maybeSingle = () => Promise.resolve(result);
		chain.then = (
			resolve: (value: unknown) => unknown,
			reject: (reason: unknown) => unknown,
		) => Promise.resolve(result).then(resolve, reject);
		return chain;
	};

	const schema = {
		from: (table: string) => query(table),
		rpc: (name: string) => Promise.resolve(resultFor(name, answers.rpc[name])),
	};
	return { schema: () => schema } as unknown as SupabaseClient;
}
// #endregion

// #region Fixture rows
const NOW = Date.parse("2026-09-23T09:00:00Z");
const OWNER = { type: "user" as const, id: "00000000-0000-4000-8000-000000000001" };
const META: SchedulePageMeta = {
	scope: "availability",
	title: "Availability",
	subtitle: null,
	ownerHandle: "@fern",
	viewerCanBook: false,
	now: NOW,
};
const WINDOW = { from: NOW - 14 * 86_400_000, to: NOW + 90 * 86_400_000 };

/** A published schedule with one busy span, one public and one private blackout, and two bands. */
function publishedSchedule(overrides: Partial<Answers> = {}): Answers {
	return {
		tables: {
			schedules: { id: "sched-1", timezone: "Europe/Dublin", is_published: true },
			availability_rules: [
				{ weekday: 1, start_minute: 540, end_minute: 1020, kind: "working_hours" },
				{ weekday: 1, start_minute: 600, end_minute: 720, kind: "call_window" },
			],
			blackout_dates: [
				{
					starts_at: "2026-10-05T00:00:00Z",
					ends_at: "2026-10-07T00:00:00Z",
					label: "Surgery recovery",
					label_is_public: false,
				},
				{
					starts_at: "2026-10-12T00:00:00Z",
					ends_at: "2026-10-13T00:00:00Z",
					label: "Conference",
					label_is_public: true,
				},
			],
			call_settings: null,
			call_platforms: [],
			...overrides.tables,
		},
		rpc: {
			get_free_busy: [{ starts_at: "2026-09-28T13:00:00Z", ends_at: "2026-09-28T15:00:00Z" }],
			...overrides.rpc,
		},
		fail: overrides.fail,
	};
}
// #endregion

Deno.test("public schedule — every commitment is a bare busy span, and nothing more", async () => {
	const page = await readSchedulePage(OWNER, META, WINDOW, stubClient(publishedSchedule()));
	assert(page, "expected a page for a published schedule");
	assertStrictEquals(page!.events.length, 1);

	// The exact key set: a field that is not here cannot leak, whatever a later change adds upstream.
	for (const event of page!.events) {
		assertEquals(
			Object.keys(event).sort(),
			["end", "id", "kind", "masked", "start", "status", "title"],
			`${event.id} carries more than a masked span`,
		);
		assertStrictEquals(event.masked, true);
		assertStrictEquals(event.kind, "busy");
		assertStrictEquals(event.title, "Busy");
	}

	const body = JSON.stringify(page);
	for (
		const secret of ["roster", "meeting", "pricing", "joinUrl", "reschedule", "history", "Surgery"]
	) {
		assertStrictEquals(body.includes(secret), false, `the public page contains ${secret}`);
	}
});

Deno.test("public schedule — a blackout's span is public, its label only when the owner said so", async () => {
	const page = await readSchedulePage(OWNER, META, WINDOW, stubClient(publishedSchedule()));
	const labels = page!.availability.blackouts.map((b) => b.label);
	assertEquals(labels, ["Unavailable", "Conference"]);
	// The span itself survives: "the provider is away then" is exactly what a visitor needs to know.
	assertStrictEquals(page!.availability.blackouts[0].start, Date.parse("2026-10-05T00:00:00Z"));
});

Deno.test("public schedule — working hours and call windows stay two different claims", async () => {
	const page = await readSchedulePage(OWNER, META, WINDOW, stubClient(publishedSchedule()));
	assertEquals(page!.availability.rules.map((r) => r.kind), ["working_hours", "call_window"]);
	assertStrictEquals(page!.availability.timezone, "Europe/Dublin");
	assertStrictEquals(page!.timezone, "Europe/Dublin");
});

Deno.test("public schedule — the page carries the instant it was resolved against", async () => {
	// The week the calendar opens on and the clock its labels are measured by. Without it the island
	// falls back to a clock of its own, and the SSR paint and the hydrated grid disagree.
	const page = await readSchedulePage(OWNER, META, WINDOW, stubClient(publishedSchedule()));
	assertStrictEquals(page!.now, NOW);
});

Deno.test("public schedule — no call settings is no call offer, not an empty one", async () => {
	const page = await readSchedulePage(OWNER, META, WINDOW, stubClient(publishedSchedule()));
	assertStrictEquals(page!.callOffer, undefined);
});

Deno.test("public schedule — an unpublished schedule is no page at all", async () => {
	const draft = publishedSchedule({
		tables: { schedules: { id: "sched-1", timezone: "Europe/Dublin", is_published: false } },
	});
	assertStrictEquals(await readSchedulePage(OWNER, META, WINDOW, stubClient(draft)), null);
	// And an owner with no schedule row at all reads the same way.
	const none = publishedSchedule({ tables: { schedules: null } });
	assertStrictEquals(await readSchedulePage(OWNER, META, WINDOW, stubClient(none)), null);
});

Deno.test("public schedule — a failed read is reported, never rendered as an empty week", async () => {
	for (const fail of ["schedules", "availability_rules", "blackout_dates", "get_free_busy"]) {
		const page = await readSchedulePage(
			OWNER,
			META,
			WINDOW,
			stubClient(publishedSchedule({ fail })),
		);
		assertStrictEquals(page, undefined, `a failed ${fail} read produced a page`);
	}
});
