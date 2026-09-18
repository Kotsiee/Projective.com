import type {
	AddConversationMembers,
	ContactList,
	ContactSuggestionParams,
	ConversationDetail,
	ConversationListPage,
	ConversationListParams,
	ConversationMembersAdded,
	ConversationSummary,
	CreateConversation,
	CreatedConversation,
	MessagingContact,
	MessagingRole,
	MessagingSettings,
	RankedContactList,
	SendConversationMessage,
} from "@projective/types/messaging";
import { dmHandleOf, uniqueContactIds } from "@projective/types/messaging";
import type {
	ChatMessage,
	FileListPage,
	FileListParams,
	MemberRosterPage,
	MessagePage,
} from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isMessagingBackendLive } from "../../core/supabase.ts";
import {
	cachedRead,
	cacheKey,
	invalidatePrefix,
	messagingReadCache,
	tenantPrefix,
} from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import {
	findContact,
	findContacts,
	findConversationDetail,
	findConversations,
	findConversationSummary,
	isCorpusConversation,
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
import { insertDmMessage } from "./live-writes.ts";
import { addLiveMembers, createLiveConversation } from "./live-conversation-writes.ts";
import { fetchRankedContacts } from "./live-suggestions.ts";
import { findRankedContacts } from "./suggestion-fixtures.ts";
import {
	addCreatedMembers,
	overlayCreatedConversations,
	rememberCreatedDm,
	rememberCreatedGroup,
} from "./conversation-store.ts";
import {
	appendConversationMessage,
	buildStubConversationMessage,
	overlayConversationPage,
	sentConversationCount,
	stubViewerSender,
	writeOwnerOf,
} from "./write-store.ts";

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
			// Created-this-process conversations join the corpus page once they carry a message.
			return ok({ page: overlayCreatedConversations(findConversations(params), params, actor) });
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
			// Created-this-process conversations join the corpus page once they carry a message.
			return ok({ page: overlayCreatedConversations(findConversations(params), params, actor) });
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
		// The stub store folds this viewer's sent messages onto the latest page — the fixture pool is
		// never mutated, so without this a message sent a moment ago would vanish on reload.
		return ok({ page: overlayConversationPage(page, !params.before, actor) });
	}

	/**
	 * Post one message into a conversation — the inbox's first WRITE, and the send the profile's
	 * floating messenger, the pop-out chat and `/messages/[conversationId]` all share.
	 *
	 * The live branch resolves the thread (a uuid as-is, a unified `dm-{handle}` through the schema's
	 * own `get_or_create_dm_thread`), so a first message to somebody creates the conversation in the
	 * same act as sending it. A live write that THROWS surfaces as a 502 rather than falling back to
	 * the stub: falling back would store the message in memory and answer `ok` for a row Postgres
	 * never accepted, which is the one outcome worse than reporting a failure.
	 *
	 * The stub branch appends to the per-process store, which {@link messages} folds back onto the
	 * latest page, so the message survives a reload exactly as a live one would.
	 */
	static async sendMessage(
		input: SendConversationMessage,
		actor: ReadActor,
	): Promise<ServiceResult<{ message: ChatMessage }>> {
		if (actor.userId.length === 0) {
			return fail(401, { message: "Sign in to send a message." });
		}

		if (isMessagingBackendLive() && canReadLive(actor)) {
			try {
				const outcome = await insertDmMessage(actor, input);
				if (outcome === null) {
					return fail(404, { message: `No conversation found for "${input.conversationId}".` });
				}
				if ("refusal" in outcome) {
					return fail(outcome.refusal.status, {
						message: outcome.refusal.message,
						errors: outcome.refusal.errors,
					});
				}
				invalidatePrefix(messagingReadCache, tenantPrefix(tenantOf(actor)));
				return ok({ message: outcome.data }, { message: "Message sent." });
			} catch (error) {
				liveFailed("sendMessage", error);
				return fail(502, { message: "That message could not be sent — please try again." });
			}
		}

		const page = findConversationMessagePage({ conversationId: input.conversationId });
		if (!page) return fail(404, { message: "No such conversation." });
		const owner = writeOwnerOf(actor);
		const message = buildStubConversationMessage(
			input,
			stubViewerSender(),
			sentConversationCount(owner, input.conversationId),
			Date.now(),
		);
		appendConversationMessage(owner, input.conversationId, message);
		// A first message to somebody the corpus has no thread for (a profile's Message control) is
		// what CREATES the conversation, so it is remembered here — or it would post fine and never
		// join the inbox list. Only a synthesised DM: a corpus thread already lists, and remembering it
		// would replace its row with a poorer summary. Idempotent, so a second message is free.
		const handle = dmHandleOf(input.conversationId);
		if (handle && !isCorpusConversation(input.conversationId)) {
			const contact = findContact(handle);
			if (contact) rememberCreatedDm(actor, contact);
		}
		return ok({ message }, { message: "Message sent." });
	}

	/**
	 * The RANKED people picker (New message · New group · Add members · Share with…): the viewer's
	 * relationships ordered shared-workspace → mutual follow → follow → collaboration → conversation,
	 * each by recency, or — with a query — the same people narrowed plus directory hits.
	 *
	 * The ranking rule lives in the Zod SSOT (`deriveContactRank`) and both branches feed it
	 * EVIDENCE: the live path from `org.*_members`, `org.profile_follows`, `projects.*` and the
	 * viewer's threads; the stub from the same casts the rest of the app renders. A brand-new
	 * account with no relationships gets an EMPTY suggestion list, which is the true answer and is
	 * why a `[]` here never falls through to the fixtures.
	 */
	static async suggestions(
		params: ContactSuggestionParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ contacts: RankedContactList }>> {
		const live = await liveRead(
			"suggestions",
			actor,
			"messaging.suggestions",
			params,
			(a) => fetchRankedContacts(a, params, clock()),
		);
		if (live !== undefined && live !== null) return ok({ contacts: live });
		return ok({ contacts: findRankedContacts(params) });
	}

	/**
	 * START a conversation from picked contacts — one → the pair's DM (reopened if it exists),
	 * several or a named group → a new group — posting an optional opening message in the same act.
	 *
	 * On the live path the threads are minted by definer RPCs (`get_or_create_dm_thread`,
	 * `create_group_thread`) and the answer is the thread's uuid, which every `/messages` route
	 * addresses it by. A live write that THROWS is a 502, never a fall-through to the stub — a
	 * conversation stored in memory and reported `ok` for rows Postgres never accepted is the one
	 * outcome worse than a failure. The stub mints into the per-process conversation store, which
	 * `findConversationSummary` consults first, so the new group resolves through detail, messages
	 * and send exactly as a live one would.
	 */
	static async createConversation(
		input: CreateConversation,
		actor: ReadActor,
	): Promise<ServiceResult<CreatedConversation>> {
		if (actor.userId.length === 0) {
			return fail(401, { message: "Sign in to start a conversation." });
		}

		if (isMessagingBackendLive() && canReadLive(actor)) {
			try {
				const outcome = await createLiveConversation(actor, input, clock());
				if (outcome === null) {
					return fail(404, {
						message: "Nobody by that name could be found.",
						errors: { contactIds: "not_found" },
					});
				}
				if ("refusal" in outcome) {
					return fail(outcome.refusal.status, {
						message: outcome.refusal.message,
						errors: outcome.refusal.errors,
					});
				}
				invalidatePrefix(messagingReadCache, tenantPrefix(tenantOf(actor)));
				return ok(outcome.data, { message: "Conversation started." });
			} catch (error) {
				liveFailed("createConversation", error);
				return fail(502, { message: "That conversation could not be started — please try again." });
			}
		}

		const ids = uniqueContactIds(input.contactIds);
		const members = ids
			.map((id) => findContact(id))
			.filter((c): c is MessagingContact => c !== null);
		if (members.length === 0) {
			return fail(404, {
				message: "Nobody by that name could be found.",
				errors: { contactIds: "not_found" },
			});
		}

		const wantsGroup = members.length > 1 || (input.groupName ?? "").trim().length > 0;
		let summary: ConversationSummary;
		let created: boolean;
		if (wantsGroup) {
			summary = rememberCreatedGroup(actor, input.groupName, members);
			created = true;
		} else {
			const existing = findConversationSummary(`dm-${members[0].handle ?? members[0].id}`);
			// A thread the corpus does not hold, or holds EMPTY (a profile-corpus person the viewer has never
			// messaged, synthesised on the fly), is remembered in the store so it can join the inbox list the
			// moment the first message lands. A corpus thread with messages is reopened as-is.
			summary = existing && existing.messageCount > 0
				? existing
				: rememberCreatedDm(actor, members[0]);
			created = existing === null || existing.messageCount === 0;
		}

		let messageAccepted = false;
		const text = (input.message ?? "").trim();
		if (text.length > 0) {
			const sent = await MessagingBackendService.sendMessage(
				{ conversationId: summary.id, text, attachmentIds: [], audio: null },
				actor,
			);
			messageAccepted = sent.ok;
		}

		return ok(
			{ id: summary.id, kind: summary.kind, created, messageAccepted },
			{ message: "Conversation started." },
		);
	}

	/**
	 * ADD people to a conversation the viewer is in. A DM with a third person becomes a group; the
	 * answer carries the conversation's (possibly changed) kind so the caller can re-render it.
	 */
	static async addMembers(
		input: AddConversationMembers,
		actor: ReadActor,
	): Promise<ServiceResult<ConversationMembersAdded>> {
		if (actor.userId.length === 0) {
			return fail(401, { message: "Sign in to add people to a conversation." });
		}

		if (isMessagingBackendLive() && canReadLive(actor)) {
			try {
				const outcome = await addLiveMembers(actor, input);
				if (outcome === null) {
					return fail(404, { message: `No conversation found for "${input.conversationId}".` });
				}
				if ("refusal" in outcome) {
					return fail(outcome.refusal.status, {
						message: outcome.refusal.message,
						errors: outcome.refusal.errors,
					});
				}
				invalidatePrefix(messagingReadCache, tenantPrefix(tenantOf(actor)));
				return ok(outcome.data, { message: "Members added." });
			} catch (error) {
				liveFailed("addMembers", error);
				return fail(502, { message: "Those people could not be added — please try again." });
			}
		}

		const base = findConversationSummary(input.conversationId);
		if (!base) {
			return fail(404, { message: `No conversation found for "${input.conversationId}".` });
		}
		const members = uniqueContactIds(input.contactIds)
			.map((id) => findContact(id))
			.filter((c): c is MessagingContact => c !== null);
		if (members.length === 0) {
			return fail(422, {
				message: "Pick at least one other person.",
				errors: { contactIds: "required" },
			});
		}
		const { summary, added } = addCreatedMembers(actor, base, members);
		return ok({ id: summary.id, kind: summary.kind, added }, { message: "Members added." });
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
