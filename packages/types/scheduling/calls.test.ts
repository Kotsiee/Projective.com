import { assert, assertEquals } from "@std/assert";
import { CallActionInputSchema, callMovesFor, type CallMoveFacts } from "./calls.ts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function facts(over: Partial<CallMoveFacts>): CallMoveFacts {
	return {
		status: "proposed",
		side: "host",
		proposedBy: "requester",
		start: NOW + 48 * HOUR,
		end: NOW + 49 * HOUR,
		now: NOW,
		lockoutMs: 12 * HOUR,
		presenceMs: 0.25 * HOUR,
		...over,
	};
}

Deno.test("the counterparty of the last proposal confirms it", () => {
	assert(callMovesFor(facts({ side: "host", proposedBy: "requester" })).includes("confirm"));
	assert(!callMovesFor(facts({ side: "requester", proposedBy: "requester" })).includes("confirm"));
	assert(callMovesFor(facts({ side: "requester", proposedBy: "host" })).includes("confirm"));
	assert(!callMovesFor(facts({ side: "host", proposedBy: "host" })).includes("confirm"));
});

Deno.test("a proposal whose time has gone cannot be confirmed", () => {
	assert(!callMovesFor(facts({ start: NOW - HOUR, end: NOW })).includes("confirm"));
});

Deno.test("the host declines a proposal, and the requester withdraws theirs", () => {
	assertEquals(callMovesFor(facts({ side: "host" })), ["confirm", "propose", "decline"]);
	assertEquals(callMovesFor(facts({ side: "requester" })), ["propose", "cancel"]);
});

Deno.test("a move needs the lockout clear", () => {
	const inside = { start: NOW + 11 * HOUR, end: NOW + 12 * HOUR };
	assert(!callMovesFor(facts(inside)).includes("propose"));
	assert(!callMovesFor(facts({ ...inside, status: "confirmed" })).includes("propose"));
	assert(callMovesFor(facts({ status: "confirmed" })).includes("propose"));
});

Deno.test("a no-show opens after the presence window, on a confirmed call only", () => {
	const running = { start: NOW - HOUR, end: NOW + HOUR, status: "confirmed" as const };
	assertEquals(callMovesFor(facts(running)), ["cancel", "no_show"]);
	assert(!callMovesFor(facts({ ...running, start: NOW - 0.1 * HOUR })).includes("no_show"));
	assert(!callMovesFor(facts({ ...running, status: "proposed" })).includes("no_show"));
});

Deno.test("a call that is over or closed offers nothing", () => {
	for (const status of ["declined", "cancelled", "completed", "no_show", "expired"] as const) {
		assertEquals(callMovesFor(facts({ status })), []);
	}
	assert(!callMovesFor(facts({ status: "confirmed", start: NOW - 2 * HOUR, end: NOW - HOUR }))
		.includes("cancel"));
});

Deno.test("a move's payload is checked per action", () => {
	const callId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
	assert(CallActionInputSchema.safeParse({ action: "confirm", callId }).success);
	assert(CallActionInputSchema.safeParse({ action: "no_show", callId, party: "host" }).success);
	assert(!CallActionInputSchema.safeParse({ action: "no_show", callId, party: "both" }).success);
	assert(!CallActionInputSchema.safeParse({ action: "propose", callId, start: 1 }).success);
	assert(!CallActionInputSchema.safeParse({ action: "decline", callId, reason: "x".repeat(281) }).success);
});
