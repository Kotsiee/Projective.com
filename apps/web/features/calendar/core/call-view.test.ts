import { assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { callViewOf } from "./call-view.ts";

const NOW = 1_800_000_000_000;

function call(over: Partial<CalendarEvent>): CalendarEvent {
	return {
		id: "call-1",
		title: "Call with Sam",
		kind: "booking",
		start: NOW + 86_400_000,
		end: NOW + 88_200_000,
		callId: "1",
		callStatus: "proposed",
		callSide: "host",
		callMoves: ["confirm", "propose", "decline"],
		...over,
	} as CalendarEvent;
}

Deno.test("an event that is not a call has no view", () => {
	assertEquals(callViewOf({ ...call({}), callId: undefined }, "auto", NOW), null);
});

Deno.test("the read's moves are shown as they came", () => {
	const view = callViewOf(call({}), "auto", NOW);
	assertEquals(view?.moves, ["confirm", "propose", "decline"]);
	assertEquals(view?.note, "Confirm this time, or offer another.");
});

Deno.test("the lockout is stated before the press", () => {
	const movable = call({ callStatus: "confirmed", callMoves: ["propose", "cancel"] });
	assertEquals(callViewOf(movable, "auto", NOW)?.note, "A new time needs at least 12 hours' notice.");
	const close = call({ callStatus: "confirmed", callMoves: ["cancel"] });
	assertEquals(callViewOf(close, "auto", NOW)?.note, "Too close to move: under 12 hours away.");
});

Deno.test("somebody waiting is told so, until the time has gone", () => {
	const waiting = call({ callSide: "requester", callMoves: ["propose", "cancel"] });
	assertEquals(callViewOf(waiting, "auto", NOW)?.note, "Waiting for the other person to confirm.");
	assertEquals(callViewOf(waiting, "auto", waiting.start + 1)?.note, null);
});

Deno.test("the dev axis replaces the read's answer", () => {
	assertEquals(callViewOf(call({}), "no_show_claimable", NOW)?.moves, ["cancel", "no_show"]);
	assertEquals(callViewOf(call({}), "expired", NOW)?.moves, []);
});
