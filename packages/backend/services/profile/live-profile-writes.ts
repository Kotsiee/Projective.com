import type { SupabaseClient } from "supabaseClient";
import type {
	ApplyMedia,
	ProfileOwnerType,
	ProfileSavePatch,
	SaveShowcase,
	ShowcaseSlot,
} from "@projective/types/profile";
import {
	ASSET_METADATA_VERSION,
	type AssetMetadata,
	type ImagePlaceholder as ProfileImagePlaceholder,
	INITIAL_CROP,
	type RenditionPurpose,
	renditionLocation,
	SNIFF_BYTES,
	sniffBytes,
	unsupportedReason,
	VARIANT_TIERS,
	variantObjectPath,
	type VariantTier,
} from "@projective/types/files";
import { fail, type FieldErrors, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import { downloadObject, removeObjects, uploadObject } from "../../core/storage-signed.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { MediaPipeline, MediaRejectedError, MediaUnavailableError } from "../media/pipeline.ts";
import { type LibrarySource, readLibrarySource } from "../media/library.ts";
import { mediaPlaceholder, mediaUrl, parseMediaRef } from "../files/public-media.ts";
import { showcaseSlotsOf } from "./live-profile.ts";

/**
 * live-profile-writes — every OWNER write to a profile, live.
 *
 * The profile tables carry no client write policy at all: the only doors are the definer RPCs
 * (`org.save_profile`, `org.set_profile_avatar`, `org.save_showcase`), each of which re-checks that
 * the caller MANAGES the profile (`org.fn_profile_manages`) and every hard limit, whatever the route
 * already validated. So every write here is made under the caller's own session and a refusal from
 * the database is the final word, mapped onto a field-keyed {@link ServiceResult} by
 * {@link refusalFrom}.
 *
 * Media is the one two-stage write. The pipeline (service role) cuts a public RENDITION from one of
 * the caller's own library assets and records it; only then does the definer RPC — under the
 * caller's session — decide whether that rendition may go on this profile. If it refuses, the
 * rendition is retired again, so a refused write never leaves a public object behind.
 */

// #region Types

/** The profile a write is addressed to — resolved from the handle, never taken from the request. */
export interface ProfileOwner {
	type: ProfileOwnerType;
	id: string;
}

/** The profile's media as the editor redraws it after a media write. */
export interface ProfileMediaState {
	avatar: { url: string; full?: string; placeholder?: ProfileImagePlaceholder } | null;
	showcase: ShowcaseSlot[];
}

// #endregion

// #region Refusals

const UNAVAILABLE = "Your changes couldn't be saved right now. Try again in a moment.";

/** `first_name` → `firstName`; a dotted path keeps its index (`experience.2`). */
function camelField(field: string): string {
	const [head, ...rest] = field.split(".");
	const camel = head.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
	return [camel, ...rest].join(".");
}

/**
 * Map a database refusal onto the result a route returns. The definer functions raise `22023` with
 * `<field>: <reason>` and `42501` for authority; anything else is the database being unavailable, and
 * says so rather than blaming the input.
 */
export function refusalFrom(error: { code?: string; message?: string } | null): ServiceResult<never> {
	const message = error?.message ?? "";
	if (error?.code === "PGRST301" || error?.code === "PGRST302" || /jwt/i.test(message)) {
		return fail(401, { message: "Your session has expired. Sign in again to save." });
	}
	const match = /^([a-z_]+(?:\.\d+)?):\s*(.+)$/i.exec(message);
	if (error?.code === "42501") {
		return fail(403, { message: match ? capitalise(match[2]) : "You can't edit this profile." });
	}
	if (error?.code === "22023" || error?.code === "23514" || error?.code === "22P02") {
		if (match) {
			const reason = capitalise(match[2]);
			const errors: FieldErrors = { [camelField(match[1])]: reason };
			return fail(422, { message: reason, errors });
		}
		return fail(422, { message: "Some of these details aren't valid." });
	}
	return fail(503, { message: UNAVAILABLE });
}

function capitalise(s: string): string {
	const trimmed = s.trim();
	return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

function denied(): ServiceResult<never> {
	return fail(401, { message: "Sign in to edit your profile." });
}

// #endregion

// #region Save

/** The snake_case patch `org.save_profile` reads. Only the keys present in `patch` travel. */
export function savePayload(patch: ProfileSavePatch): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const copy = (from: keyof ProfileSavePatch, to: string) => {
		if (patch[from] !== undefined) out[to] = patch[from];
	};
	copy("firstName", "first_name");
	copy("lastName", "last_name");
	copy("name", "name");
	copy("headline", "headline");
	copy("story", "story");
	copy("city", "city");
	copy("country", "country");
	copy("timezone", "timezone");
	copy("visibility", "visibility");
	if (patch.languages) out.languages = patch.languages.map((l) => ({ code: l.code, level: l.level }));
	if (patch.skills) out.skills = patch.skills;
	if (patch.experience) {
		out.experience = patch.experience.map((e) => ({
			id: e.id ?? null,
			org_name: e.orgName,
			role: e.role,
			start_year: e.startYear,
			end_year: e.isCurrent ? null : e.endYear ?? null,
			is_current: e.isCurrent,
			summary: e.summary,
		}));
	}
	if (patch.education) {
		out.education = patch.education.map((d) => ({
			id: d.id ?? null,
			school: d.school,
			credential: d.credential,
			field: d.field,
			start_year: d.startYear,
			end_year: d.endYear ?? null,
		}));
	}
	if (patch.certifications) {
		// `verified` never travels: it is the platform's claim, not the owner's.
		out.certifications = patch.certifications.map((c) => ({
			id: c.id ?? null,
			name: c.name,
			issuer: c.issuer,
			issued_year: c.issuedYear,
			expires_year: c.expiresYear ?? null,
			credential_url: c.credentialUrl ?? null,
		}));
	}
	if (patch.settings) {
		const s = patch.settings;
		out.settings = {
			...(s.allowAvatarExpand !== undefined ? { allow_avatar_expand: s.allowAvatarExpand } : {}),
			...(s.showLocation !== undefined ? { show_location: s.showLocation } : {}),
			...(s.showLocalTime !== undefined ? { show_local_time: s.showLocalTime } : {}),
		};
	}
	return out;
}

/** Save the owner-editable fields in one transaction. */
export async function saveProfile(
	owner: ProfileOwner,
	patch: ProfileSavePatch,
	actor: ReadActor,
): Promise<ServiceResult<{ saved: true }>> {
	if (!canReadLive(actor)) return denied();
	try {
		const { error } = await getUserClient(actor.accessToken).schema("org").rpc("save_profile", {
			p_owner_type: owner.type,
			p_owner_id: owner.id,
			p_patch: savePayload(patch),
		});
		if (error) return refusalFrom(error);
		return ok({ saved: true as const });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion

// #region Media state

interface RawMediaState {
	avatar: unknown;
	showcase: Array<{ position: number; alt: string; media: unknown }>;
}

/** Read back the profile's media as the editor draws it — what is STORED, after a write. */
export async function readMediaState(
	client: SupabaseClient,
	handle: string,
): Promise<ProfileMediaState | undefined> {
	const { data, error } = await client.schema("org").rpc("get_profile_view", { p_handle: handle });
	if (error || !data) return undefined;
	const raw = data as RawMediaState;
	const avatarRef = parseMediaRef(raw.avatar);
	return {
		avatar: avatarRef
			? {
				url: mediaUrl(avatarRef, "md") ?? "",
				full: mediaUrl(avatarRef, "lg") ?? undefined,
				placeholder: mediaPlaceholder(avatarRef),
			}
			: null,
		showcase: showcaseSlotsOf(raw.showcase ?? []),
	};
}

// #endregion

// #region Renditions

/** A rendition written to storage + its row, which can be retired again if the profile refuses it. */
interface Rendition {
	id: string;
	bucket: "avatars" | "showcase";
	paths: string[];
}

/** Retire a rendition the profile would not take: soft-delete its row, remove its objects. */
async function retireRendition(rendition: Rendition): Promise<void> {
	try {
		await getServiceClient().schema("files").from("items")
			.update({ deleted_at: new Date().toISOString() })
			.eq("id", rendition.id);
	} catch { /* the row stays; it references objects about to be removed and lists nowhere */ }
	await removeObjects(rendition.bucket, rendition.paths);
}

/** The display name a rendition row carries in the owner's history. */
function renditionName(purpose: RenditionPurpose, position: number | undefined): string {
	return purpose === "avatar" ? "Profile photo" : `Showcase slot ${position ?? 1}`;
}

/**
 * Cut and store a rendition of `source` for `purpose`. Stills are re-drawn by the pipeline (crop
 * clamped against the decoded pixels, re-encoded WebP, no EXIF); a video is published as uploaded
 * with the poster tiers the library already holds for it.
 */
async function writeRendition(
	owner: ProfileOwner,
	actor: ReadActor & { accessToken: string },
	source: LibrarySource,
	input: ApplyMedia,
): Promise<Rendition> {
	const purpose: RenditionPurpose = input.target;
	const bucket = purpose === "avatar" ? "avatars" as const : "showcase" as const;
	const id = crypto.randomUUID();
	const rendition: Rendition = { id, bucket, paths: [] };
	const service = getServiceClient();

	try {
		const bytes = await downloadObject(source.bucket, source.path);
		if (!bytes) throw new MediaUnavailableError("That file couldn't be read. Try another.");

		let fullPath: string;
		let mime: string;
		let size: number;
		let metadata: AssetMetadata;
		const variants: Array<{ tier: VariantTier; path: string; width: number; height: number; size: number }> = [];

		if (source.kind === "image") {
			const sniffed = sniffBytes(bytes.subarray(0, SNIFF_BYTES));
			const reason = unsupportedReason(sniffed, false);
			if (reason || !sniffed) throw new MediaRejectedError(reason ?? "That file can't be used here.");
			const result = await MediaPipeline.run({
				kind: "render",
				bytes,
				mime: sniffed.mime,
				purpose,
				crop: input.crop ?? INITIAL_CROP,
			});
			if (!result.full) throw new MediaUnavailableError("The picture couldn't be processed.");
			const location = renditionLocation(bucket, owner.id, id, "full.webp");
			fullPath = location.path;
			mime = "image/webp";
			size = result.full.bytes.byteLength;
			if (!await uploadObject(bucket, fullPath, result.full.bytes, mime, { immutable: true })) {
				throw new MediaUnavailableError("The picture couldn't be stored.");
			}
			rendition.paths.push(fullPath);
			for (const tier of VARIANT_TIERS) {
				const t = result.tiers[tier];
				const tierPath = variantObjectPath(fullPath, tier);
				if (!await uploadObject(bucket, tierPath, t.bytes, "image/webp", { immutable: true })) {
					throw new MediaUnavailableError("The picture couldn't be stored.");
				}
				rendition.paths.push(tierPath);
				variants.push({ tier, path: tierPath, width: t.width, height: t.height, size: t.bytes.byteLength });
			}
			metadata = {
				version: ASSET_METADATA_VERSION as 1,
				source: "server",
				extractedAt: new Date().toISOString(),
				media: {
					kind: "image",
					width: result.full.width,
					height: result.full.height,
					aspectRatio: Math.round((result.full.width / result.full.height) * 10_000) / 10_000,
					blurhash: result.blurhash,
					colors: result.colors,
					animated: false,
					vector: false,
					hasAlpha: result.source.hasAlpha,
				},
				notes: [],
			};
		} else {
			const ext = source.mimeType === "video/webm" ? "webm" : source.mimeType === "video/quicktime" ? "mov" : "mp4";
			const location = renditionLocation(bucket, owner.id, id, `video.${ext}`);
			fullPath = location.path;
			mime = source.mimeType;
			size = bytes.byteLength;
			if (!await uploadObject(bucket, fullPath, bytes, mime, { immutable: true })) {
				throw new MediaUnavailableError("The video couldn't be stored.");
			}
			rendition.paths.push(fullPath);
			// The poster stills travel with it: the library's tiers, copied into the public bucket.
			for (const tier of VARIANT_TIERS) {
				const t = source.tiers[tier];
				if (!t) continue;
				const posterBytes = await downloadObject(t.bucket, t.path);
				if (!posterBytes) continue;
				const tierPath = variantObjectPath(fullPath, tier);
				if (!await uploadObject(bucket, tierPath, posterBytes, "image/webp", { immutable: true })) {
					throw new MediaUnavailableError("The video's poster couldn't be stored.");
				}
				rendition.paths.push(tierPath);
				variants.push({ tier, path: tierPath, width: t.width, height: t.height, size: posterBytes.byteLength });
			}
			metadata = source.metadata as AssetMetadata;
		}

		const inserted = await service.schema("files").from("items").insert({
			id,
			owner_user_id: owner.type === "user" ? owner.id : actor.userId,
			owner_type: owner.type,
			owner_entity_id: owner.type === "user" ? null : owner.id,
			bucket_id: bucket,
			storage_path: fullPath,
			display_name: renditionName(purpose, input.position),
			original_name: source.name,
			mime_type: mime,
			size_bytes: size,
			category: mime.startsWith("video/") ? "Video" : "Image",
			metadata,
			status: "uploaded",
			visibility: "public",
			source: "supabase",
			purpose,
			derived_from_id: source.id,
		});
		if (inserted.error) throw new MediaUnavailableError("The picture couldn't be recorded.");
		if (variants.length > 0) {
			const tiers = await service.schema("files").from("item_variants").insert(
				variants.map((v) => ({
					item_id: id,
					tier: v.tier,
					bucket_id: bucket,
					storage_path: v.path,
					mime_type: "image/webp",
					width: v.width,
					height: v.height,
					size_bytes: v.size,
				})),
			);
			if (tiers.error) throw new MediaUnavailableError("The picture couldn't be recorded.");
		}
		return rendition;
	} catch (error) {
		await retireRendition(rendition);
		throw error;
	}
}

// #endregion

// #region Apply media

/**
 * Put one of the caller's library assets on the profile — as the profile photo, or into one
 * showcase slot (replacing whatever was there). Answers with the profile's media as now stored.
 */
export async function applyProfileMedia(
	owner: ProfileOwner,
	handle: string,
	input: ApplyMedia,
	actor: ReadActor,
): Promise<ServiceResult<ProfileMediaState>> {
	if (!canReadLive(actor)) return denied();
	const source = await readLibrarySource(actor, input.sourceAssetId);
	if (!source) {
		return fail(404, {
			message: "That file isn't in your library any more.",
			errors: { sourceAssetId: "not_found" },
		});
	}
	if (source.kind === "video" && input.target === "avatar") {
		return fail(422, { message: "A profile photo has to be a still image.", errors: { sourceAssetId: "video" } });
	}
	if (source.kind === "video" && input.position === 1) {
		return fail(422, {
			message: "The first slot is your profile's thumbnail and has to be a still image.",
			errors: { position: "video_primary" },
		});
	}

	const client = getUserClient(actor.accessToken);
	let rendition: Rendition;
	try {
		rendition = await writeRendition(owner, actor, source, input);
	} catch (error) {
		if (error instanceof MediaRejectedError) {
			return fail(422, { message: error.message, errors: { sourceAssetId: "unsupported" } });
		}
		return fail(503, {
			message: error instanceof MediaUnavailableError ? error.message : UNAVAILABLE,
		});
	}

	try {
		if (input.target === "avatar") {
			const { error } = await client.schema("org").rpc("set_profile_avatar", {
				p_owner_type: owner.type,
				p_owner_id: owner.id,
				p_file_id: rendition.id,
			});
			if (error) {
				await retireRendition(rendition);
				return refusalFrom(error);
			}
		} else {
			const current = await client.schema("org").from("profile_showcase_items")
				.select("position, file_id, alt")
				.eq("owner_type", owner.type)
				.eq("owner_id", owner.id);
			if (current.error) {
				await retireRendition(rendition);
				return fail(503, { message: UNAVAILABLE });
			}
			const position = input.position ?? 1;
			const rows = (current.data ?? []) as Array<{ position: number; file_id: string; alt: string }>;
			const previous = rows.find((r) => r.position === position);
			const slots = [
				...rows.filter((r) => r.position !== position).map((r) => ({
					position: r.position,
					file_id: r.file_id,
					alt: r.alt,
				})),
				{ position, file_id: rendition.id, alt: input.alt ?? previous?.alt ?? "" },
			].sort((a, b) => a.position - b.position);
			const { error } = await client.schema("org").rpc("save_showcase", {
				p_owner_type: owner.type,
				p_owner_id: owner.id,
				p_slots: slots,
			});
			if (error) {
				await retireRendition(rendition);
				return refusalFrom(error);
			}
		}
	} catch {
		await retireRendition(rendition);
		return fail(503, { message: UNAVAILABLE });
	}

	const state = await readMediaState(client, handle);
	return state ? ok(state) : fail(503, { message: UNAVAILABLE });
}

// #endregion

// #region Showcase grid

/**
 * Save the whole showcase grid — used to empty a slot, move items between slots or edit alt text.
 * Every file must already be one of this profile's showcase renditions; the database checks it.
 */
export async function saveShowcaseGrid(
	owner: ProfileOwner,
	handle: string,
	input: SaveShowcase,
	actor: ReadActor,
): Promise<ServiceResult<ProfileMediaState>> {
	if (!canReadLive(actor)) return denied();
	try {
		const client = getUserClient(actor.accessToken);
		const { error } = await client.schema("org").rpc("save_showcase", {
			p_owner_type: owner.type,
			p_owner_id: owner.id,
			p_slots: input.slots.map((s) => ({ position: s.position, file_id: s.fileId, alt: s.alt })),
		});
		if (error) return refusalFrom(error);
		const state = await readMediaState(client, handle);
		return state ? ok(state) : fail(503, { message: UNAVAILABLE });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion

// #region Follow

/**
 * Follow or unfollow a profile as the caller. Idempotent both ways: a repeat follow adds no second
 * edge (the table is unique on the pair) and unfollowing somebody not followed is a no-op. Answers
 * with the follower count as it now stands.
 */
export async function setFollow(
	owner: ProfileOwner,
	follow: boolean,
	actor: ReadActor,
): Promise<ServiceResult<{ follows: boolean; followers: number }>> {
	if (!canReadLive(actor)) return fail(401, { message: "Sign in to follow." });
	if (owner.type === "user" && owner.id === actor.userId) {
		return fail(422, { message: "You can't follow yourself." });
	}
	try {
		const client = getUserClient(actor.accessToken);
		const table = client.schema("org").from("profile_follows");
		const write = follow
			? await table.upsert(
				{ follower_user_id: actor.userId, target_entity_type: owner.type, target_entity_id: owner.id },
				{ onConflict: "follower_user_id,target_entity_type,target_entity_id", ignoreDuplicates: true },
			)
			: await table.delete()
				.eq("follower_user_id", actor.userId)
				.eq("target_entity_type", owner.type)
				.eq("target_entity_id", owner.id);
		if (write.error) return refusalFrom(write.error);
		const count = await client.schema("org").from("profile_follows")
			.select("id", { count: "exact", head: true })
			.eq("target_entity_type", owner.type)
			.eq("target_entity_id", owner.id);
		return ok({ follows: follow, followers: count.count ?? 0 });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion
