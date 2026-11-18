import type { UserContext } from "@projective/types/auth";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import { CONVERSATION_PICTURE_FALLBACK_URL, dmHandleOf } from "@projective/types/messaging";
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

/**
 * The route for a conversation: `/messages/{address}` — its `cht-` ref, or the `dm-{handle}` of a pair
 * (which 303s to the pair's thread once there is one). A uuid does not route (Decision #88).
 */
export function conversationHref(id: string): string {
	return `${MESSAGES_ROOT}/${encodeURIComponent(id)}`;
}

/**
 * Where a page moves once a send created its conversation's thread: `/messages/dm-<handle>[/tab]`
 * becomes `/messages/cht-…[/tab]` (Decision #339 ruling N1), so a reload, a copied link and the inbox's
 * active row all name the thread. `null` when nothing moves: the send went to an address that was
 * not a `dm-` (already the thread, or a fixture id), the answer carried no ref, or the page is not
 * that conversation (a pop-out over another page).
 */
export function addressAfterSend(
	pathname: string,
	sentTo: string,
	ref: string | null | undefined,
): string | null {
	if (!ref || ref === sentTo || !dmHandleOf(sentTo)) return null;
	const base = conversationHref(sentTo);
	if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
	return `${conversationHref(ref)}${pathname.slice(base.length)}`;
}

/**
 * Where a `/messages/{address}[/tab]` request is sent when its address moved — a `dm-<handle>` whose
 * pair has a thread, to that thread's `location` (`/messages/cht-…`) — keeping the tab and the query.
 */
export function movedConversationHref(url: URL, location: string): string {
	const rest = url.pathname.split("/").filter(Boolean).slice(2);
	return `${location}${rest.length > 0 ? `/${rest.join("/")}` : ""}${url.search}`;
}
// #endregion

// #region Picture
/**
 * The one-shot `?notice=` code a conversation opens with when its group was created but the photo
 * chosen for it could not be set. The header says so once and strips it.
 */
export const GROUP_PHOTO_FAILED_NOTICE = "group-photo-failed";

/**
 * The image a conversation's picture falls back to when it has none (or it fails to load): a group's
 * stand-in picture, or — for a DM, whose picture is the counterparty — the person default.
 */
export function conversationFallbackImage(kind: ConversationKind): string {
	return kind === "group" ? CONVERSATION_PICTURE_FALLBACK_URL : DEFAULT_AVATAR_URL;
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
	entity_channel: "Channel",
};

/**
 * The acting messaging view derived from the user context — the SSR baseline the dev seam layers onto.
 * A business/enterprise context browses as a buyer (`business`); an individual who offers services is
 * a `freelancer`; everyone else is a `client`. (Decisions #9/#10 — Enterprises are buyer-only.)
 */
export function defaultMessagingRole(context: UserContext): MessagingRole {
	if (context.contextType === "business" || context.contextType === "enterprise") {
		return "business";
	}
	if (context.isFreelancer) return "freelancer";
	return "client";
}
// #endregion
