import type { SupabaseClient } from "supabaseClient";
import { resolveAvatarUrl } from "@projective/types/user";
import type {
	FollowDirection,
	ProfileConnection,
	ProfileConnections,
	ProfileKind,
	ProfileOwnerType,
} from "@projective/types/profile";
import { mediaUrl, parseMediaRef } from "../files/public-media.ts";

/**
 * live-follows — reading the public follow graph (`org.profile_follows`) and turning its bare
 * `(type, id)` ends into the people they name, through `org.get_profile_cards`. That definer drops
 * every profile the caller may not see, so a private profile never surfaces through someone else's
 * followers list or anybody's `/saved` page.
 */

// #region Profile cards

/** A profile's public identity, whatever kind it is. */
export interface ProfileCard {
	type: ProfileOwnerType;
	id: string;
	kind: ProfileKind;
	handle: string;
	name: string;
	/** The `sm` avatar (uploaded, else the sign-in picture), or `null` for the default picture. */
	avatar: string | null;
}

interface ProfileCardRow {
	owner_type: ProfileOwnerType;
	owner_id: string;
	kind: ProfileKind;
	handle: string;
	name: string | null;
	avatar: unknown;
	oauth_avatar: string | null;
}

/** The {@link fetchProfileCards} map key for one profile. */
export function profileKey(type: string, id: string): string {
	return `${type}:${id}`;
}

/** Cards for `(type, id)` pairs, keyed by {@link profileKey}. A pair the caller may not see is absent. */
export async function fetchProfileCards(
	client: SupabaseClient,
	refs: readonly { type: string; id: string }[],
): Promise<Map<string, ProfileCard>> {
	const out = new Map<string, ProfileCard>();
	if (refs.length === 0) return out;
	const { data, error } = await client.schema("org").rpc("get_profile_cards", {
		p_types: refs.map((r) => r.type),
		p_ids: refs.map((r) => r.id),
	});
	if (error) throw new Error(`org.get_profile_cards failed: ${error.message}`);
	for (const row of (data ?? []) as ProfileCardRow[]) {
		out.set(profileKey(row.owner_type, row.owner_id), {
			type: row.owner_type,
			id: row.owner_id,
			kind: row.kind,
			handle: row.handle,
			name: row.name?.trim() || row.handle,
			avatar: resolveAvatarUrl({
				uploaded: mediaUrl(parseMediaRef(row.avatar), "sm"),
				oauth: row.oauth_avatar,
			}),
		});
	}
	return out;
}

// #endregion

// #region Follow edges

/** One edge end, with when it was drawn. */
export interface FollowEdge {
	type: ProfileOwnerType;
	id: string;
	at: string;
}

/** Rows per followers / following page. */
export const CONNECTIONS_PAGE = 30;

/**
 * The profiles a person follows, newest first — the `/saved` People tab's "People you follow".
 * shortcut: capped at `limit` edges; page by `created_at` when someone follows more than that.
 */
export async function fetchFollowing(
	client: SupabaseClient,
	userId: string,
	limit = 200,
): Promise<FollowEdge[]> {
	const { data, error } = await client.schema("org").from("profile_follows")
		.select("target_entity_type, target_entity_id, created_at")
		.eq("follower_user_id", userId)
		.order("created_at", { ascending: false })
		.limit(limit);
	if (error) throw new Error(`org.profile_follows read failed: ${error.message}`);
	return ((data ?? []) as { target_entity_type: ProfileOwnerType; target_entity_id: string; created_at: string }[])
		.map((r) => ({ type: r.target_entity_type, id: r.target_entity_id, at: r.created_at }));
}

/**
 * One page of a profile's followers or (a person's) following, newest first, keyset on the follow
 * instant. Only a person follows, so a team's, business's or organisation's `following` is empty.
 */
export async function fetchConnections(
	client: SupabaseClient,
	owner: { type: ProfileOwnerType; id: string },
	direction: FollowDirection,
	cursor: string | undefined,
): Promise<ProfileConnections> {
	if (direction === "following" && owner.type !== "user") return { items: [], nextCursor: null };
	let query = client.schema("org").from("profile_follows")
		.select("follower_user_id, target_entity_type, target_entity_id, created_at");
	query = direction === "followers"
		? query.eq("target_entity_type", owner.type).eq("target_entity_id", owner.id)
		: query.eq("follower_user_id", owner.id);
	if (cursor) query = query.lt("created_at", cursor);
	const { data, error } = await query.order("created_at", { ascending: false }).limit(CONNECTIONS_PAGE + 1);
	if (error) throw new Error(`org.profile_follows read failed: ${error.message}`);
	const rows = (data ?? []) as {
		follower_user_id: string;
		target_entity_type: ProfileOwnerType;
		target_entity_id: string;
		created_at: string;
	}[];
	const page = rows.slice(0, CONNECTIONS_PAGE);
	const ends = page.map((r) =>
		direction === "followers"
			? { type: "user" as const, id: r.follower_user_id }
			: { type: r.target_entity_type, id: r.target_entity_id }
	);
	const cards = await fetchProfileCards(client, ends);
	const items: ProfileConnection[] = [];
	for (const end of ends) {
		const card = cards.get(profileKey(end.type, end.id));
		if (card) items.push({ handle: card.handle, name: card.name, kind: card.kind, avatar: card.avatar });
	}
	return {
		items,
		nextCursor: rows.length > CONNECTIONS_PAGE ? page[page.length - 1].created_at : null,
	};
}

// #endregion
