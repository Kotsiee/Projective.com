import type { DeleteTicket } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb, UUID_RE } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/**
 * live-ticket-delete — the board's Delete ticket on the live path: one `projects.delete_ticket` call
 * under the caller's JWT. The door checks review authority (`can_review_project`, 42501) and locks the
 * row; the fat service has already refused any ticket that is not pristine (`ticketDeletable`), so the
 * door's post-claim escrow release is never reached from the product.
 *
 * @module
 */

/** The refusals the board words for itself. */
export const DELETE_REFUSAL = {
	notPristine: {
		status: 409,
		message:
			"This ticket has been claimed, funded or submitted against, so it can't be deleted — " +
			"its history is kept.",
		errors: { ticket: "not_deletable" },
	},
	notPermitted: {
		status: 403,
		message: "Only the client can delete a ticket.",
		errors: { ticket: "not_permitted" },
	},
} as const satisfies Record<string, WriteRefusal>;

/** `projects.delete_ticket` — `null` when the ticket is not one the caller can address. */
export async function deleteTicketRow(
	actor: ReadActor & { accessToken: string },
	input: DeleteTicket,
): Promise<WriteOutcome<string>> {
	if (!UUID_RE.test(input.ticketId)) return null;
	const { error } = await projectsDb(actor).rpc("delete_ticket", { p_ticket_id: input.ticketId });
	if (!error) return { data: input.ticketId };
	if (error.code === "P0002") return null;
	if (error.code === "42501") return { refusal: DELETE_REFUSAL.notPermitted };
	return { refusal: refusalFrom(error.message, "ticket") };
}
