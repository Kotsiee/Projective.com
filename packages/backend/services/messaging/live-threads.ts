import { type ConversationSummary, dmHandleOf } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient, fetchParties, orgClient, partyName, type PartyRow } from "./live-queries.ts";

/**
 * live-threads — what a conversation id addresses on the LIVE path, for the reads (the send path
 * keeps `live-writes.ts`'s get-or-create, because sending is what creates a DM).
 *
 * A uuid is a thread. A unified `dm-{handle}` names a PERSON: it resolves to the pair's existing
 * thread when there is one, and otherwise to a VIRTUAL conversation — the person, with no thread and
 * no messages. Reading must never mint a thread: an invitation sent with no intro deliberately opens
 * none (its notification still links here, and the drawer answers it), and a profile visit that
 * created empty threads would fill every inbox with conversations nobody started.
 */

/** A live conversation reference, resolved. */
export type ThreadRef =
	| { kind: "thread"; threadId: string }
	| { kind: "virtual"; userId: string; party: PartyRow | undefined };

/** The pair's existing non-group thread with `targetUserId`, or null. Never creates one. */
export async function findExistingDmThread(
	actor: ReadActor & { accessToken: string },
	targetUserId: string,
): Promise<string | null> {
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
		.select("id, kind, created_at")
		.in("id", shared)
		.neq("kind", "group")
		.order("created_at", { ascending: true })
		.limit(1);
	if (threadErr) throw new Error(`comms.dm_threads read failed: ${threadErr.message}`);
	return ((threads ?? []) as { id: string }[])[0]?.id ?? null;
}

/**
 * Resolve a conversation id for a READ. `null` when it names nothing the caller can address (an
 * unknown handle, oneself, a fixture-only id).
 */
export async function resolveThreadRef(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
): Promise<ThreadRef | null> {
	if (UUID_RE.test(conversationId)) return { kind: "thread", threadId: conversationId };
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

	const threadId = await findExistingDmThread(actor, userId);
	if (threadId) return { kind: "thread", threadId };
	const parties = await fetchParties(actor, [userId]);
	return { kind: "virtual", userId, party: parties.get(userId) };
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
