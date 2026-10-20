import {
	CHANNEL_EMOJI_MAX,
	CHANNEL_NAME_MAX,
	CHANNEL_NAME_MIN,
	CHANNEL_TITLE_MAX,
	CHANNEL_TOPIC_MAX,
	channelSlugOf,
	type EntityChannel,
	isChannelSlug,
} from "@projective/types/workspace";

/**
 * channel-model — the entity channels' client rules (Decision #306), pure so `deno test` loads them.
 *
 * A channel's name IS its address (`/teams/:h/channels/<name>`), so what the reader types is folded to
 * the database's charset as they type — the server's own `channelSlugOf`, then accents stripped and
 * any other run of characters to one hyphen — and the dialog shows the result (`# delivery-sync`)
 * before anything is sent. The database stays the authority: `isChannelSlug` is pinned to
 * `comms.create_entity_channel`'s check by the types contract test.
 */

// #region Names
/** The typed name folded to a channel name ("Delivery Sync" → `delivery-sync`). */
export function channelNameFrom(input: string): string {
	return channelSlugOf(input)
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, CHANNEL_NAME_MAX)
		.replace(/-+$/g, "");
}

/** Why a folded name cannot be created, or `null` when it can. */
export function channelNameRefusal(
	name: string,
	existing: readonly Pick<EntityChannel, "slug">[],
): string | null {
	if (name.length === 0) return "Give the channel a name.";
	if (name.length < CHANNEL_NAME_MIN) {
		return `Channel names are at least ${CHANNEL_NAME_MIN} characters.`;
	}
	if (!isChannelSlug(name)) return "Use letters, numbers and hyphens.";
	if (existing.some((c) => c.slug === name)) return `# ${name} already exists.`;
	return null;
}

/** A channel's address in the console. */
export function channelHref(base: string, slug: string): string {
	return `${base}/${encodeURIComponent(slug)}`;
}
// #endregion

// #region Views
/** A channel's views (Decision #308): its chat, and the files shared in it. */
export type ChannelTabKey = "chat" | "files";

/** One channel view — `seg` is its path segment under the channel's address (`""` for Chat). */
export interface ChannelTabDef {
	key: ChannelTabKey;
	label: string;
	seg: string;
}

/** The channel views, in tab order. Each is an address, never a client-only toggle. */
export const CHANNEL_TABS: readonly ChannelTabDef[] = [
	{ key: "chat", label: "Chat", seg: "" },
	{ key: "files", label: "Files", seg: "files" },
];

/**
 * The view a console path names — the segment after `/teams/:h/channels/:channel` — or Chat when it
 * names none or one this list does not hold.
 */
export function channelTabOfPath(pathname: string): ChannelTabKey {
	const seg = pathname.split("/").filter(Boolean)[4] ?? "";
	return CHANNEL_TABS.find((t) => t.seg === seg && seg.length > 0)?.key ?? "chat";
}

/** A view's address under a channel's own. */
export function channelTabHref(channelBase: string, tab: ChannelTabKey): string {
	const seg = CHANNEL_TABS.find((t) => t.key === tab)?.seg ?? "";
	return seg ? `${channelBase}/${seg}` : channelBase;
}
// #endregion

// #region Marks
/**
 * The emoji the Edit channel dialog offers (Decision #308) — work-shaped marks, not reactions. Any other
 * single emoji can still be typed into the dialog's field.
 */
export const CHANNEL_EMOJI: readonly string[] = [
	"💬",
	"📣",
	"🚀",
	"🛠️",
	"🎨",
	"🧪",
	"📦",
	"📅",
	"💡",
	"📌",
	"🔒",
	"🤝",
	"💰",
	"📈",
	"🐛",
	"✅",
];

/** What a channel's mark draws: its photo, else its emoji, else the `#`. */
export type ChannelMark =
	| { kind: "photo"; src: string }
	| { kind: "emoji"; emoji: string }
	| { kind: "hash" };

/** The mark for a channel, by precedence: photo → emoji → `#`. */
export function channelMarkOf(channel: Pick<EntityChannel, "avatar" | "emoji">): ChannelMark {
	if (channel.avatar) return { kind: "photo", src: channel.avatar };
	if (channel.emoji) return { kind: "emoji", emoji: channel.emoji };
	return { kind: "hash" };
}
// #endregion

// #region Edit
/** The Edit channel dialog's fields, as typed. */
export interface ChannelEditDraft {
	name: string;
	topic: string;
	emoji: string;
}

/** Why a draft cannot be saved, per field — empty when it can. Mirrors `update_entity_channel`. */
export function channelEditRefusals(
	draft: ChannelEditDraft,
): Partial<Record<keyof ChannelEditDraft, string>> {
	const out: Partial<Record<keyof ChannelEditDraft, string>> = {};
	if (draft.name.trim().length > CHANNEL_TITLE_MAX) {
		out.name = `Keep the name to ${CHANNEL_TITLE_MAX} characters.`;
	}
	if (draft.topic.trim().length > CHANNEL_TOPIC_MAX) {
		out.topic = `Keep the topic to ${CHANNEL_TOPIC_MAX} characters.`;
	}
	const emoji = draft.emoji.trim();
	if (emoji.length > CHANNEL_EMOJI_MAX || /[\p{L}\p{N}]/u.test(emoji)) {
		out.emoji = "Choose a single emoji.";
	}
	return out;
}

/** Whether a draft changes anything about the channel. */
export function channelEditChanged(
	channel: Pick<EntityChannel, "name" | "topic" | "emoji">,
	draft: ChannelEditDraft,
): boolean {
	return (channel.name ?? "") !== draft.name.trim() ||
		(channel.topic ?? "") !== draft.topic.trim() ||
		(channel.emoji ?? "") !== draft.emoji.trim();
}
// #endregion
