/**
 * emit-assets.ts — `02_assets.sql`: one `files.items` row per seeded image, then the links that
 * hang off them (profile avatar/banner, employer logos on experience entries).
 *
 * The BYTES are not written here. They are copied by the generator into `supabase/seed-assets/…`
 * in the `{bucket}/{anchor}/{name}` layout the storage RLS policies key on, and `supabase db reset`
 * uploads that tree through the storage API (`[storage.buckets.*].objects_path` in config.toml),
 * which is what creates the matching `storage.objects` rows. `files.items` carries only
 * `bucket_id` + `storage_path` — no FK onto `storage.objects` — so the two halves can land in either
 * order and the seed stays pure SQL.
 */

import { ago, HEADER, id, insert, jsonb, q, uuidFor } from "./sql.ts";
import type { Asset, World } from "./resolve.ts";

/** The public object URL the storage API serves for a public bucket, relative to the API origin. */
export function publicUrlOf(asset: Asset): string | null {
	if (asset.bucket === "project") return null;
	return `/storage/v1/object/public/${asset.bucket}/${asset.path}`;
}

function metadataOf(asset: Asset): string {
	const media = asset.width && asset.height
		? {
			kind: "image",
			width: asset.width,
			height: asset.height,
			aspectRatio: Math.round((asset.width / asset.height) * 10000) / 10000,
			blurhash: null,
			colors: null,
			animated: false,
			vector: false,
			hasAlpha: null,
		}
		: { kind: "generic" };
	const url = publicUrlOf(asset);
	return jsonb({
		version: 1,
		source: "server",
		extractedAt: "2026-09-21T00:00:00.000Z",
		media,
		notes: asset.width ? [] : ["Dimensions unavailable at seed time."],
		// Read by the SQL read RPCs (`metadata->'variants'`) for avatars and logos.
		...(url ? { variants: { original: url } } : {}),
	});
}

export function emitAssets(world: World): string {
	const out: string[] = [
		HEADER(
			"02_assets.sql — files.items rows for every seeded image, and the profile links onto them",
			"Bytes live in supabase/seed-assets/<bucket>/<anchor>/<name> and are uploaded by `supabase db reset` via config.toml [storage.buckets.*].objects_path. storage_path here is the object name inside the bucket, whose first segment is the RLS anchor (a user, team, business or project id).",
		),
	];

	out.push(
		insert(
			"files.items",
			[
				"id",
				"owner_user_id",
				"bucket_id",
				"storage_path",
				"display_name",
				"original_name",
				"mime_type",
				"size_bytes",
				"category",
				"metadata",
				"status",
				"source",
				"visibility",
				"owner_type",
				"owner_entity_id",
				"content_hash",
				"hash_algo",
				"hash_sampled",
				"purpose",
				"created_at",
				"updated_at",
			],
			world.assets.map((a) => [
				id(a.id),
				id(a.ownerUserId),
				q(a.bucket),
				q(a.path),
				q(a.displayName),
				q(a.source),
				q(a.mime),
				String(a.sizeBytes),
				"'Image'",
				metadataOf(a),
				"'uploaded'",
				"'supabase'",
				q(a.visibility),
				q(a.ownerType),
				id(a.ownerEntityId),
				q(a.sha256),
				"'sha-256'",
				"false",
				q(a.purpose ?? "library"),
				ago(a.createdDaysAgo),
				ago(a.createdDaysAgo),
			]),
		),
	);

	// Profile photo + banner.
	for (const p of world.personas.values()) {
		const avatar = world.personaAvatar.get(p.key);
		const banner = world.personaBanner.get(p.key);
		if (!avatar && !banner) continue;
		out.push(
			`UPDATE org.users_public SET avatar_file_id = ${id(avatar?.id)}, banner_file_id = ${
				id(banner?.id)
			} WHERE user_id = ${id(p.userId)};`,
		);
	}
	out.push("");

	// Education + experience (experience may carry an employer logo file).
	const education: string[][] = [];
	const experience: string[][] = [];
	for (const p of world.personas.values()) {
		(p.education ?? []).forEach((e, i) => {
			education.push([
				id(uuidFor("education", `${p.handle}:${i}`)),
				id(p.userId),
				q(e.school),
				q(e.credential),
				q(e.field),
				q(e.startYear),
				q(e.endYear),
				String(i),
			]);
		});
		(p.experience ?? []).forEach((x, i) => {
			const logo = world.experienceLogo.get(`${p.key}:${i}`);
			experience.push([
				id(uuidFor("experience", `${p.handle}:${i}`)),
				id(p.userId),
				q(x.org),
				q(x.role),
				q(x.startYear),
				q(x.endYear),
				String(x.endYear === null),
				q(x.summary),
				id(logo?.id),
				String(i),
			]);
		});
	}
	out.push(
		insert(
			"org.education_entries",
			["id", "user_id", "school", "credential", "field", "start_year", "end_year", "sort_order"],
			education,
		),
	);
	out.push(
		insert(
			"org.experience_entries",
			[
				"id",
				"user_id",
				"org_name",
				"role",
				"start_year",
				"end_year",
				"is_current",
				"summary",
				"logo_file_id",
				"sort_order",
			],
			experience,
		),
	);

	return out.join("\n");
}
