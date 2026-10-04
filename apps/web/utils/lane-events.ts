/**
 * Cross-island lane events — shared window `CustomEvent` names used to coordinate between the
 * middle-nav lane content (a feature island) and the shell's `MiddleNavSplitter` island that owns the
 * lane width. Kept in the app-shared `utils` layer so neither feature imports the other.
 */

/**
 * Dispatched on `window` when the lane's footer collapse/expand toggle is pressed. The
 * `MiddleNavSplitter` (via `useSplitter`'s `collapseEventName`) listens for it and toggles the lane
 * between its collapsed rail width and the last expanded width. Detail carries the desired state so a
 * source can force a direction; omit `detail` to plain-toggle.
 */
export const MIDDLE_LANE_TOGGLE_EVENT = "projective:middle-lane-toggle";

/** Optional `detail` payload for {@link MIDDLE_LANE_TOGGLE_EVENT}. */
export interface MiddleLaneToggleDetail {
	/** Force a direction; omit to toggle. */
	collapsed?: boolean;
}

/**
 * Dispatched on `window` when the chat composer has PERSISTED a message.
 *
 * The composer and the feed are two separate hydration roots — the composer lives in the middle-nav
 * footer band and the feed in the body — so neither can call the other. Without this the message
 * reached the database and the surface showed nothing until a full reload, which reads to the sender
 * as a send that failed.
 *
 * A window event rather than a shared module signal because the two are in different island bundles
 * and either may be mounted alone: the pop-out chat has a composer with no feed beside it, and a
 * non-Chat tab has neither. An event nobody is listening for is simply not heard.
 *
 * The detail carries the SERVER's message, not the draft — the row that exists, with its real id and
 * timestamp — so the feed appends what was actually stored rather than a hopeful copy of it.
 */
export const MESSAGE_SENT_EVENT = "projective:message-sent";

/** The `detail` payload for {@link MESSAGE_SENT_EVENT}. */
export interface MessageSentDetail {
	/** The channel (or conversation) the message belongs to — a feed ignores another channel's. */
	channelId: string;
	/** The persisted message, shaped as the feed already renders them. */
	message: unknown;
}

/**
 * Which message surface on a page a chat control belongs to.
 *
 * `page` is the channel or conversation the URL addresses — its feed in the body, its composer in the
 * footer band. `popout` is the floating chat window (and the profile messenger's sheet), which can be
 * open over a page showing a DIFFERENT conversation, or the same one. Every cross-island chat event
 * names its surface, because the channel id alone cannot tell the two composers on one channel apart.
 */
export type ChatSurface = "page" | "popout";

/**
 * Dispatched on `window` when a feed asks its composer to start a reply.
 *
 * The same two-roots problem as {@link MESSAGE_SENT_EVENT}, in the other direction: the feed is where
 * the reader picks the message (a Reply action, an arrow key, a swipe) and the composer is where the
 * reply is written, and on the page they are separate islands in different bands. The detail carries
 * the quote as the composer's strip renders it, so the composer never has to look the message up.
 */
export const MESSAGE_REPLY_EVENT = "projective:message-reply";

/** The `detail` payload for {@link MESSAGE_REPLY_EVENT}. */
export interface MessageReplyDetail {
	/** The channel (or conversation) whose composer should take the reply. */
	channelId: string;
	/** Which composer on that channel — see {@link ChatSurface}. */
	surface: ChatSurface;
	/** The message being answered, as the strip and the eventual quote render it. */
	target: {
		id: string;
		senderName: string | null;
		isOwn: boolean;
		excerpt: string;
		media: "none" | "attachment" | "audio";
	};
}

/**
 * Dispatched on `window` whenever any message's action menu opens, carrying the opener's token.
 *
 * "Only one message menu at a time" has to hold ACROSS islands — a feed's right-click menu and a
 * hover toolbar's overflow menu in the pop-out window are different component trees, possibly in
 * different bundles — so every opener announces itself and every other open menu closes on hearing a
 * token that is not its own.
 */
export const MESSAGE_MENU_OPEN_EVENT = "projective:message-menu-open";

/** The `detail` payload for {@link MESSAGE_MENU_OPEN_EVENT}. */
export interface MessageMenuOpenDetail {
	/** A token unique to the menu that just opened. */
	owner: string;
}
