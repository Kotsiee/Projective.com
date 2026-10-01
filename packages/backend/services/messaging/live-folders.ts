import type { ConversationFolderSet, InboxFolder } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import type { WriteOutcome } from "../projects/live-writes.ts";
import { commsClient } from "./live-queries.ts";
import { resolveThreadRef } from "./live-threads.ts";

/**
 * live-folders — moving a conversation between the caller's own inbox folders through
 * `comms.set_dm_inbox_folder` (`comms.dm_participants` has no client UPDATE policy; the RPC writes
 * exactly the caller's row and exactly that column). A conversation with no thread yet has nothing
 * to file and reads as a miss.
 */
export async function setLiveFolder(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
	folder: InboxFolder,
): Promise<WriteOutcome<ConversationFolderSet>> {
	const ref = await resolveThreadRef(actor, conversationId);
	if (!ref || ref.kind === "virtual") return null;
	const { error } = await commsClient(actor).rpc("set_dm_inbox_folder", {
		p_thread_id: ref.threadId,
		p_folder: folder,
	});
	if (error) {
		if (error.code === "42501") return null;
		if (error.code === "22023") {
			return {
				refusal: {
					status: 422,
					message: "That is not an inbox folder.",
					errors: { folder: "not_a_folder" },
				},
			};
		}
		throw new Error(`comms.set_dm_inbox_folder failed: ${error.message}`);
	}
	return { data: { id: conversationId, folder } };
}
