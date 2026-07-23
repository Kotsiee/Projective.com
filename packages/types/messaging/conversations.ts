import { z } from "zod";

/**
 * messaging.conversations — the Zod SSOT for the global inbox (`/messages`) READ projections: the
 * conversation LIST the middle-nav sidebar renders, and the single-conversation metadata the
 * conversation view (`/messages/[conversationId]`) reads. The message BODIES inside a conversation
 * reuse the projections in {@link ../projects/messages.ts} (`ChatMessage`/`MessagePage`) — a project
 * channel and the global inbox are unified by `chatId` (PRODUCT_SPEC §Unified Messaging), so a DM
 * opened inside a project and from the inbox resolve to one continuous history; only the entry point
 * differs.
 *
 * These are read projections over the eventual `messages.conversations` /
 * `messages.conversation_participants` tables, NOT table rows — only enum / array / string / number /
 * boolean primitives + shallow nested objects, so the schema stays stable across Zod majors (matching
 * {@link ProjectDetailSchema}). Timestamps are carried raw (`updatedAt`, the sort key) AND
 * pre-formatted (`lastActivityLabel`) so SSR and the client render identical clocks with no
 * locale/timezone hydration drift. The richer full-row schemas land alongside their own writes later
 * (root CLAUDE.md §1).
 */

// #region Actor view + conversation kind
/**
 * Which side of the marketplace the acting user is browsing their inbox as — it selects the advanced
 * filter SET the sidebar shows (freelancer-side vs client/business-side) and whether auto-responses
 * are offered. A single account can be both a provider and a buyer, so this is a VIEW toggle, not an
 * identity: the Dev Context Switcher's `messagingRole` axis drives it during development.
 */
export const MessagingRole = z.enum(["freelancer", "client", "business"]);
export type MessagingRole = z.infer<typeof MessagingRole>;

/** The structural kind of a conversation thread. */
export const ConversationKind = z.enum(["dm", "group", "service_inquiry"]);
export type ConversationKind = z.infer<typeof ConversationKind>;

/**
 * The PRIMARY relationship a conversation represents — the axis the advanced filters select on. One
 * conversation has exactly one primary relation; the freelancer-side and client-side filter sets each
 * pick a subset of these:
 *  - Freelancer view: `client` · `co_freelancer` · `team` · `team_member` (+ Service/Product refs).
 *  - Client/Business view: `business` · `business_member` · `hired_freelancer` · `dm`.
 *  - `dm` is a plain person-to-person thread with no engagement context (shown in every view).
 */
export const ConversationRelation = z.enum([
	"dm",
	"client",
	"co_freelancer",
	"team",
	"team_member",
	"business",
	"business_member",
	"hired_freelancer",
]);
export type ConversationRelation = z.infer<typeof ConversationRelation>;
// #endregion

// #region Participant
/** One participant in a conversation — the identity a group roster / DM header renders. */
export const ConversationParticipantSchema = z.object({
	/** Stable participant id (the party handle in fixtures). */
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** Avatar URL (Unsplash face crops in fixtures, §C.4) or null → initials fallback. */
	avatar: z.string().max(400).nullable(),
	/** The `@handle` the avatar + name link to (canonical `/[handle]`, Decision #3); null → no link. */
	handle: z.string().max(40).nullable(),
	/** A short role label for the roster (e.g. "Client", "Freelancer", "Team member"); null → none. */
	roleLabel: z.string().max(40).nullable(),
	/** Whether the participant is currently online (drives a presence dot). */
	online: z.boolean(),
});
export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;
// #endregion

// #region Conversation summary (inbox row)
/**
 * One conversation row in the `/messages` sidebar list. The **visibility rule** (task §2A) is encoded
 * as `messageCount` — a conversation surfaces only when at least one message has been sent
 * (`messageCount > 0`); the backend never returns empty threads, and the client filters defensively.
 */
export const ConversationSummarySchema = z.object({
	/** Route param + unified thread id (e.g. `dm-mara`, `grp-northwind`). */
	id: z.string().min(1).max(80),
	kind: ConversationKind,
	relation: ConversationRelation,
	/** Group name, or the DM counterparty's name. */
	title: z.string().min(1).max(160),
	/** Group avatar or the DM party avatar; null → initials fallback. */
	avatar: z.string().max(400).nullable(),
	/** The other participants (excluding the acting viewer). */
	participants: z.array(ConversationParticipantSchema),
	/** Last-message snippet for the row preview (may be prefixed "You: "). */
	preview: z.string().max(200),
	/** Pre-formatted last-activity label, e.g. "2:30 PM" / "Yesterday" / "Mon, Jul 14". */
	lastActivityLabel: z.string().max(24),
	/** ISO last-activity timestamp — the default `recent` sort key. */
	updatedAt: z.string(),
	/** Unseen activity — a pulsing dot, never a count (DESIGN_SYSTEM.md Part D). */
	unread: z.boolean(),
	/** Whether the viewer starred (favourited) this conversation. */
	starred: z.boolean(),
	/** Whether the viewer archived this conversation (hidden from the default inbox view). */
	archived: z.boolean(),
	/** Whether the viewer muted this conversation's notifications. */
	muted: z.boolean(),
	/** How many messages exist — the visibility gate (`> 0` to appear). */
	messageCount: z.number().int().min(0),
	/** The service this inquiry/engagement is about (Freelancer "Service" filter); null → none. */
	serviceId: z.string().max(80).nullable(),
	serviceName: z.string().max(120).nullable(),
	/** The product this inquiry is about (Freelancer "Product" filter); null → none. */
	productId: z.string().max(80).nullable(),
	productName: z.string().max(120).nullable(),
	/** The team/business the conversation belongs to (Teams / Businesses filters); null → none. */
	entityId: z.string().max(80).nullable(),
	entityName: z.string().max(120).nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
// #endregion

// #region Conversation detail (the conversation view header)
/**
 * The single-conversation metadata the conversation view header + Members tab read. The message page
 * itself is fetched separately (reusing {@link MessagePageSchema}) so the header paints before the
 * (virtualized) stream resolves.
 */
export const ConversationDetailSchema = z.object({
	id: z.string().min(1).max(80),
	kind: ConversationKind,
	relation: ConversationRelation,
	title: z.string().min(1).max(160),
	avatar: z.string().max(400).nullable(),
	/** A short sub-line under the title (e.g. the party's handle, or "5 members"). */
	sub: z.string().max(160),
	participants: z.array(ConversationParticipantSchema),
	starred: z.boolean(),
	muted: z.boolean(),
	archived: z.boolean(),
	/**
	 * Whether the viewer may add members (converting a DM → group, task §2B). Re-derived server-side —
	 * anyone may add to a group they belong to; a DM's two parties may invite others to spin up a group.
	 */
	canAddMembers: z.boolean(),
	serviceId: z.string().max(80).nullable(),
	serviceName: z.string().max(120).nullable(),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
// #endregion

// #region List page + params
/** A page of inbox conversations, most-recently-active first. */
export const ConversationListPageSchema = z.object({
	conversations: z.array(ConversationSummarySchema),
	/** Whether more pages exist (drives load-on-scroll). */
	hasMore: z.boolean(),
	/** The cursor for the next page; null at the end. */
	nextCursor: z.string().max(80).nullable(),
	/** Total conversations matching the query (before paging) — powers the "N results" label. */
	total: z.number().int().min(0),
});
export type ConversationListPage = z.infer<typeof ConversationListPageSchema>;

/** The saved/archived/starred inbox partition the list is scoped to. */
export const ConversationView = z.enum(["inbox", "starred", "archived"]);
export type ConversationView = z.infer<typeof ConversationView>;

/**
 * The advanced filter selection — each array is an OR-set; a conversation must match at least one
 * value in EACH non-empty array (AND across facets). Empty/absent arrays impose no constraint.
 */
export const ConversationFilterSchema = z.object({
	/** Primary relations to include (the role-specific filter chips). */
	relations: z.array(ConversationRelation).optional(),
	/** Service ids (Freelancer "Service" filter). */
	serviceIds: z.array(z.string().max(80)).optional(),
	/** Product ids (Freelancer "Product" filter). */
	productIds: z.array(z.string().max(80)).optional(),
	/** Team/business entity ids (Teams / Businesses filters). */
	entityIds: z.array(z.string().max(80)).optional(),
	/** Participant ids/handles (Client / Co-Freelancer / Member / Hired-Freelancer person filters). */
	memberIds: z.array(z.string().max(80)).optional(),
});
export type ConversationFilter = z.infer<typeof ConversationFilterSchema>;

/** Query params for the conversation list read. */
export const ConversationListParamsSchema = z.object({
	/** Free-text search over title / participant names / preview. */
	q: z.string().max(200).optional(),
	/** Which partition — the default `inbox` excludes archived; `starred`/`archived` scope to those. */
	view: ConversationView.optional(),
	/** Only conversations with unseen activity. */
	unread: z.boolean().optional(),
	/** The acting view (freelancer/client/business) — selects the default relation universe. */
	role: MessagingRole.optional(),
	filter: ConversationFilterSchema.optional(),
	/** Opaque page cursor (the last conversation id of the previous page). */
	cursor: z.string().max(80).nullable().optional(),
	/** Page size (default resolved server-side). */
	limit: z.number().int().min(1).max(100).optional(),
});
export type ConversationListParams = z.infer<typeof ConversationListParamsSchema>;
// #endregion

// #region Contact picker (new conversation / add members)
/**
 * One selectable contact in the New Conversation / Add Members picker (task §2B) — the viewer's
 * connections/following. Selecting one starts a DM; selecting several starts (or extends into) a group.
 */
export const MessagingContactSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	avatar: z.string().max(400).nullable(),
	handle: z.string().max(40).nullable(),
	/** A short context label (e.g. "Client · Aurora Rebrand", "Northwind Studio"). */
	context: z.string().max(120).nullable(),
	/** The relationship bucket the contact groups under in the picker. */
	relation: ConversationRelation,
	online: z.boolean(),
});
export type MessagingContact = z.infer<typeof MessagingContactSchema>;

/** A page of pickable contacts. */
export const ContactListSchema = z.object({
	contacts: z.array(MessagingContactSchema),
	total: z.number().int().min(0),
});
export type ContactList = z.infer<typeof ContactListSchema>;
// #endregion
