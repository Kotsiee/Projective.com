import type {
	ConversationListPage,
	ConversationListParams,
	ConversationParticipant,
	ConversationSummary,
	MessagingContact,
} from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { sentConversationCount, writeOwnerOf } from "./write-store.ts";
import { mockCover } from "../../mocks/assets.ts";

/**
 * messaging conversation store — the mutable, PER-PROCESS overlay of conversations CREATED while
 * `MESSAGING_BACKEND_LIVE` is off (a new group, a DM with somebody the corpus had no thread with,
 * members added to either). The sibling of `./write-store.ts`, which holds the messages SENT into
 * them, and it keeps that module's rules:
 *
 *  - **Not a database.** An in-module `Map`; a restart loses everything. It exists so a group the
 *    viewer just created is still there after the browser reloads — the only test that matters for
 *    a write, and the one a stub that returns a fabricated id and stores nothing fails.
 *  - **An overlay, never a rewritten corpus.** The fixture pool is shared module state; a created
 *    conversation is folded onto a freshly derived page by {@link overlayCreatedConversations}.
 *  - **Scoped by owner** for the LIST (one developer's group is not another session's), but
 *    resolvable by ID alone for the DETAIL and message reads, because those are reached through
 *    the id the create handed back and the stub path has no other way to answer them.
 *
 * The visibility rule (`messageCount > 0`) is honoured here as well: a created conversation joins the
 * inbox list the moment the first message lands in it (counted from the write store), and not
 * before — exactly as the live path, where an empty thread is never listed.
 */

// #region Storage
/** A created conversation, as the summary the inbox renders. `owner` scopes the list read. */
interface StoredConversation {
	owner: string;
	summary: ConversationSummary;
}

/** Every created conversation, keyed by id (ids are minted unique per process). */
const created = new Map<string, StoredConversation>();

/** Monotonic suffix so two groups named the same in one process get distinct ids. */
let mintCounter = 0;

/** The pinned corpus clock — a created row is dated against it so labels agree with the corpus. */
const NOW = Date.parse("2026-07-17T16:20:00Z");

const GROUP_AVATAR = mockCover("photo-1522071820081-009f0129c71c", 96, 96);
// #endregion

// #region Helpers
/** A URL-safe slug of a group name, or `group` when nothing survives. */
function slugOf(name: string): string {
	const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	return s || "group";
}

/** A participant row from a picked contact. */
function participantOf(contact: MessagingContact): ConversationParticipant {
	return {
		id: contact.id,
		name: contact.name,
		avatar: contact.avatar,
		handle: contact.handle,
		roleLabel: contact.context,
		online: contact.online,
	};
}

/** A group's default title — the members' first names, so a nameless group still says who is in it. */
export function defaultGroupTitle(members: readonly { name: string }[]): string {
	const names = members.map((m) => m.name.split(/\s+/)[0]).filter(Boolean);
	if (names.length === 0) return "New group";
	if (names.length <= 3) return names.join(", ");
	return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}
// #endregion

// #region Writes
/**
 * Mint and remember a new group conversation. Returns the summary the create answers with.
 *
 * The id is `grp-{slug}-{n}` — a fixture-only shape (the live path answers with the thread's uuid),
 * and one `findConversationSummary` recognises before it falls through to its `grp-new-` stub.
 */
export function rememberCreatedGroup(
	actor: ReadActor | undefined,
	title: string | undefined,
	members: readonly MessagingContact[],
): ConversationSummary {
	const name = title?.trim() || defaultGroupTitle(members);
	const id = `grp-${slugOf(name)}-${++mintCounter}`;
	const summary: ConversationSummary = {
		id,
		kind: "group",
		relation: "dm",
		title: name,
		avatar: GROUP_AVATAR,
		participants: members.map(participantOf),
		preview: "",
		lastActivityLabel: "Now",
		updatedAt: new Date(NOW).toISOString(),
		unread: false,
		starred: false,
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
	created.set(id, { owner: writeOwnerOf(actor), summary });
	return summary;
}

/**
 * Remember a DM the corpus had no thread for, under its unified `dm-{handle}` id, so it lists once
 * a message lands. Idempotent: a second create with the same person returns the existing row.
 */
export function rememberCreatedDm(
	actor: ReadActor | undefined,
	contact: MessagingContact,
): ConversationSummary {
	const id = `dm-${contact.handle ?? contact.id}`;
	const existing = created.get(id);
	if (existing) return existing.summary;
	const summary: ConversationSummary = {
		id,
		kind: "dm",
		relation: contact.relation,
		title: contact.name,
		avatar: contact.avatar,
		participants: [participantOf(contact)],
		preview: "",
		lastActivityLabel: "Now",
		updatedAt: new Date(NOW).toISOString(),
		unread: false,
		starred: false,
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
	created.set(id, { owner: writeOwnerOf(actor), summary });
	return summary;
}

/**
 * Add members to a created OR corpus conversation on the stub path. A corpus conversation is copied
 * into the store first (an overlay, never a rewritten corpus), and a DM becomes a group the moment it
 * has a third person in it — the `comms.dm_threads.kind` rule, mirrored.
 *
 * Returns the number actually added; people already present are skipped rather than duplicated.
 */
export function addCreatedMembers(
	actor: ReadActor | undefined,
	base: ConversationSummary,
	members: readonly MessagingContact[],
): { summary: ConversationSummary; added: number } {
	const stored = created.get(base.id)?.summary ?? base;
	const present = new Set(stored.participants.map((p) => p.id));
	const fresh = members.filter((m) => !present.has(m.id));
	const participants = [...stored.participants, ...fresh.map(participantOf)];
	const becomesGroup = stored.kind === "dm" && participants.length > 1;
	const summary: ConversationSummary = {
		...stored,
		kind: becomesGroup ? "group" : stored.kind,
		title: becomesGroup ? defaultGroupTitle(participants) : stored.title,
		avatar: becomesGroup ? GROUP_AVATAR : stored.avatar,
		participants,
	};
	created.set(summary.id, { owner: created.get(base.id)?.owner ?? writeOwnerOf(actor), summary });
	return { summary, added: fresh.length };
}
// #endregion

// #region Reads
/**
 * A created conversation by id, with its message count folded in from the write store so the
 * visibility rule can be evaluated. Owner-blind on purpose — see the module docblock.
 */
export function findCreatedConversation(
	id: string,
	actor?: ReadActor,
): ConversationSummary | null {
	const row = created.get(id);
	if (!row) return null;
	return withCount(row, actor);
}

/** Every created conversation belonging to this viewer, counts folded in. */
export function createdConversationsFor(actor: ReadActor | undefined): ConversationSummary[] {
	const owner = writeOwnerOf(actor);
	const out: ConversationSummary[] = [];
	for (const row of created.values()) {
		if (row.owner === owner) out.push(withCount(row, actor));
	}
	return out;
}

/** The summary with the viewer's sent-message count (and a "You: …" preview) folded in. */
function withCount(row: StoredConversation, actor: ReadActor | undefined): ConversationSummary {
	const sent = sentConversationCount(writeOwnerOf(actor), row.summary.id);
	if (sent === 0) return row.summary;
	return { ...row.summary, messageCount: row.summary.messageCount + sent };
}

/**
 * Fold this viewer's created conversations onto a derived list page.
 *
 * Only conversations that pass the visibility rule join the page; a created row that ALREADY
 * appears (the corpus knew it, or the overlay ran twice) is replaced rather than duplicated, so a
 * DM that was extended into a group renders once, as the group. Newest first, like the page.
 */
export function overlayCreatedConversations(
	page: ConversationListPage,
	params: ConversationListParams,
	actor: ReadActor | undefined,
): ConversationListPage {
	const mine = createdConversationsFor(actor).filter((c) => c.messageCount > 0);
	if (mine.length === 0) return page;

	const q = (params.q ?? "").trim().toLowerCase();
	const eligible = mine.filter((c) => {
		if (params.view === "archived") return c.archived;
		if (params.view === "starred") return c.starred && !c.archived;
		if (params.view === "inbox" && c.archived) return false;
		if (params.unread && !c.unread) return false;
		if (
			q && !(c.title.toLowerCase().includes(q) ||
				c.participants.some((p) =>
					p.name.toLowerCase().includes(q) ||
					(p.handle ?? "").toLowerCase().includes(q)
				))
		) return false;
		return true;
	});
	if (eligible.length === 0) return page;

	const replaced = new Set(eligible.map((c) => c.id));
	const conversations = [
		...eligible,
		...page.conversations.filter((c) => !replaced.has(c.id)),
	].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	return {
		...page,
		conversations,
		total: page.total +
			eligible.filter((c) => !page.conversations.some((p) => p.id === c.id)).length,
	};
}
// #endregion
