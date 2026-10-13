import { assertEquals } from "@std/assert";
import { AGE_RESTRICTED_REASON } from "@projective/types/auth";
import { PAYOUT_NOT_READY_REASON, PAYOUT_SETUP_HREF } from "@projective/types/finance";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { CLAIM_REFUSAL, claimRefusal } from "./live-claim.ts";
import { resetWriteStore } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";

const ALICE: ReadActor = { userId: "u-alice", contextId: "", contextType: "personal" };
const PROJECT = "prj-8mzxqqn6w8";

// #region Refusal mapping
Deno.test("claimRefusal: the earning gate keeps the viewer's fix link", () => {
	const refusal = claimRefusal({
		code: "PK403",
		message:
			"payout_not_ready: verify your identity and add a payout account before you take on paid work or join a team",
		hint: "self",
		details: null,
	});
	assertEquals(refusal.status, 403);
	assertEquals(refusal.errors, { ticket: PAYOUT_NOT_READY_REASON });
	assertEquals(refusal.details?.href, PAYOUT_SETUP_HREF);
	assertEquals(refusal.message.startsWith("Verify your identity"), true);
});

Deno.test("claimRefusal: a PK403 that is not the earning gate is not given its link", () => {
	const refusal = claimRefusal({ code: "PK403", message: "kyb_required: verify the business" });
	assertEquals(refusal.details, undefined);
});

Deno.test("claimRefusal: an under-18 claimant gets the age gate's answer", () => {
	const refusal = claimRefusal({
		code: "PM403",
		message: "age: buying and selling unlock on the account holder's 18th birthday",
	});
	assertEquals([refusal.status, refusal.errors?.ticket], [403, AGE_RESTRICTED_REASON]);
});

Deno.test("claimRefusal: the concurrency caps pass the database's sentence through", () => {
	const global =
		"Claiming this ticket (intensity 3) would put your global workload at 11, over your cap " +
		"of 10. Submit current work before taking on more.";
	const stage =
		"Claiming this ticket (intensity 3) would put your workload in this stage at 7, over the " +
		"stage cap of 6.";
	for (const message of [global, stage]) {
		const refusal = claimRefusal({ code: "23514", message });
		assertEquals([refusal.status, refusal.message, refusal.errors?.ticket], [
			409,
			message,
			"over_capacity",
		]);
	}
});

Deno.test("claimRefusal: routing, races, the purchasing gate and the self-only rule are worded", () => {
	assertEquals(
		claimRefusal({
			code: "23514",
			message:
				"This stage uses round robin assignment; tickets here are routed by the project owner, not self-claimed.",
		}),
		CLAIM_REFUSAL.notOpenPull,
	);
	assertEquals(
		claimRefusal({ code: "P0001", message: "Ticket has already been claimed." }),
		CLAIM_REFUSAL.alreadyClaimed,
	);
	assertEquals(
		claimRefusal({
			code: "P0001",
			message: "A comprehensive description is required before a ticket can be claimed/funded.",
		}),
		CLAIM_REFUSAL.undescribed,
	);
	const self =
		"You can only claim a ticket for yourself; the project owner assigns it to anyone else.";
	assertEquals(claimRefusal({ code: "42501", message: self }), {
		status: 403,
		message: self,
		errors: { ticket: "not_permitted" },
	});
});

Deno.test("claimRefusal: an unrecognised failure is not reported as the caller's fault", () => {
	const original = console.error;
	console.error = () => {};
	try {
		assertEquals(claimRefusal({ code: "XX000", message: "something internal" }).status, 502);
	} finally {
		console.error = original;
	}
});
// #endregion

// #region Stub service
Deno.test("claimTicket (stub): a funded open-pull ticket is claimed and stays claimed on re-read", async () => {
	resetWriteStore();
	const claimed = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t26` },
		ALICE,
	);
	assertEquals(claimed.ok, true, claimed.message);
	assertEquals([claimed.data?.card.status, claimed.data?.card.claimed], ["claimed", true]);

	const board = await ProjectBackendService.board({ projectId: PROJECT, view: "stages" }, ALICE);
	const reread = board.data?.page.cards.find((c) => c.id === `${PROJECT}-t26`);
	assertEquals(reread?.status, "claimed");

	const again = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t26` },
		ALICE,
	);
	assertEquals([again.status, again.errors?.ticket], [409, "already_claimed"]);
});

Deno.test("claimTicket (stub): an unfunded ticket is refused as needs funding", async () => {
	resetWriteStore();
	const res = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t30` },
		ALICE,
	);
	assertEquals([res.ok, res.status, res.errors?.ticket], [false, 402, "needs_funding"]);
});

Deno.test("claimTicket (stub): a ticket on a routed stage is refused as not open pull", async () => {
	resetWriteStore();
	const res = await ProjectBackendService.claimTicket(
		{ projectId: "prj-tm2bjk9mdq", ticketId: "prj-tm2bjk9mdq-t6" },
		ALICE,
	);
	assertEquals([res.ok, res.errors?.ticket], [false, "not_open_pull"]);
});

Deno.test("claimTicket: an anonymous caller is refused before any write", async () => {
	const res = await ProjectBackendService.claimTicket(
		{ projectId: PROJECT, ticketId: `${PROJECT}-t26` },
		{ userId: "", contextId: "", contextType: "personal" },
	);
	assertEquals([res.ok, res.status], [false, 401]);
});
// #endregion
