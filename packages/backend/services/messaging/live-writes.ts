import type { ChatMessage } from "@projective/types/projects";
import { dmHandleOf, type SendConversationMessage } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { refusalFrom, type WriteOutcome } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import {
	commsClient,
	type DmMessageRow,
	fetchParties,
	MESSAGE_TEXT_MAX,
	orgClient,
	toChatMessage,
} from "./live-queries.ts";

/**
 * live-writes — the RLS-scoped Postgres WRITE path for the global inbox: posting one message into a
 * DM thread. The messaging counterpart of `../projects/live-writes.ts#insertProjectMessage`, and it
 * shares that module's refusal mapping rather than restating it.
 *
 * ## Resolving the thread is the whole difficulty
 *
 * A conversation arrives under one of two identities. The inbox's live reads address a thread by its
 * `comms.dm_threads` uuid, which is passed through untouched. The profile's "Message" control, the
 * project sidebar and the fixture corpus address the SAME conversation by the unified `dm-{handle}`
 * id (PRODUCT_SPEC §Unified Messaging), and that id names a PERSON rather than a row — so it is
 * resolved through `comms.get_or_create_dm_thread(target_user_id)`, the schema's own idempotent
 * "my thread with this person" lookup, after the handle is turned into a user id through
 * `org.users_public`. Two callers sending to `dm-juno` therefore land in one thread rather than
 * minting one each, which is the property the unified contract depends on.
 *
 * The RPC is `SECURITY DEFINER` and inserts the thread and BOTH participant rows in one call, so a
 * first message to somebody creates the conversation as a side effect of sending — there is no
 * moment where a thread exists with a question that failed to land, which is the failure the
 * `MessagingService.create({ message })` payload was designed to prevent (Decision #79).
 *
 * ## What the INSERT relies on
 *
 * `comms.dm_messages` carries the `send_dm_messages_if_participant` policy (00002012): the caller
 * must hold an undeleted participant row in the thread AND `sender_user_id` must equal `auth.uid()`.
 * The id is pinned to the caller here as well, for the same reason the project send pins it — sending
 * a value the policy has to reject is how a client comes to believe it may choose an author.
 */

// #region Thread resolution
/** An `org.users_public` identity row, narrowed to what the handle lookup needs. */
interface IdentityRow {
	user_id: string;
}

/**
 * Resolve the thread a conversation id addresses, or `null` when it names nobody the caller can
 * reach. A uuid is taken as a thread id; a `dm-{handle}` is resolved through the person it names.
 * Anything else (a fixture-only group id) has no live representation and resolves to nothing.
 */
async function resolveThreadId(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
): Promise<string | null> {
	if (UUID_RE.test(conversationId)) return conversationId;
	const handle = dmHandleOf(conversationId);
	if (!handle) return null;

	const identity = await orgClient(actor)
		.from("users_public")
		.select("user_id")
		.eq("username", handle)
		.maybeSingle();
	if (identity.error) throw new Error(`org.users_public read failed: ${identity.error.message}`);
	const target = (identity.data as IdentityRow | null)?.user_id;
	if (!target) return null;
	// One cannot open a DM with oneself: the RPC would happily mint a two-row thread whose both
	// participants are the caller, and the inbox would then render a conversation with nobody in it.
	if (target === actor.userId) return null;

	const thread = await commsClient(actor).rpc("get_or_create_dm_thread", {
		target_user_id: target,
	});
	if (thread.error) {
		throw new Error(`comms.get_or_create_dm_thread failed: ${thread.error.message}`);
	}
	const threadId = thread.data as unknown;
	return typeof threadId === "string" && UUID_RE.test(threadId) ? threadId : null;
}
// #endregion

// #region Insert
/**
 * Post one message into a DM thread and return the row as the feed renders it.
 *
 * Attachments are registered in BOTH places the schema keeps them, and the two speak different
 * vocabularies: `comms.message_attachments.message_table` is schema-qualified (`'comms.dm_messages'`)
 * while `comms.channel_files.channel_type` is the bare `'dm'`. Matching the wrong one returns zero
 * rows and raises nothing, so the file would never appear in the conversation's Files tab and nothing
 * would say why. A failed attachment link does NOT fail the send — the message is already committed.
 */
export async function insertDmMessage(
	actor: ReadActor & { accessToken: string },
	input: SendConversationMessage,
	now: number = Date.now(),
): Promise<WriteOutcome<ChatMessage>> {
	const threadId = await resolveThreadId(actor, input.conversationId);
	if (!threadId) return null;

	const db = commsClient(actor);
	const attachmentIds = input.attachmentIds.filter((id) => UUID_RE.test(id));
	const { data, error } = await db
		.from("dm_messages")
		.insert({
			thread_id: threadId,
			sender_user_id: actor.userId,
			body: input.text.length <= MESSAGE_TEXT_MAX
				? input.text
				: input.text.slice(0, MESSAGE_TEXT_MAX),
			has_attachments: attachmentIds.length > 0,
			is_audio: input.audio !== null,
		})
		.select(
			"id, thread_id, sender_user_id, body, has_attachments, is_audio, created_at, deleted_at",
		)
		.maybeSingle();
	if (error) return { refusal: refusalFrom(error.message, "text") };
	const row = data as unknown as DmMessageRow | null;
	if (!row?.id) return { refusal: refusalFrom("dm_messages insert returned no id", "text") };

	if (attachmentIds.length > 0) {
		await db.from("message_attachments").insert(
			attachmentIds.map((attachmentId) => ({
				message_table: "comms.dm_messages",
				message_id: row.id,
				attachment_id: attachmentId,
			})),
		);
		await db.from("channel_files").insert(
			attachmentIds.map((attachmentId) => ({
				channel_type: "dm",
				channel_id: threadId,
				attachment_id: attachmentId,
			})),
		);
	}

	const parties = await fetchParties(actor, [actor.userId]);
	const message = toChatMessage(
		{ ...row, created_at: row.created_at ?? new Date(now).toISOString() },
		parties,
		actor.userId,
		now,
	);
	// The memo's projection is the caller's — the row only records `is_audio`, and the feed's own
	// read has no waveform column to rebuild it from (see `toChatMessage`).
	return { data: { ...message, audio: input.audio } };
}
// #endregion
