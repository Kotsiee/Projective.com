/**
 * emit-profiles.ts — `10_profiles.sql`: the public profile's presentation layer — the showcase grid,
 * a freelancer's selected work, an individual's certifications, and the owner's privacy switches.
 *
 * The data is `profiles.ts`; the files it points at are resolved in `resolve.ts` (showcase slots are
 * renditions in the `showcase` bucket, portfolio covers library uploads in `public_assets`) and their
 * `files.items` rows are written by `02_assets.sql`, so every FK here names a row that already exists.
 * Numbered 10 so it runs after every file it depends on; `09_search.sql` projects none of these tables.
 *
 * The live write path's rules are asserted HERE, at generate time, rather than discovered as a
 * constraint violation at reset time: a portfolio belongs to a freelancer (its FK is
 * `org.freelancer_profiles`), and a verified certification carries the instant it was verified.
 */

import { CERTIFICATIONS, PORTFOLIO, PROFILE_SETTINGS } from "./profiles.ts";
import { party, persona, type World } from "./resolve.ts";
import { ago, HEADER, id, insert, q, uuidFor } from "./sql.ts";

/** The polymorphic owner a profile table keys on: `('user', user_id)` or `(kind, entity_id)`. */
function ownerOf(world: World, key: string): { type: string; id: string; createdBy: string } {
	const owner = party(world, key);
	return owner.kind === "user"
		? { type: "user", id: owner.persona.userId, createdBy: owner.persona.userId }
		: { type: owner.kind, id: owner.entity.entityId, createdBy: owner.entity.ownerUserId };
}

export function emitProfiles(world: World): string {
	const out: string[] = [
		HEADER(
			"10_profiles.sql — the public profile's presentation: showcase, selected work, certifications, privacy",
			"Rows keyed by persona / entity in supabase/seeds/gen/profiles.ts. The files they reference are written by 02_assets.sql; showcase slots are renditions in the public `showcase` bucket, exactly as the media pipeline lays one out.",
		),
	];

	// #region Showcase — slot 1 is the thumbnail every card of the profile leads with.
	const slots: string[][] = [];
	for (const [key, list] of world.showcaseSlots) {
		const owner = ownerOf(world, key);
		list.forEach(({ asset, alt }, i) => {
			slots.push([
				id(uuidFor("showcase-slot", `${key}:${i + 1}`)),
				q(owner.type),
				id(owner.id),
				String(i + 1),
				id(asset.id),
				q(alt),
				id(owner.createdBy),
				ago(30 - i),
				ago(30 - i),
			]);
		});
	}
	// The arbiter is the SLOT, not the row id: once an owner has placed something at a position, a
	// re-run of the seed must leave it there rather than fail on the slot's uniqueness.
	out.push(
		insert(
			"org.profile_showcase_items",
			["id", "owner_type", "owner_id", "position", "file_id", "alt", "created_by", "created_at", "updated_at"],
			slots,
			"(owner_type, owner_id, position)",
		),
	);
	// #endregion

	// #region Selected work
	const pieces: string[][] = [];
	const nth = new Map<string, number>();
	for (const piece of PORTFOLIO) {
		const p = persona(world, piece.persona);
		if (p.role !== "freelancer") {
			throw new Error(`profiles: "${piece.persona}" is not a freelancer, so it has no portfolio`);
		}
		const i = nth.get(piece.persona) ?? 0;
		nth.set(piece.persona, i + 1);
		const cover = world.portfolioCover.get(`${piece.persona}:${i}`);
		if (!cover) throw new Error(`profiles: no cover resolved for ${piece.persona}:${i}`);
		pieces.push([
			id(uuidFor("portfolio", `${piece.persona}:${i}`)),
			id(p.userId),
			q(piece.title),
			q(piece.description),
			id(cover.id),
			q(piece.client ?? null),
			q(piece.category ?? null),
			String(i),
			"true",
			ago(60 - i * 7),
		]);
	}
	out.push(
		insert(
			"org.portfolios",
			[
				"id",
				"user_id",
				"title",
				"description",
				"cover_file_id",
				"client_name",
				"category",
				"sort_order",
				"is_public",
				"created_at",
			],
			pieces,
		),
	);
	// #endregion

	// #region Certifications
	const certs: string[][] = [];
	const certNth = new Map<string, number>();
	for (const c of CERTIFICATIONS) {
		const p = persona(world, c.persona);
		if (c.url && !/^https:\/\/\S+$/i.test(c.url)) {
			throw new Error(`profiles: certification link for ${c.persona} must be https`);
		}
		const i = certNth.get(c.persona) ?? 0;
		certNth.set(c.persona, i + 1);
		const verified = c.verifiedDaysAgo !== undefined;
		certs.push([
			id(uuidFor("certification", `${c.persona}:${i}`)),
			id(p.userId),
			q(c.name),
			q(c.issuer),
			q(c.issuedYear),
			q(c.expiresYear ?? null),
			q(c.url ?? null),
			String(verified),
			verified ? ago(c.verifiedDaysAgo!) : "NULL",
			String(i),
			ago(200 - i * 10),
		]);
	}
	out.push(
		insert(
			"org.certifications",
			[
				"id",
				"user_id",
				"name",
				"issuer",
				"issued_year",
				"expires_year",
				"credential_url",
				"verified",
				"verified_at",
				"sort_order",
				"created_at",
			],
			certs,
		),
	);
	// #endregion

	// #region Privacy switches — only the owners who departed from the defaults.
	const settings: string[][] = [];
	for (const s of PROFILE_SETTINGS) {
		const owner = ownerOf(world, s.owner);
		settings.push([
			q(owner.type),
			id(owner.id),
			String(s.allowAvatarExpand ?? false),
			String(s.showLocation ?? true),
			String(s.showLocalTime ?? true),
		]);
	}
	out.push(
		insert(
			"org.profile_settings",
			["owner_type", "owner_id", "allow_avatar_expand", "show_location", "show_local_time"],
			settings,
			"(owner_type, owner_id)",
		),
	);
	// #endregion

	return out.join("\n");
}
