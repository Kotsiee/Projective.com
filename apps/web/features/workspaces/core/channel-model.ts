import {
	CHANNEL_NAME_MAX,
	CHANNEL_NAME_MIN,
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
