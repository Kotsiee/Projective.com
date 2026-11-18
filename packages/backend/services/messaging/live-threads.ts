import { type ConversationSummary, dmHandleOf } from "@projective/types/messaging";
import { isSlug } from "@projective/types/slugs";
import type { ReadActor } from "../read-actor.ts";
import { commsClient, fetchParties, orgClient, partyName, type PartyRow } from "./live-queries.ts";

/**
 * live-threads — what a conversation address names on the LIVE path, for the reads (the send path
 * keeps `live-writes.ts`'s get-or-create, because sending is what creates a DM).
 *
 * A conversation is addressed by its `cht-…` ref (`comms.dm_threads.ref`, Decision #339 ruling N1),
 * read under the caller's own RLS (`view_dm_threads_if_participant`), so a thread the caller is not
 * an undeleted participant of is a miss exactly like a ref that names nothing. A bare uuid addresses
 * nothing: uuids do not route (Decision #88), and the thread's id stays an internal key.
 *
 * A unified `dm-{handle}` names a PERSON: it resolves to the pair's existing thread when there is one
 * (whose `cht-` ref is then the address the route moves to), and otherwise to a VIRTUAL conversation
 * — the person, with no thread and no messages. Reading must never mint a thread: an invitation sent
 * with no intro deliberately opens none (its notification still links here, and the drawer answers
 * it), and a profile visit that created empty threads would fill every inbox with conversations
 * nobody started.
 */

// #region Types
/** A live thread: its row id (what queries key on) and its `cht-` address (what links carry). */
export interface LiveThread {
	id: string;
	ref: string;
}

/** A live conversation reference, resolved. */
export type ThreadRef =
	| { kind: "thread"; threadId: string; ref: string }
	| { kind: "virtual"; userId: string; party: PartyRow | undefined };
// #endregion

// #region Lookups
/** The thread a `cht-` ref names, when the caller is an undeleted participant of it; else null. */
export async function threadByRef(
	actor: ReadActor & { accessToken: string },
	ref: string,
): Promise<LiveThread | null> {
	const { data, error } = await commsClient(actor)
		.from("dm_threads")
		.select("id, ref")
		.eq("ref", ref)
		.maybeSingle();
	if (error) throw new Error(`comms.dm_threads read failed: ${error.message}`);
	const row = data as { id?: string; ref?: string } | null;
	return row?.id && row.ref ? { id: row.id, ref: row.ref } : null;
}

/** A thread's `cht-` address by its id, when the caller may read the thread; else null. */
export async function threadRefOf(
	actor: ReadActor & { accessToken: string },
	threadId: string,
): Promise<string | null> {
	const { data, error } = await commsClient(actor)
		.from("dm_threads")
		.select("ref")
		.eq("id", threadId)
		.maybeSingle();
	if (error) throw new Error(`comms.dm_threads read failed: ${error.message}`);
	return (data as { ref?: string } | null)?.ref ?? null;
}

/** The pair's existing DM or service inquiry with `targetUserId`, or null. Never creates one. */
export async function findExistingDmThread(
	actor: ReadActor & { accessToken: string },
	targetUserId: string,
): Promise<LiveThread | null> {
	const db = commsClient(actor);
	const { data: mine, error } = await db
		.from("dm_participants")
		.select("thread_id")
		.eq("user_id", actor.userId)
		.is("deleted_at", null);
	if (error) throw new Error(`comms.dm_participants read failed: ${error.message}`);
	const threadIds = ((mine ?? []) as { thread_id: string }[]).map((r) => r.thread_id);
	if (threadIds.length === 0) return null;

	const roster = await db.rpc("dm_thread_roster", { p_thread_ids: threadIds });
	if (roster.error) throw new Error(`comms.dm_thread_roster failed: ${roster.error.message}`);
	const shared = ((roster.data ?? []) as { thread_id: string; user_id: string }[])
		.filter((r) => r.user_id === targetUserId)
		.map((r) => r.thread_id);
	if (shared.length === 0) return null;

	const { data: threads, error: threadErr } = await db
		.from("dm_threads")
		.select("id, ref, kind, created_at")
		.in("id", shared)
		.in("kind", ["dm", "service_inquiry"])
		.order("created_at", { ascending: true })
		.limit(1);
	if (threadErr) throw new Error(`comms.dm_threads read failed: ${threadErr.message}`);
	const row = ((threads ?? []) as { id: string; ref: string }[])[0];
	return row ? { id: row.id, ref: row.ref } : null;
}
// #endregion

// #region Resolution
/**
 * Resolve a conversation address for a READ. `null` when it names nothing the caller can address: a
 * ref they are not in, a uuid, an unknown handle, oneself, a fixture-only id.
 */
export async function resolveThreadRef(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
): Promise<ThreadRef | null> {
	if (isSlug(conversationId, "thread")) {
		const thread = await threadByRef(actor, conversationId);
		return thread ? { kind: "thread", threadId: thread.id, ref: thread.ref } : null;
	}
	const handle = dmHandleOf(conversationId);
	if (!handle) return null;

	const { data, error } = await orgClient(actor)
		.from("users_public")
		.select("user_id")
		.eq("username", handle)
		.maybeSingle();
	if (error) throw new Error(`org.users_public read failed: ${error.message}`);
	const userId = (data as { user_id: string } | null)?.user_id;
	if (!userId || userId === actor.userId) return null;

	const thread = await findExistingDmThread(actor, userId);
	if (thread) return { kind: "thread", threadId: thread.id, ref: thread.ref };
	const parties = await fetchParties(actor, [userId]);
	return { kind: "virtual", userId, party: parties.get(userId) };
}

/** An address that resolves to a thread that exists, as a {@link LiveThread}; else null. */
export async function resolveLiveThread(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
): Promise<LiveThread | null> {
	const ref = await resolveThreadRef(actor, conversationId);
	return ref?.kind === "thread" ? { id: ref.threadId, ref: ref.ref } : null;
}

/**
 * The conversation a virtual reference renders as: the person, no messages, in Primary. It is
 * addressed by the `dm-{handle}` it was asked for, so the first message (which creates the thread)
 * is sent to the same address the page is on.
 */
export function virtualSummary(
	conversationId: string,
	ref: Extract<ThreadRef, { kind: "virtual" }>,
	now: number,
): ConversationSummary {
	const name = partyName(ref.party);
	return {
		id: conversationId,
		kind: "dm",
		relation: "dm",
		title: name,
		avatar: ref.party?.avatar ?? null,
		participants: [{
			id: ref.userId,
			name,
			avatar: ref.party?.avatar ?? null,
			handle: ref.party?.username ?? dmHandleOf(conversationId),
			roleLabel: null,
			online: false,
		}],
		preview: "",
		lastActivityLabel: "",
		lastActivityShort: "",
		updatedAt: new Date(now).toISOString(),
		unread: false,
		starred: false,
		folder: "primary",
		archived: false,
		muted: false,
		messageCount: 0,
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		entityId: null,
		entityName: null,
	};
}
// #endregion
