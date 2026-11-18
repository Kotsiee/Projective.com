import type {
	AddConversationMembers,
	ConversationKind,
	ConversationMembersAdded,
	CreateConversation,
} from "@projective/types/messaging";
import { dmHandleOf, uniqueContactIds } from "@projective/types/messaging";
import { isSlug } from "@projective/types/slugs";
import type { ReadActor } from "../read-actor.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient, orgClient } from "./live-queries.ts";
import { DM_SHIELDED, isAgeRestricted } from "../../core/age-gate.ts";
import { openedThread } from "./live-writes.ts";
import { type LiveThread, threadByRef, threadRefOf } from "./live-threads.ts";

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
 * or a named group → a new group thread. The answer carries the thread's `cht-` address, which every
 * `/messages` route addresses it by (Decision #339 ruling N1). An opening message is posted by
 * `MessagingBackendService.createConversation` through the one send door in the same request, so the
 * "Message seller" inquiry and the share modal's "Send to…" never leave an empty thread behind a
 * question that failed to land (Decision #79).
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
 * The thread a conversation address names: a `cht-` ref the caller is in, a unified `dm-{handle}`
 * through the person it names (minting the pair's thread if needed), anything else — a uuid
 * included (Decision #88) — nothing.
 */
async function resolveThread(actor: Actor, conversationId: string): Promise<LiveThread | null> {
	if (isSlug(conversationId, "thread")) return await threadByRef(actor, conversationId);
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
	return openedThread(thread.data);
}

/**
 * `comms.add_dm_thread_members` refuses a service inquiry with this sentence (`22023`, Decision
 * #482): an inquiry is its buyer's and seller's pair thread, and a third person in it would make it
 * the thread every pair lookup hands any two of its members. The fixture path refuses in the same
 * words.
 */
export const INQUIRY_CLOSED_MESSAGE =
	"An inquiry is only between its buyer and its seller. Start a group to bring someone else in.";

/** The RPCs raise three sentences of their own; everything else goes through the shared mapper. */
function rpcRefusal(message: string, code?: string): WriteRefusal {
	if (isAgeRestricted({ code })) return { ...DM_SHIELDED };
	if (message.includes("Not a participant")) {
		return { status: 403, message: "You can only add people to a conversation you're in." };
	}
	if (message.includes(INQUIRY_CLOSED_MESSAGE)) {
		return {
			status: 422,
			message: INQUIRY_CLOSED_MESSAGE,
			errors: { conversationId: "inquiry_closed" },
		};
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
 * The `comms.get_or_create_dm_thread` arguments for a one-to-one conversation: the other person, and
 * the listing a buyer pressed Contact on when there is one (Decision #217(g)), which makes a thread
 * it opens a `service_inquiry` in that listing's client pipeline.
 */
export function dmThreadArgs(
	targetUserId: string,
	input: Pick<CreateConversation, "subjectListingId">,
): { target_user_id: string; p_subject_listing?: string } {
	return input.subjectListingId
		? { target_user_id: targetUserId, p_subject_listing: input.subjectListingId }
		: { target_user_id: targetUserId };
}

/** A conversation {@link createLiveConversation} opened (or reopened), before any message is posted. */
export interface OpenedConversation {
	thread: LiveThread;
	kind: ConversationKind;
	/** Whether this request minted the thread rather than finding the pair's existing one. */
	created: boolean;
}

/**
 * Start a conversation — the thread only; its opening message is the caller's to post through the
 * send door. Returns `null` only when the ids resolve to nobody at all — the caller maps that to a
 * 404-shaped "no such person", which is what a picker id that names no row is.
 */
export async function createLiveConversation(
	actor: Actor,
	input: CreateConversation,
	now: number = Date.now(),
): Promise<WriteOutcome<OpenedConversation>> {
	const members = await resolveMemberIds(actor, input.contactIds);
	if (members.length === 0) return null;

	const db = commsClient(actor);
	const wantsGroup = members.length > 1 || (input.groupName ?? "").trim().length > 0;

	if (wantsGroup) {
		const res = await db.rpc("create_group_thread", {
			p_title: input.groupName ?? null,
			p_member_ids: members,
		});
		if (res.error) return { refusal: rpcRefusal(res.error.message, res.error.code) };
		const id = res.data as unknown;
		if (typeof id !== "string" || !UUID_RE.test(id)) {
			return { refusal: refusalFrom("create_group_thread returned no id", "contactIds") };
		}
		// The RPC answers the row id; the address is the ref the guard minted on its insert.
		const ref = await threadRefOf(actor, id);
		if (!ref) {
			return { refusal: refusalFrom("create_group_thread returned no thread", "contactIds") };
		}
		return { data: { thread: { id, ref }, kind: "group", created: true } };
	}

	const before = now;
	let res = await db.rpc("get_or_create_dm_thread", dmThreadArgs(members[0], input));
	// A listing that stopped selling between the page and the press must not cost the question:
	// the pair's thread opens without the subject instead.
	if (res.error?.code === "22023" && input.subjectListingId) {
		res = await db.rpc("get_or_create_dm_thread", { target_user_id: members[0] });
	}
	if (res.error) return { refusal: rpcRefusal(res.error.message, res.error.code) };
	const thread = openedThread(res.data);
	if (!thread) {
		return { refusal: refusalFrom("get_or_create_dm_thread returned no id", "contactIds") };
	}
	// The RPC is silent about whether it minted or found the thread; a thread whose row was
	// created at or after this request began is one this request created.
	const row = await db.from("dm_threads").select("created_at, kind").eq("id", thread.id)
		.maybeSingle();
	const createdAt = (row.data as { created_at?: string; kind?: string } | null)?.created_at;
	const rowKind = (row.data as { kind?: string } | null)?.kind;
	return {
		data: {
			thread,
			kind: rowKind === "service_inquiry" ? "service_inquiry" : "dm",
			created: !!createdAt && Date.parse(createdAt) >= before - 1_000,
		},
	};
}
// #endregion

// #region Add members
/**
 * Add people to a conversation the caller is in. `null` when the conversation resolves to nothing.
 * The answer is addressed by the thread's `cht-` ref.
 */
export async function addLiveMembers(
	actor: Actor,
	input: AddConversationMembers,
): Promise<WriteOutcome<ConversationMembersAdded>> {
	const thread = await resolveThread(actor, input.conversationId);
	if (!thread) return null;
	const threadId = thread.id;
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
	if (res.error) return { refusal: rpcRefusal(res.error.message, res.error.code) };
	const added = typeof res.data === "number" ? res.data : Number(res.data ?? 0);

	const row = await db.from("dm_threads").select("kind").eq("id", threadId).maybeSingle();
	const rowKind = (row.data as { kind?: string } | null)?.kind;
	const kind: ConversationKind = rowKind === "group" || rowKind === "service_inquiry"
		? rowKind
		: "dm";

	return { data: { id: thread.ref, kind, added: Number.isFinite(added) ? added : 0 } };
}
// #endregion
