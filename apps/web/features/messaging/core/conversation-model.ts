import type { UserContext } from "@projective/types/auth";
import type {
	ConversationKind,
	ConversationRelation,
	MessagingRole,
} from "../types/messaging-types.ts";

/**
 * conversation-model — the pure, DOM-free model behind the `/messages` conversation view. It owns the
 * link builders, the (Chat / Files / Members only) tab set with URL-driven active resolution, and the
 * human labels for a conversation's relation/kind. Kept side-effect-free so route SSR and the islands
 * derive identical results (mirrors `projects/core/channel-view.ts` — the layout the conversation view
 * strictly mirrors, task §2C, minus the stage/session/submission tabs).
 */

// #region Links
/** The inbox root. */
export const MESSAGES_ROOT = "/messages";

/** The route for a conversation: `/messages/{conversationId}`. */
export function conversationHref(id: string): string {
	return `${MESSAGES_ROOT}/${encodeURIComponent(id)}`;
}
// #endregion

// #region Tabs (Chat / Files / Members ONLY — task §2C)
/** One conversation view tab. `seg` is the sub-path after the base (`""` = the default Chat/index). */
export interface ConversationTab {
	key: string;
	label: string;
	seg: string;
}

/**
 * The conversation view tabs, in display order — deliberately ONLY Chat · Files · Members (task §2C:
 * Submissions / Tasks / Stages / Calendar are hidden; a global conversation has no engagement board).
 */
export const CONVERSATION_TABS: ConversationTab[] = [
	{ key: "chat", label: "Chat", seg: "" },
	{ key: "files", label: "Files", seg: "files" },
	{ key: "members", label: "Members", seg: "members" },
];

/**
 * The active tab key for a conversation pathname given its base (`/messages/{conversationId}`). The bare
 * base and any unknown trailing segment both resolve to `chat` (the default tab / index route).
 */
export function activeConversationTabOf(pathname: string, base: string): string {
	if (!pathname.startsWith(base)) return "chat";
	const rest = pathname.slice(base.length).replace(/^\/+/, "").split("/")[0] ?? "";
	const match = CONVERSATION_TABS.find((t) => t.seg === rest);
	return match ? match.key : "chat";
}
// #endregion

// #region Relation / role labels
/** Human labels for a conversation's primary relation (used in the filter chips + roster). */
export const RELATION_LABEL: Record<ConversationRelation, string> = {
	dm: "Direct message",
	client: "Client",
	co_freelancer: "Co-freelancer",
	team: "Team",
	team_member: "Team member",
	business: "Business",
	business_member: "Business member",
	hired_freelancer: "Hired freelancer",
};

/** A short kind label for the conversation header sub-line context. */
export const KIND_LABEL: Record<ConversationKind, string> = {
	dm: "Direct message",
	group: "Group",
	service_inquiry: "Service inquiry",
};

/**
 * The acting messaging view derived from the user context — the SSR baseline the dev seam layers onto.
 * A business/organisation context browses as a buyer (`business`); an individual who offers services is
 * a `freelancer`; everyone else is a `client`. (Decisions #9/#10 — Organisations are buyer-only.)
 */
export function defaultMessagingRole(context: UserContext): MessagingRole {
	if (context.contextType === "business" || context.contextType === "organisation") {
		return "business";
	}
	if (context.isFreelancer) return "freelancer";
	return "client";
}
// #endregion
