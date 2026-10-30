import {
	ASSET_METADATA_VERSION,
	type AssetMetadata,
	type CropState,
	INITIAL_CROP,
	renditionLocation,
	type RenditionPurpose,
	SNIFF_BYTES,
	sniffBytes,
	unsupportedReason,
	VARIANT_TIERS,
	variantObjectPath,
	type VariantTier,
} from "@projective/types/files";
import type { ProfileOwnerType } from "@projective/types/profile";
import { getServiceClient } from "../../core/supabase.ts";
import { downloadObject, removeObjects, uploadObject } from "../../core/storage-signed.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type LibrarySource, readLibrarySource } from "./library.ts";
import { MediaPipeline, MediaRejectedError, MediaUnavailableError } from "./pipeline.ts";

/**
 * showcase-rendition — the public RENDITION every showcase and avatar is drawn from.
 *
 * A library asset is private; what a profile, a listing or a group conversation shows is a public
 * copy cut from it: a still re-drawn by the pipeline (crop clamped to the decoded pixels, WebP tiers,
 * no EXIF). Videos are refused until a remux step exists (SEC Z2 / P-2). The
 * cut is made with the service role and recorded as a `files.items` row owned by the surface's owner,
 * so the surface's own door (`org.save_showcase`, `catalogue.apply_listing_media`, …) can decide,
 * under the caller's session, whether it may be used. If that door refuses, the caller retires the
 * rendition, so a refused write never leaves a public object behind.
 */

// #region Types
/** Who a rendition is recorded as belonging to. */
export interface RenditionOwner {
	type: ProfileOwnerType;
	id: string;
}

/** A rendition written to storage + its row, which can be retired again if the surface refuses it. */
export interface Rendition {
	id: string;
	bucket: "avatars" | "showcase";
	paths: string[];
}

/** What to cut: the purpose decides the frame and the bucket. */
export interface RenditionRequest {
	target: RenditionPurpose;
	crop?: CropState;
	/** The showcase slot, for the row's display name. */
	position?: number;
}

/** A cut showcase item: its rendition and what it is. */
export interface ShowcaseCut {
	rendition: Rendition;
	kind: "image" | "video";
	/** The library asset it was cut from. */
	sourceId: string;
}
// #endregion

// #region Write + retire
const UNAVAILABLE = "Your changes couldn't be saved right now. Try again in a moment.";
/** The refusal a video source gets until published videos are remuxed without their metadata. */
export const VIDEO_REFUSED = "Videos can't be published yet. Choose a picture instead.";

/** Retire a rendition the surface would not take: soft-delete its row, remove its objects. */
export async function retireRendition(rendition: Rendition): Promise<void> {
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
 * Cut and store a rendition of `source` for `request.target`. Stills are re-drawn by the pipeline
 * (crop clamped against the decoded pixels, re-encoded WebP, no EXIF); a video is refused with
 * {@link VIDEO_REFUSED} (a {@link MediaRejectedError}). `displayName` overrides the name
 * the row carries in the owner's history (default: "Profile photo" / "Showcase slot N").
 */
export async function writeRendition(
	owner: RenditionOwner,
	actor: ReadActor & { accessToken: string },
	source: LibrarySource,
	request: RenditionRequest,
	displayName?: string,
): Promise<Rendition> {
	const purpose = request.target;
	const bucket = purpose === "avatar" ? "avatars" as const : "showcase" as const;
	const id = crypto.randomUUID();
	const rendition: Rendition = { id, bucket, paths: [] };
	// A video would be published byte-for-byte, GPS and device atoms included (SEC Z2): refused until
	// a remux step strips them.
	if (source.kind !== "image") throw new MediaRejectedError(VIDEO_REFUSED);
	const service = getServiceClient();

	try {
		const bytes = await downloadObject(source.bucket, source.path);
		if (!bytes) throw new MediaUnavailableError("That file couldn't be read. Try another.");

		const variants: Array<
			{ tier: VariantTier; path: string; width: number; height: number; size: number }
		> = [];

		const sniffed = sniffBytes(bytes.subarray(0, SNIFF_BYTES));
		const reason = unsupportedReason(sniffed, false);
		if (reason || !sniffed) {
			throw new MediaRejectedError(reason ?? "That file can't be used here.");
		}
		const result = await MediaPipeline.run({
			kind: "render",
			bytes,
			mime: sniffed.mime,
			purpose,
			crop: request.crop ?? INITIAL_CROP,
		});
		if (!result.full) throw new MediaUnavailableError("The picture couldn't be processed.");
		const location = renditionLocation(bucket, owner.id, id, "full.webp");
		const fullPath = location.path;
		const mime = "image/webp";
		const size = result.full.bytes.byteLength;
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
			variants.push({
				tier,
				path: tierPath,
				width: t.width,
				height: t.height,
				size: t.bytes.byteLength,
			});
		}
		const metadata: AssetMetadata = {
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

		const inserted = await service.schema("files").from("items").insert({
			id,
			owner_user_id: owner.type === "user" ? owner.id : actor.userId,
			owner_type: owner.type,
			owner_entity_id: owner.type === "user" ? null : owner.id,
			bucket_id: bucket,
			storage_path: fullPath,
			display_name: displayName ?? renditionName(purpose, request.position),
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

// #region Showcase cut
/** Where a showcase cut goes, and how slot 1's still-only rule is worded for that surface. */
export interface ShowcasePlacement {
	owner: RenditionOwner;
	/** The slot, 1–6. Slot 1 is the cover and takes a still only. */
	position: number;
	/** The sentence a video offered for slot 1 is refused with. */
	stillOnly?: string;
	displayName?: string;
}

/**
 * Cut one of the caller's LIBRARY assets into a public 16:10 showcase rendition — the step the profile
 * showcase and the listing showcase share. The asset is re-read under the caller's own session (an
 * asset that is not theirs is simply not found), a video is refused for slot 1, and a pipeline
 * refusal is a 422 rather than an outage. The caller places the rendition through its own door and
 * retires it if that door refuses.
 */
export async function cutShowcaseRendition(
	sourceFileId: string,
	crop: CropState | undefined,
	actor: ReadActor,
	placement: ShowcasePlacement,
): Promise<ServiceResult<ShowcaseCut>> {
	if (!canReadLive(actor)) return fail(401, { message: "Sign in to add media." });
	const source = await readLibrarySource(actor, sourceFileId);
	if (!source) {
		return fail(404, {
			message: "That file isn't in your library any more.",
			errors: { sourceAssetId: "not_found" },
		});
	}
	if (source.kind === "video" && placement.position === 1) {
		return fail(422, {
			message: placement.stillOnly ?? "Slot 1 is the cover and has to be a still image.",
			errors: { position: "video_primary" },
		});
	}
	try {
		const rendition = await writeRendition(
			placement.owner,
			actor,
			source,
			{ target: "showcase", crop, position: placement.position },
			placement.displayName,
		);
		return ok({ rendition, kind: source.kind, sourceId: source.id });
	} catch (error) {
		if (error instanceof MediaRejectedError) {
			return fail(422, { message: error.message, errors: { sourceAssetId: "unsupported" } });
		}
		return fail(503, {
			message: error instanceof MediaUnavailableError ? error.message : UNAVAILABLE,
		});
	}
}
// #endregion
