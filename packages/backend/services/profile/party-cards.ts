import type { SupabaseClient } from "supabaseClient";
import type { ImagePlaceholder } from "@projective/types/files";
import { mediaPlaceholder, mediaUrl, parseMediaRef } from "../files/public-media.ts";

/**
 * party-cards — a person's public identity (name, handle, avatar) for EVERY surface that shows other
 * people: project rosters and feeds, message senders, contact pickers, the nav's own account button.
 *
 * One batch call (`org.get_party_cards`), one definer function behind it, one mapping here. That
 * single path is what "updating an avatar propagates everywhere" means in practice: no surface keeps
 * a copy of anyone's picture, so the next read of any of them shows the new one. It is also the one
 * door that reads OTHER people's `org.users_public` rows without the columns a visitor may never see
 * (`dob` above all) — the definer projects four facts and a picture.
 */

// #region Types

/** One person as every other surface shows them. */
export interface PartyCard {
	userId: string;
	/** The bare username (no `@`). */
	username: string;
	/** "First Last", falling back to the username, then "Unknown". */
	name: string;
	isFreelancer: boolean;
	/** The avatar at the `sm` tier (chrome and list rows), or `null` for the initials fallback. */
	avatar: string | null;
	/** The avatar at the `md` tier (a larger disc), or `null`. */
	avatarLarge: string | null;
	avatarPlaceholder?: ImagePlaceholder;
}

/** One row of `org.get_party_cards`, as the definer returns it. */
export interface CardRow {
	user_id: string;
	username: string | null;
	first_name: string | null;
	last_name: string | null;
	is_freelancer: boolean | null;
	avatar: unknown;
}

// #endregion

// #region Mapping

/** The display name of a card row — composed, else the username, else "Unknown". */
export function cardName(row: Pick<CardRow, "first_name" | "last_name" | "username">): string {
	const composed = [row.first_name, row.last_name]
		.map((part) => part?.trim() ?? "")
		.filter((part) => part.length > 0)
		.join(" ");
	return composed || row.username?.trim() || "Unknown";
}

function toCard(row: CardRow): PartyCard {
	const ref = parseMediaRef(row.avatar);
	return {
		userId: row.user_id,
		username: row.username ?? "",
		name: cardName(row),
		isFreelancer: !!row.is_freelancer,
		avatar: mediaUrl(ref, "sm"),
		avatarLarge: mediaUrl(ref, "md"),
		avatarPlaceholder: mediaPlaceholder(ref),
	};
}

// #endregion

// #region Fetch

/** Ids per `org.get_party_cards` call — the function reads `p_user_ids[1:500]` and ignores the rest. */
const PARTY_CARDS_MAX = 500;

/**
 * The longest avatar URL a person projection carries (`ProjectParty`, `MessageSender`,
 * `MessagingContact` all bound `avatar` at 400). A longer one is dropped, never truncated: a
 * shortened URL is a broken image, and `null` already means "draw the initials".
 */
const AVATAR_URL_MAX = 400;

/**
 * Resolve identity cards for a set of user ids through the caller's own client (the function is
 * granted to `authenticated`). Missing ids are absent from the map; a failure returns an empty map,
 * so every consumer degrades to its existing "Unknown" + initials placeholder rather than 500ing.
 */
export async function fetchPartyCards(
	client: SupabaseClient,
	userIds: readonly (string | null | undefined)[],
): Promise<Map<string, PartyCard>> {
	const out = new Map<string, PartyCard>();
	const rows = await fetchPartyRows(client, userIds);
	if (!rows) return out;
	for (const [id, row] of rows) out.set(id, toCard(row));
	return out;
}

/**
 * A person's raw name columns plus the avatar's `sm` URL — for readers that already hold their own
 * name mapping and only lacked the picture (project rosters, message senders, contact lists).
 */
export interface PartyRowWithAvatar {
	user_id: string;
	username: string;
	first_name: string | null;
	last_name: string | null;
	/** The avatar at the `sm` tier, or `null` for the initials fallback. */
	avatar: string | null;
}

/**
 * The same batch read, as raw rows. `null` when the read itself failed — distinct from an empty map,
 * so a caller can fall back to its own column read rather than render everyone as "Unknown".
 */
export async function fetchPartyRows(
	client: SupabaseClient,
	userIds: readonly (string | null | undefined)[],
): Promise<Map<string, CardRow & { avatar_url: string | null }> | null> {
	const out = new Map<string, CardRow & { avatar_url: string | null }>();
	const unique = [...new Set(userIds.filter((id): id is string => !!id && id.length > 0))];
	if (unique.length === 0) return out;
	const chunks: string[][] = [];
	for (let i = 0; i < unique.length; i += PARTY_CARDS_MAX) {
		chunks.push(unique.slice(i, i + PARTY_CARDS_MAX));
	}
	try {
		const answers = await Promise.all(
			chunks.map((ids) => client.schema("org").rpc("get_party_cards", { p_user_ids: ids })),
		);
		for (const { data, error } of answers) {
			// One failed chunk fails the read: a caller falling back to its own column read is better
			// than a roster in which some people have names and the rest are "Unknown".
			if (error || !Array.isArray(data)) return null;
			for (const row of data as CardRow[]) {
				const url = mediaUrl(parseMediaRef(row.avatar), "sm");
				out.set(row.user_id, {
					...row,
					avatar_url: url && url.length <= AVATAR_URL_MAX ? url : null,
				});
			}
		}
		return out;
	} catch {
		return null;
	}
}

/** Map {@link fetchPartyRows}' output onto the plain row shape (with its avatar URL). */
export function partyRowsWithAvatars(
	rows: Map<string, CardRow & { avatar_url: string | null }>,
): Map<string, PartyRowWithAvatar> {
	const out = new Map<string, PartyRowWithAvatar>();
	for (const [id, row] of rows) {
		out.set(id, {
			user_id: row.user_id,
			username: row.username ?? "",
			first_name: row.first_name,
			last_name: row.last_name,
			avatar: row.avatar_url,
		});
	}
	return out;
}

// #endregion
