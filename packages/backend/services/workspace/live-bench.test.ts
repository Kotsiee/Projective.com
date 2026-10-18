/**
 * The bench read's pure seam (`toBenchEntry`) and its one-RPC contract (`readBench`), without a
 * database: the RPC is stubbed on {@link benchIo}.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { BusinessBenchSchema } from "@projective/types/workspace";
import { fail } from "../ServiceResult.ts";
import {
	benchIo,
	type RawBenchAnswer,
	type RawBenchEntry,
	readBench,
	toBenchEntry,
} from "./live-bench.ts";
import type { LiveActor } from "./live-support.ts";

const NOW = Date.parse("2026-10-17T12:00:00Z");

// #region Fixtures
/** A raw freelancer row as the definer answers it; avatar-less so no storage host is needed. */
function rawFreelancer(over: Partial<RawBenchEntry> = {}): RawBenchEntry {
	return {
		kind: "freelancer",
		handle: "marisdelacroix",
		name: "Maris Delacroix",
		avatar_bucket: null,
		avatar_path: null,
		contact_handle: "marisdelacroix",
		contact_name: "Maris Delacroix",
		engagements: 2,
		live_now: false,
		last_worked_at: "2026-10-02T14:14:10.69081+00:00",
		rating_average: "4.666",
		rating_count: 3,
		profile_visible: true,
		viewer_manages: false,
		...over,
	};
}

/** A raw team row: its Message reaches the owner. */
function rawTeam(over: Partial<RawBenchEntry> = {}): RawBenchEntry {
	return {
		kind: "team",
		handle: "ateliernova",
		name: "Atelier Nova",
		avatar_bucket: null,
		avatar_path: null,
		contact_handle: "inesduarte",
		contact_name: "Inês Duarte",
		engagements: 1,
		live_now: true,
		last_worked_at: null,
		rating_average: null,
		rating_count: 0,
		profile_visible: true,
		viewer_manages: false,
		...over,
	};
}

const ACTOR = {
	userId: "u-owner",
	contextId: "",
	contextType: "personal",
	accessToken: "test",
} as unknown as LiveActor;
// #endregion

// #region toBenchEntry
Deno.test("toBenchEntry: a freelancer row — handle, name, contact, and the rating to 2 dp", () => {
	const entry = toBenchEntry(rawFreelancer(), NOW);
	assert(entry);
	assertEquals(entry.kind, "freelancer");
	assertEquals(entry.handle, "marisdelacroix");
	assertEquals(entry.name, "Maris Delacroix");
	assertEquals(entry.contact, { handle: "marisdelacroix", name: "Maris Delacroix" });
	assertEquals(entry.engagements, 2);
	assertEquals(entry.rating, { average: 4.67, count: 3 });
	assertEquals(entry.lastWorkedAt, "2026-10-02T14:14:10.690Z");
});

Deno.test("toBenchEntry: a team row's Message reaches its owner", () => {
	const entry = toBenchEntry(rawTeam(), NOW);
	assert(entry);
	assertEquals(entry.kind, "team");
	assertEquals(entry.contact, { handle: "inesduarte", name: "Inês Duarte" });
});

Deno.test("toBenchEntry: no reviews is a null average, never a zero", () => {
	assertEquals(toBenchEntry(rawTeam(), NOW)?.rating, { average: null, count: 0 });
	assertEquals(
		toBenchEntry(rawFreelancer({ rating_average: "4.5", rating_count: 0 }), NOW)?.rating,
		{ average: null, count: 0 },
	);
});

Deno.test("toBenchEntry: last worked reads Now while working, a date after, a dash when undated", () => {
	assertEquals(toBenchEntry(rawFreelancer({ live_now: true }), NOW)?.lastWorkedLabel, "Now");
	assertEquals(toBenchEntry(rawFreelancer(), NOW)?.lastWorkedLabel, "2 Oct");
	assertEquals(
		toBenchEntry(rawFreelancer({ last_worked_at: "2025-03-04T00:00:00Z" }), NOW)?.lastWorkedLabel,
		"4 Mar 2025",
	);
	assertEquals(
		toBenchEntry(rawFreelancer({ last_worked_at: null, live_now: false }), NOW)?.lastWorkedLabel,
		"–",
	);
});

Deno.test("toBenchEntry: the caller's profile flags ride the row; only an explicit true opens a link", () => {
	const open = toBenchEntry(rawTeam(), NOW);
	assertEquals([open?.profileVisible, open?.viewerManages], [true, false]);
	const managed = toBenchEntry(rawTeam({ viewer_manages: true }), NOW);
	assertEquals(managed?.viewerManages, true);
	const hidden = toBenchEntry(rawTeam({ profile_visible: false }), NOW);
	assertEquals(hidden?.profileVisible, false);
	const drifted = toBenchEntry(rawTeam({ profile_visible: null, viewer_manages: null }), NOW);
	assertEquals([drifted?.profileVisible, drifted?.viewerManages], [false, false]);
});

Deno.test("toBenchEntry: a drifted row is dropped, not repaired", () => {
	assertStrictEquals(toBenchEntry(rawFreelancer({ handle: null }), NOW), null);
	assertStrictEquals(toBenchEntry(rawFreelancer({ engagements: 0 }), NOW), null);
	assertStrictEquals(toBenchEntry(rawFreelancer({ kind: "business" }), NOW), null);
});

Deno.test("toBenchEntry: no avatar object is an empty avatar (initials); a nameless party shows its handle", () => {
	const entry = toBenchEntry(rawFreelancer({ name: "  ", contact_name: null }), NOW);
	assertEquals(entry?.avatar, "");
	assertEquals(entry?.name, "marisdelacroix");
	assertEquals(entry?.contact?.name, "marisdelacroix");
	assertEquals(toBenchEntry(rawTeam({ contact_handle: null }), NOW)?.contact, null);
});
// #endregion

// #region readBench
async function readWith(answer: RawBenchAnswer | null) {
	const rpc = stub(
		benchIo,
		"rpc",
		(() => Promise.resolve({ ok: true, data: answer })) as unknown as typeof benchIo.rpc,
	);
	try {
		const res = await readBench("heliafinance", ACTOR, NOW);
		return { res, calls: rpc.calls.length, args: rpc.calls[0]?.args };
	} finally {
		rpc.restore();
	}
}

Deno.test("readBench: one RPC — get_business_bench by handle — and a schema-valid bench", async () => {
	const { res, calls, args } = await readWith({
		status: "ok",
		entries: [rawFreelancer({ live_now: true }), rawTeam(), rawFreelancer({ handle: null })],
	});
	assertEquals(calls, 1);
	assertEquals(args?.slice(1), ["org", "get_business_bench", { p_handle: "heliafinance" }]);
	assertEquals(res.status, 200);
	assertEquals(res.data?.entries.map((e) => e.handle), ["marisdelacroix", "ateliernova"]);
	BusinessBenchSchema.parse(res.data);
});

Deno.test("readBench: an empty bench is an empty list", async () => {
	const { res } = await readWith({ status: "ok", entries: null });
	assertEquals(res.data, { entries: [] });
});

Deno.test("readBench: not_found is 404, forbidden is 403", async () => {
	assertEquals((await readWith({ status: "not_found" })).res.status, 404);
	assertEquals((await readWith(null)).res.status, 404);
	const forbidden = (await readWith({ status: "forbidden" })).res;
	assertEquals(forbidden.status, 403);
	assertEquals(forbidden.message, "Only members who can hire see the bench.");
});

Deno.test("readBench: a database refusal passes straight through", async () => {
	const refusal = fail(401, { message: "Your session has expired. Sign in again." });
	const rpc = stub(
		benchIo,
		"rpc",
		(() => Promise.resolve({ ok: false, refusal })) as unknown as typeof benchIo.rpc,
	);
	try {
		const res = await readBench("heliafinance", ACTOR, NOW);
		assertStrictEquals(res, refusal);
		assertEquals(rpc.calls.length, 1);
	} finally {
		rpc.restore();
	}
});
// #endregion
