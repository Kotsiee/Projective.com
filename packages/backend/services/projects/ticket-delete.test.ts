import { assertEquals } from "@std/assert";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { DELETE_REFUSAL } from "./live-ticket-delete.ts";
import { resetWriteStore } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";

const ALICE: ReadActor = { userId: "u-alice", contextId: "", contextType: "personal" };
const PROJECT = "prj-8mzxqqn6w8";

Deno.test("deleteTicket (stub): a pristine ticket leaves the board and stays gone on re-read", async () => {
	resetWriteStore();
	const ticketId = `${PROJECT}-t1`;
	const res = await ProjectBackendService.deleteTicket({ projectId: PROJECT, ticketId }, ALICE);
	assertEquals([res.ok, res.data?.ticketId], [true, ticketId]);
	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	assertEquals(board.data?.page.cards.some((c) => c.id === ticketId), false);
	const again = await ProjectBackendService.deleteTicket({ projectId: PROJECT, ticketId }, ALICE);
	assertEquals(again.status, 404);
});

Deno.test("deleteTicket (stub): a claimed, funded or submitted-against ticket is refused", async () => {
	resetWriteStore();
	const res = await ProjectBackendService.deleteTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t2` },
		ALICE,
	);
	assertEquals([res.status, res.errors], [409, DELETE_REFUSAL.notPristine.errors]);
});

Deno.test("deleteTicket: an anonymous caller is refused before any write", async () => {
	const res = await ProjectBackendService.deleteTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t1` },
		{ userId: "", contextId: "", contextType: "personal" },
	);
	assertEquals(res.ok, false);
});
