import { assert, assertEquals } from "@std/assert";
import type { BoardCard, BoardStageRef } from "@projective/types/projects";
import type { MenuItem } from "@ui/types/mod.ts";
import { newTicketCard } from "./ticket-model.ts";
import {
	LAST_STAGE_REFUSAL,
	pipelineLocks,
	removalRefusal,
	STAGE_CAP_REFUSAL,
	type StageMenuActions,
	stageMenuModel,
	type StageMenuPeer,
	stagePhases,
} from "./stage-menu.ts";

function stageOf(n: number): BoardStageRef {
	return {
		id: `stg-${n}`,
		slug: `stg-slug-${n}`,
		name: `Stage ${n}`,
		order: n,
		status: "active",
		locked: false,
		description: "",
		unitPriceCents: 10_000,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		funding: null,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		chainReaction: true,
		startAt: null,
		endAt: null,
		dependsOnStageId: null,
	};
}

const STAGES = [stageOf(0), stageOf(1), stageOf(2), stageOf(3)];

/** A four-stage ticket whose stage 2 runs alongside stage 1. */
function ticket(over: Partial<BoardCard> = {}): BoardCard {
	const base = newTicketCard(null, STAGES, "GBP", null, { selectAllStages: true });
	return {
		...base,
		stages: base.stages.map((s) => (s.stageId === "stg-2" ? { ...s, parallel: true } : s)),
		...over,
	};
}

const noop: StageMenuActions = {
	configure: () => {},
	move: () => {},
	groupWith: () => {},
	sequential: () => {},
	include: () => {},
	remove: () => {},
};

const keys = (rows: MenuItem[]) => rows.filter((r) => !r.separator).map((r) => r.key);
const row = (rows: MenuItem[], key: string) => rows.find((r) => r.key === key);

Deno.test("stagePhases — the worked band runs, the bands before it are done", () => {
	const phases = stagePhases(ticket({ claimed: true, status: "in_progress", stageId: "stg-2" }));
	assertEquals(Object.fromEntries(phases), {
		"stg-0": "done",
		"stg-1": "running",
		"stg-2": "running",
		"stg-3": "upcoming",
	});
});

Deno.test("stagePhases — completed is done throughout, unrouted is upcoming throughout", () => {
	const done = stagePhases(ticket({ claimed: true, status: "completed", stageId: "stg-3" }));
	assert([...done.values()].every((p) => p === "done"));
	const fresh = stagePhases(ticket());
	assert([...fresh.values()].every((p) => p === "upcoming"));
});

Deno.test("pipelineLocks — an unclaimed ticket locks nothing", () => {
	const locks = pipelineLocks(ticket());
	assertEquals(locks.ticket, null);
	assertEquals(locks.stages.size, 0);
});

Deno.test("pipelineLocks — a claimed ticket locks every stage, upcoming ones included (#291)", () => {
	const locks = pipelineLocks(
		ticket({
			claimed: true,
			status: "claimed",
			stageId: "stg-0",
			assignee: { name: "Ines Duarte", avatar: null, handle: "inesduarte" },
		}),
	);
	assertEquals(
		locks.ticket,
		"Claimed by Ines Duarte. The stages stay as they were when it was claimed.",
	);
	assertEquals(locks.stages.size, 4);
	assert(locks.stages.get("stg-0")?.startsWith("Work on this stage is under way."));
	assert(locks.stages.get("stg-3")?.startsWith("This stage hasn't started"));
});

Deno.test("removalRefusal — the last stage stays, and a lock outranks the count", () => {
	assertEquals(removalRefusal(1, null), LAST_STAGE_REFUSAL);
	assertEquals(removalRefusal(2, null), null);
	assertEquals(removalRefusal(1, "locked"), "locked");
});

/** Peers of a stage in a three-stage ticket, `sameBand` naming who already shares its step. */
function peers(...sameBand: string[]): StageMenuPeer[] {
	return ["stg-a", "stg-b"].map((id) => ({
		stageId: id,
		name: id,
		sameBand: sameBand.includes(id),
	}));
}

Deno.test("stageMenuModel — the first stage offers no Move up but does offer parallel", () => {
	const rows = stageMenuModel(
		{ zone: "included", index: 0, count: 3, peers: peers(), lock: null },
		noop,
	);
	assertEquals(keys(rows), ["stage-configure", "stage-down", "stage-parallel", "stage-remove"]);
	assertEquals(row(rows, "stage-parallel")?.items?.map((i) => i.key), [
		"stage-parallel-stg-a",
		"stage-parallel-stg-b",
	]);
});

Deno.test("stageMenuModel — a grouped stage offers Run sequentially and refuses its own partner", () => {
	const rows = stageMenuModel(
		{ zone: "included", index: 1, count: 3, peers: peers("stg-a"), lock: null },
		noop,
	);
	assertEquals(keys(rows), [
		"stage-configure",
		"stage-up",
		"stage-down",
		"stage-parallel",
		"stage-sequential",
		"stage-remove",
	]);
	const sub = row(rows, "stage-parallel")?.items ?? [];
	assert(sub[0].disabled);
	assertEquals(sub[1].disabled, undefined);
});

Deno.test("stageMenuModel — the only stage keeps Remove, refused with the reason", () => {
	const rows = stageMenuModel(
		{ zone: "included", index: 0, count: 1, peers: [], lock: null },
		noop,
	);
	assertEquals(keys(rows), ["stage-configure", "stage-remove"]);
	assertEquals(row(rows, "stage-remove")?.disabledReason, LAST_STAGE_REFUSAL);
});

Deno.test("stageMenuModel — a locked stage keeps Configure live and refuses the rest", () => {
	const rows = stageMenuModel(
		{ zone: "included", index: 1, count: 3, peers: peers("stg-a"), lock: "locked" },
		noop,
	);
	assertEquals(row(rows, "stage-configure")?.disabled, undefined);
	for (
		const key of ["stage-up", "stage-down", "stage-parallel", "stage-sequential", "stage-remove"]
	) {
		assertEquals(row(rows, key)?.disabledReason, "locked", key);
	}
	assertEquals(row(rows, "stage-parallel")?.items, undefined);
});

Deno.test("stageMenuModel — an available stage offers Include, refused at the cap", () => {
	const open = stageMenuModel({ zone: "available", count: 3, lock: null }, noop);
	assertEquals(keys(open), ["stage-include"]);
	assertEquals(open[0].disabled, undefined);
	const full = stageMenuModel({ zone: "available", count: 50, lock: null }, noop);
	assertEquals(full[0].disabledReason, STAGE_CAP_REFUSAL);
});

Deno.test("stageMenuModel — rows run their commands", () => {
	const calls: string[] = [];
	const run: StageMenuActions = {
		configure: () => calls.push("configure"),
		move: (d) => calls.push(`move:${d}`),
		groupWith: (id) => calls.push(`group:${id}`),
		sequential: () => calls.push("sequential"),
		include: () => calls.push("include"),
		remove: () => calls.push("remove"),
	};
	const rows = stageMenuModel(
		{ zone: "included", index: 1, count: 3, peers: peers("stg-a"), lock: null },
		run,
	);
	const event = { item: rows[0], originalEvent: new Event("click") };
	for (const r of rows) {
		r.command?.(event);
		for (const sub of r.items ?? []) sub.command?.(event);
	}
	assertEquals(calls, [
		"configure",
		"move:-1",
		"move:1",
		"group:stg-a",
		"group:stg-b",
		"sequential",
		"remove",
	]);
});
