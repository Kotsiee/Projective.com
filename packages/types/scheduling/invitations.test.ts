import { assertEquals } from "@std/assert";
import {
	awaitsAnswer,
	type ClashEntry,
	detectTimeClash,
	isDeclinedInvitation,
	withClashCounts,
} from "./invitations.ts";

const HOUR = 3_600_000;

function entry(
	id: string,
	startH: number,
	endH: number,
	more: Partial<ClashEntry> = {},
): ClashEntry {
	return { id, title: id, kind: "sync", start: startH * HOUR, end: endH * HOUR, ...more };
}

const titles = (span: { start: number; end: number; excludeId?: string }, all: ClashEntry[]) =>
	detectTimeClash(span, all).clashes.map((c) => c.title);

Deno.test("an overlap clashes, and back to back does not", () => {
	const all = [entry("a", 10, 11)];
	assertEquals(titles({ start: 10.5 * HOUR, end: 11.5 * HOUR }, all), ["a"]);
	assertEquals(titles({ start: 11 * HOUR, end: 12 * HOUR }, all), []);
	assertEquals(titles({ start: 9 * HOUR, end: 10 * HOUR }, all), []);
});

Deno.test("only what holds the reader's time can clash", () => {
	const span = { start: 10 * HOUR, end: 11 * HOUR };
	assertEquals(titles(span, [entry("x", 10, 11, { status: "cancelled" })]), []);
	assertEquals(titles(span, [entry("x", 10, 11, { kind: "availability" })]), []);
	assertEquals(titles(span, [entry("x", 10, 11, { availabilityBehavior: "passive" })]), []);
	assertEquals(titles(span, [entry("x", 10, 11, { userAttendeeStatus: "pending" })]), []);
	assertEquals(titles(span, [entry("x", 10, 11, { userAttendeeStatus: "rejected" })]), []);
	assertEquals(titles(span, [entry("x", 10.5, 10.5, { kind: "deadline" })]), []);
	assertEquals(titles(span, [entry("x", 10, 11, { userAttendeeStatus: "tentative" })]), ["x"]);
	assertEquals(titles(span, [entry("x", 10, 11, { userAttendeeStatus: "accepted" })]), ["x"]);
	assertEquals(titles(span, [entry("x", 10, 11, { availabilityBehavior: "disruptive" })]), ["x"]);
});

Deno.test("an entry being moved does not clash with itself, and an empty span clashes with nothing", () => {
	const all = [entry("a", 10, 11)];
	assertEquals(titles({ start: 10 * HOUR, end: 11 * HOUR, excludeId: "a" }, all), []);
	assertEquals(titles({ start: 11 * HOUR, end: 10 * HOUR }, all), []);
});

Deno.test("clashes come earliest first, a masked one says only Busy, and a call says it is one", () => {
	const { clashes } = detectTimeClash({ start: 9 * HOUR, end: 12 * HOUR }, [
		entry("late", 11, 12, { callId: "call-1" }),
		entry("private", 9, 10, { masked: true }),
	]);
	assertEquals(clashes.map((c) => [c.title, c.kind]), [["Busy", "event"], ["late", "call"]]);
});

Deno.test("an unanswered invitation counts what it would clash with, and takes nothing itself", () => {
	const events = withClashCounts([
		entry("held", 10, 11),
		entry("invite", 10, 11, { userAttendeeStatus: "pending" }),
		entry("declined", 10, 11, { userAttendeeStatus: "rejected" }),
	]);
	assertEquals(events.map((e) => e.clashCount ?? 0), [0, 1, 0]);
});

Deno.test("two held entries count each other, and an unchanged entry keeps its identity", () => {
	const quiet = entry("quiet", 14, 15);
	const events = withClashCounts([entry("a", 10, 11), entry("b", 10.5, 11.5), quiet]);
	assertEquals(events.map((e) => e.clashCount ?? 0), [1, 1, 0]);
	assertEquals(events[2] === quiet, true);
	// A clash that has gone clears its old count rather than leaving it behind.
	assertEquals(withClashCounts([entry("a", 10, 11, { clashCount: 2 })])[0].clashCount, 0);
});

Deno.test("a bought seat and a call are not invitations, whatever the seat reads", () => {
	assertEquals(awaitsAnswer({ kind: "sync", userAttendeeStatus: "pending" }), true);
	assertEquals(awaitsAnswer({ kind: "session", userAttendeeStatus: "pending" }), false);
	assertEquals(awaitsAnswer({ kind: "booking", userAttendeeStatus: "pending" }), false);
	assertEquals(
		awaitsAnswer({ kind: "sync", userAttendeeStatus: "pending", callId: "call-1" }),
		false,
	);
	assertEquals(
		awaitsAnswer({ kind: "sync", userAttendeeStatus: "pending", status: "cancelled" }),
		false,
	);
	assertEquals(awaitsAnswer({ kind: "sync", userAttendeeStatus: "accepted" }), false);
	assertEquals(isDeclinedInvitation({ kind: "sync", userAttendeeStatus: "rejected" }), true);
	assertEquals(isDeclinedInvitation({ kind: "session", userAttendeeStatus: "rejected" }), false);
});
