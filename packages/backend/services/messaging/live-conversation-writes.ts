import type {
	AddConversationMembers,
	ConversationKind,
	ConversationMembersAdded,
	CreateConversation,
	CreatedConversation,
} from "@projective/types/messaging";
import { dmHandleOf, uniqueContactIds } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient, orgClient } from "./live-queries.ts";
import { insertDmMessage } from "./live-writes.ts";

/**
 * live-conversation-writes — the RLS-scoped Postgres WRITE path for STARTING a conversation and for
 * ADDING people to one. The sibling of `./live-writes.ts` (which posts a message into a thread that
 * already exists); together they are the whole of what the inbox can change.
 *
 * ## Every write goes through a definer RPC
 *
 * `comms.dm_threads` and `comms.dm_participants` carry no client INSERT policy — deliberately
 * (00002012). Who may open a thread and who may be put into one is decided inside three
 * `SECURITY DEFINER` functions instead: `comms.get_or_create_dm_thread` (a DM, the schema's own
 * idempotent lookup), `comms.create_group_thread` and `comms.add_dm_thread_members` (00001300).
 * This module resolves the PEOPLE and picks the function; it never inserts a participant row.
 *
 * ## Contacts arrive under two identities
 *
 * The picker's contact `id` is a user uuid on the live path and a `@handle` on the stub path, and a
 * profile's "Message" control addresses somebody by handle on both. So every id is resolved the
 * same way: a uuid is taken as-is, anything else is looked up as a username in `org.users_public`.
 * Unknown ids are DROPPED rather than refused — the RPCs drop phantom uuids for the same reason
 * (a stale client, not a request) — but a create that resolves to NOBODY is refused, because a
 * conversation with no counterparty is not a conversation.
 *
 * ## A DM is one thread per pair, and an opening message is part of the create
 *
 * One person → the pair's thread, reopened if it exists (the `created` flag says which). Several,
 * or a named group → a new group thread. If the caller sent an opening message it is posted through
 * `insertDmMessage` in the same call, so the "Message seller" inquiry and the share modal's
 * "Send to…" never leave an empty thread behind a question that failed to land (Decision #79).
 */

// #region Resolution
type Actor = ReadActor & { accessToken: string };

interface IdentityRow {
	user_id: string;
	username: string;
}

/**
 * Turn picker ids (uuids and/or handles) into user uuids, in order, without the caller, and only
 * for people who exist. One `.in()` read for every handle at once.
 */
async function resolveMemberIds(actor: Actor, contactIds: readonly string[]): Promise<string[]> {
	const ids = uniqueContactIds(contactIds);
	const handles = ids.filter((id) => !UUID_RE.test(id)).map((h) => h.replace(/^@/, ""));

	const byHandle = new Map<string, string>();
	if (handles.length > 0) {
		const { data, error } = await orgClient(actor)
			.from("users_public")
			.select("user_id, username")
			.in("username", handles);
		if (error) throw new Error(`org.users_public read failed: ${error.message}`);
		for (const row of (data ?? []) as IdentityRow[]) byHandle.set(row.username, row.user_id);
	}

	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		const userId = UUID_RE.test(id) ? id : byHandle.get(id.replace(/^@/, ""));
		if (!userId || userId === actor.userId || seen.has(userId)) continue;
		seen.add(userId);
		out.push(userId);
	}
	return out;
}

/**
 * The thread a conversation id addresses: a uuid as-is, a unified `dm-{handle}` through the
 * person it names (minting the pair's thread if needed), anything else → nothing.
 */
async function resolveThreadId(actor: Actor, conversationId: string): Promise<string | null> {
	if (UUID_RE.test(conversationId)) return conversationId;
	const handle = dmHandleOf(conversationId);
	if (!handle) return null;
	const [target] = await resolveMemberIds(actor, [handle]);
	if (!target) return null;
	const thread = await commsClient(actor).rpc("get_or_create_dm_thread", {
		target_user_id: target,
	});
	if (thread.error) {
		throw new Error(`comms.get_or_create_dm_thread failed: ${thread.error.message}`);
	}
	const id = thread.data as unknown;
	return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/** The RPCs raise two sentences of their own; everything else goes through the shared mapper. */
function rpcRefusal(message: string): WriteRefusal {
	if (message.includes("Not a participant")) {
		return { status: 403, message: "You can only add people to a conversation you're in." };
	}
	if (message.includes("at least one other person")) {
		return {
			status: 422,
			message: "Pick at least one other person.",
			errors: { contactIds: "required" },
		};
	}
	return refusalFrom(message, "contactIds");
}
// #endregion

// #region Create
/**
 * Start a conversation. Returns `null` only when the ids resolve to nobody at all — the caller
 * maps that to a 404-shaped "no such person", which is what a picker id that names no row is.
 */
export async function createLiveConversation(
	actor: Actor,
	input: CreateConversation,
	now: number = Date.now(),
): Promise<WriteOutcome<CreatedConversation>> {
	const members = await resolveMemberIds(actor, input.contactIds);
	if (members.length === 0) return null;

	const db = commsClient(actor);
	const wantsGroup = members.length > 1 || (input.groupName ?? "").trim().length > 0;

	let threadId: string;
	let kind: ConversationKind;
	let created: boolean;

	if (wantsGroup) {
		const res = await db.rpc("create_group_thread", {
			p_title: input.groupName ?? null,
			p_member_ids: members,
		});
		if (res.error) return { refusal: rpcRefusal(res.error.message) };
		const id = res.data as unknown;
		if (typeof id !== "string" || !UUID_RE.test(id)) {
			return { refusal: refusalFrom("create_group_thread returned no id", "contactIds") };
		}
		threadId = id;
		kind = "group";
		created = true;
	} else {
		const before = now;
		const res = await db.rpc("get_or_create_dm_thread", { target_user_id: members[0] });
		if (res.error) return { refusal: rpcRefusal(res.error.message) };
		const id = res.data as unknown;
		if (typeof id !== "string" || !UUID_RE.test(id)) {
			return { refusal: refusalFrom("get_or_create_dm_thread returned no id", "contactIds") };
		}
		threadId = id;
		kind = "dm";
		// The RPC is silent about whether it minted or found the thread; a thread whose row was
		// created at or after this request began is one this request created.
		const row = await db.from("dm_threads").select("created_at, kind").eq("id", id).maybeSingle();
		const createdAt = (row.data as { created_at?: string; kind?: string } | null)?.created_at;
		created = !!createdAt && Date.parse(createdAt) >= before - 1_000;
		const rowKind = (row.data as { kind?: string } | null)?.kind;
		if (rowKind === "service_inquiry") kind = "service_inquiry";
	}

	let messageAccepted = false;
	const text = (input.message ?? "").trim();
	if (text.length > 0) {
		const sent = await insertDmMessage(actor, {
			conversationId: threadId,
			text,
			attachmentIds: [],
			audio: null,
		}, now);
		messageAccepted = !!sent && "data" in sent;
	}

	return { data: { id: threadId, kind, created, messageAccepted } };
}
// #endregion

// #region Add members
/** Add people to a conversation the caller is in. `null` when the conversation resolves to nothing. */
export async function addLiveMembers(
	actor: Actor,
	input: AddConversationMembers,
): Promise<WriteOutcome<ConversationMembersAdded>> {
	const threadId = await resolveThreadId(actor, input.conversationId);
	if (!threadId) return null;
	const members = await resolveMemberIds(actor, input.contactIds);
	if (members.length === 0) {
		return {
			refusal: {
				status: 422,
				message: "Pick at least one other person.",
				errors: { contactIds: "required" },
			},
		};
	}

	const db = commsClient(actor);
	const res = await db.rpc("add_dm_thread_members", {
		p_thread_id: threadId,
		p_member_ids: members,
	});
	if (res.error) return { refusal: rpcRefusal(res.error.message) };
	const added = typeof res.data === "number" ? res.data : Number(res.data ?? 0);

	const row = await db.from("dm_threads").select("kind").eq("id", threadId).maybeSingle();
	const rowKind = (row.data as { kind?: string } | null)?.kind;
	const kind: ConversationKind = rowKind === "group" || rowKind === "service_inquiry"
		? rowKind
		: "dm";

	return { data: { id: threadId, kind, added: Number.isFinite(added) ? added : 0 } };
}
// #endregion
