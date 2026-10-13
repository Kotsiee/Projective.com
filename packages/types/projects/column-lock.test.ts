import { assertEquals } from "@std/assert";
import { type ColumnLockInput, type TicketStatus, workColumnLocked } from "./board.ts";

/*
 * The column lock mirrors the work-start gate on `trg_ticket_escrow_sync` (#165): entering work from
 * outside it needs a held escrow. A wrong answer either offers a drop the database refuses, or locks a
 * column a funded ticket may enter, so each edge is pinned.
 */

const card = (over: Partial<ColumnLockInput> = {}): ColumnLockInput => ({
	claimed: true,
	status: "todo",
	escrowHeld: false,
	funding: { canStart: false },
	...over,
});

Deno.test("a claimed ticket without a held escrow is locked out of every work column", () => {
	for (const to of ["claimed", "in_progress", "in_review"] as TicketStatus[]) {
		assertEquals(workColumnLocked(card(), to), true, to);
	}
});

Deno.test("non-work columns are never locked", () => {
	for (const to of ["backlog", "todo", "completed"] as TicketStatus[]) {
		assertEquals(workColumnLocked(card(), to), false, to);
	}
});

Deno.test("a funded ticket (held, or prepaid) may enter work", () => {
	assertEquals(workColumnLocked(card({ funding: { canStart: true } }), "in_progress"), false);
});

Deno.test("an unclaimed ticket is not locked: its drop is the claim, which is the lock trigger", () => {
	assertEquals(workColumnLocked(card({ claimed: false }), "in_progress"), false);
});

Deno.test("a move between work states is not an entry", () => {
	assertEquals(workColumnLocked(card({ status: "in_review" }), "in_progress"), false);
	assertEquals(workColumnLocked(card({ status: "claimed" }), "in_review"), false);
});

Deno.test("a personal project moves no money, so nothing locks", () => {
	assertEquals(workColumnLocked(card({ personal: true }), "in_progress"), false);
});

Deno.test("a card the server has not resolved falls back to its escrowHeld flag", () => {
	assertEquals(workColumnLocked(card({ funding: null, escrowHeld: true }), "in_progress"), false);
	assertEquals(workColumnLocked(card({ funding: null, escrowHeld: false }), "in_progress"), true);
});
