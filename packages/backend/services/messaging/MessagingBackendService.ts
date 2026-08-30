import type {
	ContactList,
	ConversationDetail,
	ConversationListPage,
	ConversationListParams,
	MessagingRole,
	MessagingSettings,
} from "@projective/types/messaging";
import type {
	FileListPage,
	FileListParams,
	MemberRosterPage,
	MessagePage,
} from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isMessagingBackendLive } from "../../core/supabase.ts";
import { cachedRead, cacheKey, messagingReadCache } from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import {
	findContacts,
	findConversationDetail,
	findConversations,
} from "./conversation-fixtures.ts";
import {
	type ConversationMessageParams,
	findConversationMessagePage,
} from "./messages-fixtures.ts";
import { findConversationFilePage, findConversationRoster } from "./workspace-fixtures.ts";
import { findSettings } from "./settings-fixtures.ts";
import {
	fetchConversation,
	fetchConversations,
	fetchMessageInteractions,
	fetchThreadMessages,
	toMessagePage,
} from "./live-queries.ts";
import { fetchContacts } from "./live-contacts.ts";
import { fetchMessagingSettings } from "./live-settings.ts";
import { fetchConversationFilePage, fetchConversationRoster } from "./live-workspace.ts";

/**
 * MessagingBackendService — the FAT half of the global inbox (`/messages`) read layer
 * (thin-routes/fat-services, root CLAUDE.md §2 · SYSTEM_ARCHITECTURE §Backend Services). It owns the
 * conversation LIST, single-conversation metadata, the per-conversation message page, the contact
 * picker and the Message Settings projection, returning a transport-agnostic {@link ServiceResult}.
 * The thin `/api/messaging/*` routes parse + guard + delegate here; islands never reach it.
 *
 * ## Gating
 *
 * Every method now tests {@link isMessagingBackendLive} (`MESSAGING_BACKEND_LIVE`, default off).
 * Previously ONE of the seven did — `conversations` — and even that one fell through to the same
 * fixtures on both sides of the branch, so flipping the flag changed nothing at all. Six methods had
 * no gate whatsoever. That is why the flag is now tested in one place per method and the live branch
 * is a real query rather than a comment.
 *
 * ## Reads are per-actor, and so is the cache
 *
 * Live reads run under the caller's own JWT (see `../read-actor.ts`), so two callers asking the
 * identical question are asking two different questions. Every cached entry is therefore keyed by
 * {@link tenantOf}, which cannot produce a key without an identity — see `../../core/cache.ts` on
 * why that is enforced by the type rather than by convention.
 *
 * ## Degradation is deliberate and one-directional
 *
 * A live read that throws (RLS refusing, a broker error, a column that moved) falls back to the
 * fixture projection rather than surfacing a 500. That keeps a chrome surface renderable, and it is
 * safe in exactly one direction: fixtures are a fabricated corpus belonging to nobody, so falling
 * back can never disclose one tenant's rows to another. It is logged through {@link liveFailed} so
 * a silent permanent fallback is visible in a log rather than looking like a working live path.
 *
 * ## Every method reaches Postgres
 *
 * All seven now have a live branch behind the gate. The contradictions that previously blocked four
 * of them are resolved in the mapping layer, not by widening a schema, so several fields come back
 * NEUTRAL rather than invented — each is documented where it is produced:
 *  - `files` — sourced from `comms.message_attachments` joined to `dm_messages`, NOT from
 *    `comms.channel_files`, because `FileItem` re-mandates `messageId`/`messageText`/`sender` as
 *    non-null and `channel_files` has no `message_id`. A file attached at channel level with no
 *    message is therefore out of scope for this projection.
 *  - `members` — `MemberRosterPage` pins `format` and `channelKind` to values meaningless for a DM
 *    but required by the shared projects SSOT; they match the fixtures so the two paths agree.
 *    Presence has no column anywhere and is always `offline`.
 *  - `contacts` — `relation` has no column in `comms`, so every contact is the neutral `dm`, the one
 *    member that is TRUE of a thread with no engagement evidence.
 *  - `settings` — the four per-event booleans map onto the sparse `notification_category_prefs` +
 *    `notification_type_mutes` pair, where a missing row and a NULL column both mean "inherit";
 *    `muteAll` maps onto the three-state `muted_until`. Auto-response service/product NAMES are
 *    unresolvable (`marketplace` is not exposed to PostgREST) and come back null.
 */

// #region Live-path helpers

/**
 * Record that a live read failed and the fixtures answered instead.
 *
 * Deliberately `console.warn` rather than a thrown error or a silent swallow. Thrown, a transient
 * broker hiccup takes down a surface the fixtures could have rendered; silent, a permanently broken
 * live path is indistinguishable from a working one — which is precisely how five tables came to be
 * default-denied without anybody noticing.
 */
function liveFailed(method: string, error: unknown): void {
	const reason = error instanceof Error ? error.message : String(error);
	console.warn(`[MessagingBackendService.${method}] live read failed, serving fixtures: ${reason}`);
}

/** The reference clock for pre-formatted labels on the live path. */
function clock(): number {
	return Date.now();
}

/**
 * Run a cached live read, or return `undefined` to mean "the caller should use the fixtures".
 *
 * The `undefined` return is deliberately distinct from the `null` a resolver returns for "no such
 * row": `undefined` means the live path did not run or could not answer, so the fixture branch takes
 * over; `null` means the database was asked and said no, which is a real 404 the caller must not
 * paper over with a fabricated fixture.
 */
async function liveRead<T>(
	method: string,
	actor: ReadActor | undefined,
	namespace: string,
	key: unknown,
	run: (actor: ReadActor & { accessToken: string }) => Promise<T | null>,
): Promise<T | null | undefined> {
	if (!isMessagingBackendLive() || !actor || !canReadLive(actor)) return undefined;
	try {
		return await cachedRead(
			messagingReadCache,
			cacheKey(tenantOf(actor), namespace, key),
			() => run(actor),
		);
	} catch (error) {
		liveFailed(method, error);
		return undefined;
	}
}

// #endregion

export class MessagingBackendService {
	/** A filtered, paged page of the viewer's conversations (the inbox sidebar list). */
	static async conversations(
		params: ConversationListParams,
		actor: ReadActor,
	): Promise<ServiceResult<{ page: ConversationListPage }>> {
		if (!isMessagingBackendLive() || !canReadLive(actor)) {
			return ok({ page: findConversations(params) });
		}
		try {
			const key = cacheKey(tenantOf(actor), "messaging.conversations", params);
			const page = await cachedRead(messagingReadCache, key, async () => {
				const rows = await fetchConversations(actor, clock());
				return applyConversationParams(rows, params);
			});
			return ok({ page });
		} catch (error) {
			liveFailed("conversations", error);
			return ok({ page: findConversations(params) });
		}
	}

	/** The single-conversation metadata for the conversation view header + Members tab. */
	static async conversation(
		id: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ detail: ConversationDetail }>> {
		if (isMessagingBackendLive() && canReadLive(actor)) {
			try {
				const key = cacheKey(tenantOf(actor), "messaging.conversation", { id });
				const summary = await cachedRead(
					messagingReadCache,
					key,
					() => fetchConversation(actor, id, clock()),
				);
				if (summary) return ok({ detail: toDetail(summary) });
				// A live miss is a genuine 404 — the viewer is not a participant, or the thread does not
				// exist. Falling through to the fixtures here would answer a real "no" with a fabricated
				// "yes", which is the one degradation that would be a disclosure rather than a courtesy.
				return fail(404, { message: "No such conversation." });
			} catch (error) {
				liveFailed("conversation", error);
			}
		}
		const detail = findConversationDetail(id);
		if (!detail) return fail(404, { message: "No such conversation." });
		return ok({ detail });
	}

	/** A bottom-anchored page of a conversation's messages (the chat feed). */
	static async messages(
		params: ConversationMessageParams,
		actor: ReadActor,
	): Promise<ServiceResult<{ page: MessagePage }>> {
		if (isMessagingBackendLive() && canReadLive(actor)) {
			try {
				const key = cacheKey(tenantOf(actor), "messaging.messages", params);
				const page = await cachedRead(messagingReadCache, key, async () => {
					const { rows, parties, hasMore } = await fetchThreadMessages(
						actor,
						params.conversationId,
						params.before,
						params.limit,
					);
					// Reactions, pins and favourites for the whole page in one lookup — issued after the
					// rows because it needs their ids, which is the one place here a sequential await is
					// not avoidable.
					const interactions = await fetchMessageInteractions(actor, rows.map((r) => r.id));
					return toMessagePage(
						params.conversationId,
						rows,
						parties,
						actor.userId,
						hasMore,
						clock(),
						interactions,
					);
				});
				return ok({ page });
			} catch (error) {
				liveFailed("messages", error);
			}
		}
		const page = findConversationMessagePage(params);
		if (!page) return fail(404, { message: "No such conversation." });
		return ok({ page });
	}

	/**
	 * A page of the conversation's shared attachments — the SAME {@link FileListPage} projection the
	 * engagement File Explorer reads, so `/messages/[id]/files` mounts the identical island.
	 *
	 * Gated but fixture-backed: see the class docblock on why `FileItem` cannot be satisfied from
	 * `comms.channel_files`.
	 */
	static async files(
		params: FileListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: FileListPage }>> {
		const live = await liveRead(
			"files",
			actor,
			"messaging.files",
			params,
			(a) => fetchConversationFilePage(a, params),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: "No such conversation." });
			return ok({ page: live });
		}
		const page = findConversationFilePage(params);
		if (!page) return fail(404, { message: "No such conversation." });
		return ok({ page });
	}

	/**
	 * The conversation's participant roster — the SAME {@link MemberRosterPage} projection the
	 * engagement Members tab reads. Gated but fixture-backed; see the class docblock.
	 */
	static async members(
		conversationId: string,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: MemberRosterPage }>> {
		const live = await liveRead(
			"members",
			actor,
			"messaging.members",
			{ conversationId },
			(a) => fetchConversationRoster(a, conversationId),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: "No such conversation." });
			return ok({ page: live });
		}
		const page = findConversationRoster(conversationId);
		if (!page) return fail(404, { message: "No such conversation." });
		return ok({ page });
	}

	/** The pickable contacts for New Conversation / Add Members. Gated but fixture-backed. */
	static async contacts(
		role: MessagingRole | undefined,
		q: string | undefined,
		actor?: ReadActor,
	): Promise<ServiceResult<{ contacts: ContactList }>> {
		const live = await liveRead(
			"contacts",
			actor,
			"messaging.contacts",
			{ role, q },
			(a) => fetchContacts(a, role, q),
		);
		// A contact list has no "no such row" state — an empty result is a real answer — so only
		// `undefined` sends this to the fixtures.
		if (live !== undefined && live !== null) return ok({ contacts: live });
		return ok({ contacts: findContacts(role, q) });
	}

	/** The Message Settings projection for the acting view. Gated but fixture-backed. */
	static async settings(
		role: MessagingRole,
		actor?: ReadActor,
	): Promise<ServiceResult<{ settings: MessagingSettings }>> {
		const live = await liveRead(
			"settings",
			actor,
			"messaging.settings",
			{ role },
			(a) => fetchMessagingSettings(a, role),
		);
		if (live !== undefined && live !== null) return ok({ settings: live });
		return ok({ settings: findSettings(role) });
	}
}

// #region Projections

/**
 * Narrow an inbox row to the conversation-view header's {@link ConversationDetail}.
 *
 * Written as an explicit field list rather than a spread-and-cast. The two shapes are NOT one a
 * superset of the other — `ConversationDetail` requires `sub`, which no summary carries, and drops
 * eleven fields the summary has — so a cast would have compiled while omitting a required field and
 * failed at parse time instead. The type checker caught exactly that here.
 *
 * `sub` is the short line under the title: a member count for a group (the only fact a group's
 * header can state without naming people who may not want naming), and the counterparty's `@handle`
 * for a DM, which is also the link target the header renders.
 */
function toDetail(summary: ConversationSummaryLike): ConversationDetail {
	const other = summary.participants[0];
	const sub = summary.kind === "group"
		? `${summary.participants.length + 1} members`
		: other?.handle
		? `@${other.handle}`
		: other?.name ?? "";

	return {
		id: summary.id,
		kind: summary.kind,
		relation: summary.relation,
		title: summary.title,
		avatar: summary.avatar,
		sub: sub.slice(0, 160),
		participants: summary.participants,
		starred: summary.starred,
		muted: summary.muted,
		archived: summary.archived,
		// No column governs this. Until the membership-management rules land, a group is treated as
		// open to the members already in it and a DM as closed — the conservative reading, since
		// silently widening a two-person thread is the change that cannot be undone.
		canAddMembers: summary.kind === "group",
		serviceId: summary.serviceId,
		serviceName: summary.serviceName,
	};
}

// #endregion

// #region Params application

/**
 * Apply the inbox's search / partition / filter / paging rules to a live row set.
 *
 * These are the SAME rules the fixture pager applies, restated over an explicit array because the
 * fixture version closes over its own module-level corpus. They are deliberately applied in the
 * fixture's order — visibility, then partition, then unread, then search — because `total` is
 * defined as the count AFTER the partition and BEFORE paging, and reordering would change the
 * number the sidebar prints without changing any row it shows.
 *
 * The `messageCount > 0` visibility rule is already applied at the source by `fetchConversations`,
 * matching where the fixture path applies it.
 */
function applyConversationParams(
	rows: readonly ConversationSummaryLike[],
	params: ConversationListParams,
): ConversationListPage {
	let out = [...rows];

	// Only an EXPLICIT "inbox" excludes archived. With `view` unset the full set is returned,
	// including archived rows, so the client can overlay its optimistic local prefs — the fixture
	// path's documented behaviour, preserved here so the two agree.
	if (params.view === "inbox") out = out.filter((c) => !c.archived);
	else if (params.view === "archived") out = out.filter((c) => c.archived);
	else if (params.view === "starred") out = out.filter((c) => c.starred);

	if (params.unread) out = out.filter((c) => c.unread);

	const q = params.q?.trim().toLowerCase();
	if (q) {
		out = out.filter((c) =>
			c.title.toLowerCase().includes(q) ||
			c.preview.toLowerCase().includes(q) ||
			c.participants.some((p) => p.name.toLowerCase().includes(q))
		);
	}

	// All FIVE facets, matching `conversation-fixtures.ts` predicate for predicate. Applying only
	// `relations` and dropping the rest would render a filter that appears to work and does not —
	// the user narrows by service and sees conversations about every other service.
	//
	// Note what that means on the live path today: `serviceId`, `productId` and `entityId` have no
	// column in `comms` and are returned `null`, so narrowing by one of them correctly matches
	// NOTHING. An empty result is the truthful answer to "which conversations are about this
	// service" when the database cannot say; showing unfiltered rows would not be.
	const f = params.filter;
	if (f) {
		if (f.relations?.length) {
			const wanted = new Set(f.relations);
			out = out.filter((c) => wanted.has(c.relation));
		}
		if (f.serviceIds?.length) {
			const wanted = new Set(f.serviceIds);
			out = out.filter((c) => c.serviceId !== null && wanted.has(c.serviceId));
		}
		if (f.productIds?.length) {
			const wanted = new Set(f.productIds);
			out = out.filter((c) => c.productId !== null && wanted.has(c.productId));
		}
		if (f.entityIds?.length) {
			const wanted = new Set(f.entityIds);
			out = out.filter((c) => c.entityId !== null && wanted.has(c.entityId));
		}
		if (f.memberIds?.length) {
			// A member matches by participant id OR by handle — the picker yields whichever it holds.
			const wanted = new Set(f.memberIds);
			out = out.filter((c) =>
				c.participants.some((p) => wanted.has(p.id) || (p.handle ? wanted.has(p.handle) : false))
			);
		}
	}

	out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	const total = out.length;
	const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
	// The cursor is the id of the LAST row of the previous page, and paging resumes strictly after
	// it. A cursor naming a row that has since been filtered out resolves to -1 and restarts at 0 —
	// the fixture pager's documented fail-open, matched here so the two behave identically.
	const start = params.cursor ? out.findIndex((c) => c.id === params.cursor) + 1 : 0;
	const slice = out.slice(start, start + limit);
	const last = slice[slice.length - 1];

	return {
		conversations: slice as ConversationListPage["conversations"],
		total,
		hasMore: start + slice.length < total,
		nextCursor: start + slice.length < total && last ? last.id : null,
	};
}

/** The structural slice of a summary {@link applyConversationParams} reads. */
type ConversationSummaryLike = ConversationListPage["conversations"][number];

// #endregion
