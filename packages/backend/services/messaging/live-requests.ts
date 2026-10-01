import { type InboxFolder, InboxFolder as InboxFolderSchema } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { commsClient } from "./live-queries.ts";

/**
 * live-requests — posting a hiring request's opening message (an invitation's intro, an
 * application's cover note) through `comms.send_request_message`, the definer RPC that opens or reuses
 * the pair's DM, files it in the recipient's Requests folder unless the two follow each other, and
 * inserts the message carrying the project — so the DM PII trigger masks it while the project is
 * protected. The RPC itself requires an open invitation or application between the two.
 */

/** What posting a request message did. */
export interface RequestPosted {
	threadId: string;
	messageId: string;
	/** The request opened the thread (it was new, empty, or restored for the recipient). */
	opened: boolean;
	/** Where an opened thread was filed for the recipient; null when an existing one was left alone. */
	routedTo: InboxFolder | null;
}

/** Post a request's opening message. Throws on a failed write; the caller decides what that costs. */
export async function postRequestMessage(
	actor: ReadActor & { accessToken: string },
	recipientUserId: string,
	body: string,
	projectId: string,
): Promise<RequestPosted> {
	const { data, error } = await commsClient(actor).rpc("send_request_message", {
		p_recipient: recipientUserId,
		p_body: body,
		p_project_id: projectId,
	});
	if (error) throw new Error(`comms.send_request_message failed: ${error.message}`);
	const row = (data ?? {}) as {
		thread_id?: string;
		message_id?: string;
		opened?: boolean;
		routed_to?: string | null;
	};
	if (!row.thread_id || !row.message_id) {
		throw new Error("comms.send_request_message returned no thread");
	}
	return {
		threadId: row.thread_id,
		messageId: row.message_id,
		opened: row.opened === true,
		routedTo: InboxFolderSchema.safeParse(row.routed_to).data ?? null,
	};
}
