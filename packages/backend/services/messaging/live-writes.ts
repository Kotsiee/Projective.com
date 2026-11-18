import { type ChatMessage, messageDeltaText } from "@projective/types/projects";
import {
	dmHandleOf,
	OpenedDmThreadSchema,
	type SendMessageInput,
} from "@projective/types/messaging";
import { isSlug } from "@projective/types/slugs";
import type { ReadActor } from "../read-actor.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "../projects/live-writes.ts";
import { fetchMessageAttachments } from "../projects/message-attachments.ts";
import { attachmentInserts, prepareLinkShares } from "../files/link-shares.ts";
import { projectsDb, UUID_RE } from "../projects/live-support.ts";
import { REPLY_REFUSAL_MESSAGE, replyRefusal } from "../projects/message-replies.ts";
import { DM_SHIELDED, isAgeRestricted } from "../../core/age-gate.ts";
import {
	commsClient,
	DM_MESSAGE_COLUMNS,
	type DmMessageRow,
	fetchParties,
	MESSAGE_TEXT_MAX,
	NO_INTERACTIONS,
	orgClient,
	toChatMessage,
} from "./live-queries.ts";
import { type LiveThread, threadByRef } from "./live-threads.ts";

/**
 * live-writes — the RLS-scoped Postgres WRITE path for the global inbox: posting one message into a
 * DM thread. The messaging counterpart of `../projects/live-writes.ts#insertRoomMessage`, and it
 * shares that module's refusal mapping rather than restating it. Both halves are called by the one
 * send door, `MessagingBackendService.sendMessage`, which resolves where a message goes
 * ({@link resolveSendThread}) before it inserts anything ({@link insertThreadMessage}).
 *
 * ## Resolving the thread
 *
 * A conversation arrives under one of two identities. Its `cht-…` ref (`comms.dm_threads.ref`,
 * Decision #339 ruling N1) names the thread, and is read under the caller's own RLS, so a thread the
 * caller is not in resolves to nothing. The unified `dm-{handle}` id (PRODUCT_SPEC §Unified Messaging)
 * names a PERSON rather than a row, so it is resolved through `comms.get_or_create_dm_thread
 * (target_user_id)`, the schema's own idempotent "my thread with this person" lookup, after the
 * handle is turned into a user id through `org.users_public`. Two callers sending to `dm-juno`
 * therefore land in one thread rather than minting one each, which is the property the unified
 * contract depends on. A bare uuid addresses nothing (Decision #88).
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

/** Where a thread send lands: the thread, a refusal (the DM shield, Decision #208), or nowhere. */
export type SendThread = { thread: LiveThread } | { refusal: WriteRefusal } | null;

/**
 * Resolve the thread a send addresses, or `null` when it names nobody the caller can reach. A `cht-`
 * ref is the thread when the caller is in it; a `dm-{handle}` is the pair's thread, minted on the
 * first send. Anything else (a uuid, a fixture-only group id) has no live address and is nothing.
 */
export async function resolveSendThread(
	actor: ReadActor & { accessToken: string },
	address: string,
): Promise<SendThread> {
	if (isSlug(address, "thread")) {
		const thread = await threadByRef(actor, address);
		return thread ? { thread } : null;
	}
	const handle = dmHandleOf(address);
	if (!handle) return null;

	const identity = await orgClient(actor)
		.from("users_public")
		.select("user_id")
		.eq("username", handle)
		.maybeSingle();
	if (identity.error) throw new Error(`org.users_public read failed: ${identity.error.message}`);
	const target = (identity.data as IdentityRow | null)?.user_id;
	if (!target) return null;
	// One cannot open a DM with oneself. The RPC refuses it too (`recipient: invalid`, since a thread
	// whose both participants are the caller would break UNIQUE (thread_id, user_id)); answering the
	// miss here keeps it a 404 rather than a failed write.
	if (target === actor.userId) return null;

	const opened = await commsClient(actor).rpc("get_or_create_dm_thread", {
		target_user_id: target,
	});
	if (isAgeRestricted(opened.error)) return { refusal: { ...DM_SHIELDED } };
	if (opened.error) {
		throw new Error(`comms.get_or_create_dm_thread failed: ${opened.error.message}`);
	}
	const thread = openedThread(opened.data);
	return thread ? { thread } : null;
}

/**
 * The thread `comms.get_or_create_dm_thread` answered (`{ thread_id, thread_ref }`), or `null` when
 * the answer is not that shape.
 */
export function openedThread(data: unknown): LiveThread | null {
	const opened = OpenedDmThreadSchema.safeParse(data);
	return opened.success ? { id: opened.data.thread_id, ref: opened.data.thread_ref } : null;
}

/**
 * The project a thread message is stamped with, by its `prj-` slug, as the caller may read it; `null`
 * when the slug names nothing the caller can see, and the message then goes unstamped.
 */
export async function projectStampOf(
	actor: ReadActor & { accessToken: string },
	projectSlug: string | undefined,
): Promise<string | null> {
	if (!projectSlug) return null;
	const { data, error } = await projectsDb(actor)
		.from("projects")
		.select("id")
		.eq("slug", projectSlug)
		.maybeSingle();
	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	return (data as { id?: string } | null)?.id ?? null;
}
// #endregion

// #region Insert
/**
 * Post one message into a resolved DM thread and return the row as the feed renders it.
 *
 * Attachments are registered in BOTH places the schema keeps them, and the two speak different
 * vocabularies: `comms.message_attachments.message_table` is schema-qualified (`'comms.dm_messages'`)
 * while `comms.channel_files.channel_type` is the bare `'dm'`. Matching the wrong one returns zero
 * rows and raises nothing, so the file would never appear in the conversation's Files tab and nothing
 * would say why. A failed attachment link does NOT fail the send — the message is already committed.
 *
 * A reply is held to the rule `insertRoomMessage` states for a channel, scoped to the THREAD: the
 * original must be a message of this thread the caller can read, or the send is the one
 * `replyRefusal` before anything is written (`comms.tg_guard_dm_message_reply` is the backstop). The
 * echo is mapped from the row the insert reads back, so a body `comms.tg_mask_dm_message_pii` masked
 * — and whose formatting it dropped — reaches the sender exactly as the other participants see it.
 *
 * `projectId` is the project the message was sent inside (`/projects/prj-…/cht-…`), written to
 * `dm_messages.project_id`; `comms.tg_bind_dm_project` keeps it only when the sender and every other
 * participant are parties to that project, and otherwise derives one or leaves it NULL.
 */
export async function insertThreadMessage(
	actor: ReadActor & { accessToken: string },
	thread: LiveThread,
	input: SendMessageInput,
	projectId: string | null = null,
	now: number = Date.now(),
): Promise<WriteOutcome<ChatMessage>> {
	const db = commsClient(actor);
	const threadId = thread.id;

	let original: DmMessageRow | undefined;
	if (input.replyToId !== null) {
		if (!UUID_RE.test(input.replyToId)) return { refusal: replyRefusal() };
		const read = await db
			.from("dm_messages")
			.select(DM_MESSAGE_COLUMNS)
			.eq("thread_id", threadId)
			.eq("id", input.replyToId)
			.maybeSingle();
		if (read.error) throw new Error(`comms.dm_messages read failed: ${read.error.message}`);
		if (!read.data) return { refusal: replyRefusal() };
		original = read.data as unknown as DmMessageRow;
	}

	const attachmentIds = input.attachmentIds.filter((id) => UUID_RE.test(id));
	const linkedIds = input.linkedFileIds;
	const linkRefusal = await prepareLinkShares(actor, linkedIds);
	if (linkRefusal) return { refusal: linkRefusal };
	const fileIds = [...attachmentIds, ...linkedIds];
	const body = input.text.length <= MESSAGE_TEXT_MAX
		? input.text
		: input.text.slice(0, MESSAGE_TEXT_MAX);
	const { data, error } = await db
		.from("dm_messages")
		.insert({
			thread_id: threadId,
			sender_user_id: actor.userId,
			body,
			// Only a Delta that spells the body actually stored: the clamp above can shorten an 8,000
			// character send to 4,000, and a Delta that no longer agrees is one every reader discards.
			body_delta: input.delta && messageDeltaText(input.delta) === body ? input.delta : null,
			reply_to_id: original?.id ?? null,
			has_attachments: fileIds.length > 0,
			is_audio: input.audio !== null,
			...(projectId ? { project_id: projectId } : {}),
		})
		.select(DM_MESSAGE_COLUMNS)
		.maybeSingle();
	if (isAgeRestricted(error)) return { refusal: { ...DM_SHIELDED } };
	if (error) {
		const field = error.message.includes(REPLY_REFUSAL_MESSAGE) ? "replyToId" : "text";
		return { refusal: refusalFrom(error.message, field) };
	}
	const row = data as unknown as DmMessageRow | null;
	if (!row?.id) return { refusal: refusalFrom("dm_messages insert returned no id", "text") };

	if (fileIds.length > 0) {
		await db.from("message_attachments").insert(
			attachmentInserts("comms.dm_messages", row.id, attachmentIds, linkedIds),
		);
		await db.from("channel_files").insert(
			fileIds.map((attachmentId) => ({
				channel_type: "dm",
				channel_id: threadId,
				attachment_id: attachmentId,
			})),
		);
	}

	const parties = await fetchParties(
		actor,
		original ? [actor.userId, original.sender_user_id] : [actor.userId],
	);
	// The sender's own echo carries its files too, read back through the same loader the feed uses,
	// so the bubble that appears on send is the bubble a reload draws — not a text-only row whose
	// attachments only show up after a refresh.
	const attachments = fileIds.length > 0
		? await fetchMessageAttachments(actor, "comms.dm_messages", [row.id])
		: undefined;
	const message = toChatMessage(
		{ ...row, created_at: row.created_at ?? new Date(now).toISOString() },
		parties,
		actor.userId,
		now,
		NO_INTERACTIONS,
		original ? new Map([[original.id, original]]) : undefined,
		attachments,
	);
	// The memo's projection is the caller's — the row only records `is_audio`, and the feed's own
	// read has no waveform column to rebuild it from (see `toChatMessage`).
	return { data: { ...message, audio: input.audio } };
}
// #endregion
