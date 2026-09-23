import type { SupabaseClient } from "supabaseClient";
import {
	ASSET_METADATA_VERSION,
	type AssetMetadata,
	durationLabelOf,
	formatLimit,
	imagePlaceholderOf,
	LIBRARY_IMAGE_MAX_BYTES,
	LIBRARY_VIDEO_MAX_BYTES,
	type LibraryAsset,
	libraryLocation,
	quarantineLocation,
	type LibraryListParams,
	type LibraryPage,
	type LibraryUploadComplete,
	type LibraryUploadInit,
	type LibraryUploadTicket,
	type Sniffed,
	SNIFF_BYTES,
	sniffBytes,
	unsupportedReason,
	VARIANT_TIERS,
	variantObjectPath,
	type VariantTier,
} from "@projective/types/files";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import {
	downloadObject,
	removeObjects,
	signedReadUrls,
	signedUploadUrl,
	uploadObject,
} from "../../core/storage-signed.ts";
import { isPublicBucket, publicObjectUrl } from "../../core/storage-url.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { EncodedImage, ImageJobResult } from "./image-jobs.ts";
import { MediaPipeline, MediaRejectedError, MediaUnavailableError } from "./pipeline.ts";

/**
 * library — a person's MEDIA LIBRARY, live: the quarantine upload, the processing step that admits
 * a file, and the listing the media picker browses.
 *
 * ## The quarantine flow
 *
 *  1. {@link initLibraryUpload} records a `pending_upload` row under the caller's OWN session (RLS
 *     and `files.fn_guard_pipeline_columns` both hold: a client may only declare an upload, in the
 *     private `quarantine` bucket) and mints a signed, single-object upload URL for it.
 *  2. The browser PUTs the bytes straight to storage — they never pass through a request worker.
 *  3. {@link completeLibraryUpload} CLAIMS the row (`pending_upload → scanning`, so two completes of
 *     one upload cannot both process it), reads the stored object's magic bytes (the declared MIME
 *     type is a guess from a filename), decodes it in the media pipeline's worker (which is itself
 *     the proof that it is the picture it claims to be), writes the three WebP tiers, moves the
 *     original into the owner's private `personal` bucket and only then marks it `uploaded`.
 *
 * A file that fails inspection never leaves quarantine: its bytes are deleted, its row is marked
 * `quarantined` (it claimed to be something it is not — a program, markup) or `error` (it is simply
 * not a picture the platform can read), and the person is told which.
 *
 * ## What runs as whom
 *
 * Every read and the first write run under the caller's own JWT, so RLS decides whose library this
 * is. The promotion (moving bytes, writing a row's processing state, inserting its tiers) runs as the
 * service role, because those are exactly the columns `fn_guard_pipeline_columns` withholds from a
 * client — and it is reached only after the caller's session has proved the row is theirs.
 */

// #region Errors + small helpers

const UNAVAILABLE = "Uploads are unavailable right now. Try again in a moment.";

function denied(): ServiceResult<never> {
	return fail(401, { message: "Sign in to use your media library." });
}

/** A file name safe to use as the last segment of an object path. */
export function objectName(name: string, ext: string): string {
	const stem = name.replace(/\.[^.]*$/, "")
		.normalize("NFKD")
		.replace(/[^\w.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "file";
	return `${stem}.${ext}`;
}

function kindOfMime(mime: string): "image" | "video" | null {
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("video/")) return "video";
	return null;
}

/** Decode a `data:` URL's payload; `null` on anything that is not base64 image data. */
export function decodeDataUrl(dataUrl: string): Uint8Array | null {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
	if (!match) return null;
	try {
		const binary = atob(match[2].replace(/\s+/g, ""));
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

// #endregion

// #region Row shapes

interface ItemRow {
	id: string;
	owner_user_id: string;
	display_name: string;
	mime_type: string;
	size_bytes: number;
	metadata: unknown;
	created_at: string;
	bucket_id: string;
	storage_path: string;
	status?: string;
	purpose?: string;
	deleted_at?: string | null;
}

interface VariantRow {
	item_id: string;
	tier: VariantTier;
	bucket_id: string;
	storage_path: string;
	width: number;
	height: number;
}

const ITEM_COLUMNS = "id, owner_user_id, display_name, mime_type, size_bytes, metadata, created_at, bucket_id, storage_path";

// #endregion

// #region Metadata

/** The loosely-read media facts of a row — tolerant of rows written before the envelope existed. */
function mediaFacts(metadata: unknown): { width: number; height: number; durationMs: number | null } | null {
	const media = (metadata as { media?: Record<string, unknown> } | null)?.media;
	if (!media || typeof media !== "object") return null;
	const width = Number(media.width);
	const height = Number(media.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	const duration = Number(media.durationMs);
	return {
		width: Math.round(width),
		height: Math.round(height),
		durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
	};
}

/** The envelope written to `files.items.metadata` for a still the pipeline decoded. */
export function imageEnvelope(result: ImageJobResult): AssetMetadata {
	return {
		version: ASSET_METADATA_VERSION as 1,
		source: "server",
		extractedAt: new Date().toISOString(),
		media: {
			kind: "image",
			width: result.source.width,
			height: result.source.height,
			aspectRatio: Math.round((result.source.width / result.source.height) * 10_000) / 10_000,
			blurhash: result.blurhash,
			colors: result.colors,
			animated: result.source.animated,
			vector: false,
			hasAlpha: result.source.hasAlpha,
		},
		notes: result.source.animated ? ["Animated: only the first frame is kept in the previews."] : [],
	};
}

/** The envelope for a video, measured from its poster still (the server does not decode video). */
function videoEnvelope(poster: ImageJobResult, durationMs: number): AssetMetadata {
	return {
		version: ASSET_METADATA_VERSION as 1,
		source: "server",
		extractedAt: new Date().toISOString(),
		media: {
			kind: "video",
			width: poster.source.width,
			height: poster.source.height,
			aspectRatio: Math.round((poster.source.width / poster.source.height) * 10_000) / 10_000,
			durationMs,
			durationLabel: durationLabelOf(durationMs),
			blurhash: poster.blurhash,
			colors: poster.colors,
			posterAtMs: 0,
			// The poster is kept as the stored WebP tiers, not inline on the row.
			posterDataUrl: null,
		},
		notes: ["Poster stored as image tiers."],
	};
}

// #endregion

// #region URLs

/**
 * Resolve the URLs of many rows at once: public objects by their stable URL, private ones by ONE
 * signing call per bucket. Returns a lookup from `bucket/path` to URL.
 */
async function urlsFor(objects: ReadonlyArray<{ bucket: string; path: string }>): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const privateByBucket = new Map<string, string[]>();
	for (const o of objects) {
		if (!o.path) continue;
		if (isPublicBucket(o.bucket)) {
			const url = publicObjectUrl(o.bucket, o.path);
			if (url) out.set(`${o.bucket}/${o.path}`, url);
		} else {
			const list = privateByBucket.get(o.bucket) ?? [];
			list.push(o.path);
			privateByBucket.set(o.bucket, list);
		}
	}
	await Promise.all([...privateByBucket].map(async ([bucket, paths]) => {
		const signed = await signedReadUrls(bucket, paths);
		for (const [path, url] of signed) out.set(`${bucket}/${path}`, url);
	}));
	return out;
}

/** Map rows + their tiers onto library assets (skipping rows whose size is unknown). */
async function toAssets(rows: readonly ItemRow[], variants: readonly VariantRow[]): Promise<LibraryAsset[]> {
	const tiersOf = new Map<string, Partial<Record<VariantTier, VariantRow>>>();
	for (const v of variants) {
		const entry = tiersOf.get(v.item_id) ?? {};
		entry[v.tier] = v;
		tiersOf.set(v.item_id, entry);
	}
	const objects: Array<{ bucket: string; path: string }> = [];
	for (const row of rows) {
		objects.push({ bucket: row.bucket_id, path: row.storage_path });
		for (const v of Object.values(tiersOf.get(row.id) ?? {})) {
			if (v) objects.push({ bucket: v.bucket_id, path: v.storage_path });
		}
	}
	const urls = await urlsFor(objects);
	const url = (bucket: string, path: string) => urls.get(`${bucket}/${path}`) ?? "";

	const out: LibraryAsset[] = [];
	for (const row of rows) {
		const kind = kindOfMime(row.mime_type);
		const facts = mediaFacts(row.metadata);
		if (!kind || !facts) continue;
		const tiers = tiersOf.get(row.id) ?? {};
		const original = url(row.bucket_id, row.storage_path);
		const tierUrl = (order: VariantTier[]): string => {
			for (const t of order) {
				const v = tiers[t];
				if (v) return url(v.bucket_id, v.storage_path);
			}
			return "";
		};
		// A still with no tiers (a row written before the pipeline) is its own preview.
		const thumb = tierUrl(["sm", "md", "lg"]) || (kind === "image" ? original : "");
		const preview = tierUrl(["lg", "md", "sm"]) || (kind === "image" ? original : "");
		out.push({
			id: row.id,
			name: row.display_name,
			kind,
			mimeType: row.mime_type,
			sizeBytes: Number(row.size_bytes) || 0,
			width: facts.width,
			height: facts.height,
			durationMs: kind === "video" ? facts.durationMs : null,
			thumb,
			preview,
			src: kind === "video" ? original : preview,
			placeholder: imagePlaceholderOf(row.metadata as AssetMetadata),
			createdAt: row.created_at,
		});
	}
	return out;
}

async function variantsOf(db: SupabaseClient, ids: readonly string[]): Promise<VariantRow[]> {
	if (ids.length === 0) return [];
	const { data, error } = await db.schema("files").from("item_variants")
		.select("item_id, tier, bucket_id, storage_path, width, height")
		.in("item_id", [...ids]);
	return error || !Array.isArray(data) ? [] : data as VariantRow[];
}

// #endregion

// #region Listing

function encodeCursor(row: Pick<ItemRow, "created_at" | "id">): string {
	return btoa(`${row.created_at}|${row.id}`);
}

function decodeCursor(cursor: string | null | undefined): { at: string; id: string } | null {
	if (!cursor) return null;
	try {
		const [at, id] = atob(cursor).split("|");
		if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
		return { at, id };
	} catch {
		return null;
	}
}

/** One page of the caller's library, newest first. */
export async function listLibrary(
	actor: ReadActor,
	params: LibraryListParams,
): Promise<ServiceResult<LibraryPage>> {
	if (!canReadLive(actor)) return denied();
	try {
		const db = getUserClient(actor.accessToken);
		let query = db.schema("files").from("items").select(ITEM_COLUMNS)
			.eq("owner_user_id", actor.userId)
			.eq("owner_type", "user")
			.eq("purpose", "library")
			.eq("status", "uploaded")
			.eq("source", "supabase")
			.is("deleted_at", null);
		if (params.kind === "image") query = query.like("mime_type", "image/%");
		else if (params.kind === "video") query = query.like("mime_type", "video/%");
		else query = query.or("mime_type.like.image/*,mime_type.like.video/*");
		const cursor = decodeCursor(params.cursor);
		if (cursor) {
			query = query.or(`created_at.lt."${cursor.at}",and(created_at.eq."${cursor.at}",id.lt.${cursor.id})`);
		}
		const { data, error } = await query
			.order("created_at", { ascending: false })
			.order("id", { ascending: false })
			.limit(params.limit + 1);
		if (error) return fail(503, { message: UNAVAILABLE });
		const rows = (data ?? []) as ItemRow[];
		const page = rows.slice(0, params.limit);
		const items = await toAssets(page, await variantsOf(db, page.map((r) => r.id)));
		const last = page[page.length - 1];
		return ok({ items, nextCursor: rows.length > params.limit && last ? encodeCursor(last) : null });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

/**
 * One library asset of the caller's, as the picker shows it. `null` when it is not theirs, not a
 * processed library asset, or gone — the three are the same answer to a caller.
 */
export async function readLibraryAsset(actor: ReadActor, id: string): Promise<LibraryAsset | null> {
	if (!canReadLive(actor)) return null;
	const db = getUserClient(actor.accessToken);
	const { data, error } = await db.schema("files").from("items").select(ITEM_COLUMNS)
		.eq("id", id)
		.eq("owner_user_id", actor.userId)
		.eq("purpose", "library")
		.eq("status", "uploaded")
		.is("deleted_at", null)
		.maybeSingle();
	if (error || !data) return null;
	const [asset] = await toAssets([data as ItemRow], await variantsOf(db, [id]));
	return asset ?? null;
}

/**
 * The stored object behind one of the caller's library assets, for the rendition step — its bucket,
 * path, type and upright size, plus its tiers. Read under the caller's own session, so a source they
 * cannot read is not a source they can publish.
 */
export interface LibrarySource {
	id: string;
	name: string;
	kind: "image" | "video";
	mimeType: string;
	bucket: string;
	path: string;
	width: number;
	height: number;
	durationMs: number | null;
	metadata: unknown;
	tiers: Partial<Record<VariantTier, { bucket: string; path: string; width: number; height: number }>>;
}

export async function readLibrarySource(actor: ReadActor, id: string): Promise<LibrarySource | null> {
	if (!canReadLive(actor)) return null;
	const db = getUserClient(actor.accessToken);
	const { data, error } = await db.schema("files").from("items").select(ITEM_COLUMNS)
		.eq("id", id)
		.eq("owner_user_id", actor.userId)
		.eq("purpose", "library")
		.eq("status", "uploaded")
		.eq("source", "supabase")
		.is("deleted_at", null)
		.maybeSingle();
	if (error || !data) return null;
	const row = data as ItemRow;
	const kind = kindOfMime(row.mime_type);
	const facts = mediaFacts(row.metadata);
	if (!kind || !facts) return null;
	const tiers: LibrarySource["tiers"] = {};
	for (const v of await variantsOf(db, [id])) {
		tiers[v.tier] = { bucket: v.bucket_id, path: v.storage_path, width: v.width, height: v.height };
	}
	return {
		id: row.id,
		name: row.display_name,
		kind,
		mimeType: row.mime_type,
		bucket: row.bucket_id,
		path: row.storage_path,
		width: facts.width,
		height: facts.height,
		durationMs: facts.durationMs,
		metadata: row.metadata,
		tiers,
	};
}

// #endregion

// #region Upload — init

/**
 * Step 1: record the upload and hand back where to put the bytes.
 *
 * The row is inserted under the CALLER's session: it is theirs by RLS (`owner_user_id = auth.uid()`),
 * and the guard trigger lets a client write exactly this shape — pending, in quarantine, a library
 * asset — and nothing else.
 */
export async function initLibraryUpload(
	actor: ReadActor,
	input: LibraryUploadInit,
): Promise<ServiceResult<LibraryUploadTicket>> {
	if (!canReadLive(actor)) return denied();
	const assetId = crypto.randomUUID();
	const ext = (/\.([a-z0-9]{1,8})$/i.exec(input.name)?.[1] ?? "bin").toLowerCase();
	const { path } = quarantineLocation(actor.userId, assetId, objectName(input.name, ext));
	try {
		const db = getUserClient(actor.accessToken);
		const { error } = await db.schema("files").from("items").insert({
			id: assetId,
			owner_user_id: actor.userId,
			owner_type: "user",
			bucket_id: "quarantine",
			storage_path: path,
			display_name: input.name,
			original_name: input.name,
			mime_type: input.mimeType,
			size_bytes: input.sizeBytes,
			category: input.mimeType.startsWith("video/") ? "Video" : "Image",
			status: "pending_upload",
			visibility: "private",
			source: "supabase",
			purpose: "library",
		});
		if (error) {
			return error.code === "42501"
				? fail(403, { message: "You can't upload to this library." })
				: fail(503, { message: UNAVAILABLE });
		}
		const signed = await signedUploadUrl("quarantine", path);
		if (!signed) {
			await markRow(assetId, "error");
			return fail(503, { message: UNAVAILABLE });
		}
		return ok({
			assetId,
			signedUrl: signed.url,
			headers: { "content-type": input.mimeType, "x-upsert": "false" },
			expiresAt: signed.expiresAt,
		}, { status: 201 });
	} catch {
		return fail(503, { message: UNAVAILABLE });
	}
}

// #endregion

// #region Upload — complete

/** Set a row's processing status (service role). Best-effort: a failure here is not the caller's. */
async function markRow(id: string, status: "error" | "quarantined" | "pending_upload"): Promise<void> {
	try {
		await getServiceClient().schema("files").from("items")
			.update({ status, updated_at: new Date().toISOString() })
			.eq("id", id);
	} catch { /* the row stays in its previous state; the sweep finds it */ }
}

/**
 * Refuse a file that failed inspection: its bytes leave quarantine (they are never kept), and its
 * row records why — `quarantined` for a file that claimed to be something it is not.
 */
async function refuse(row: ItemRow, sniffed: Sniffed | null, message: string): Promise<ServiceResult<never>> {
	const hostile = sniffed?.family === "executable" || sniffed?.family === "markup";
	await removeObjects("quarantine", [row.storage_path]);
	await markRow(row.id, hostile ? "quarantined" : "error");
	return fail(422, { message, errors: { file: hostile ? "rejected" : "unsupported" } });
}

async function ingest(bytes: Uint8Array, mime: string): Promise<ImageJobResult> {
	return await MediaPipeline.run({ kind: "ingest", bytes, mime });
}

/** Upload encoded tiers beside `path`, returning the rows to record; throws when storage refuses. */
export async function writeTiers(
	bucket: string,
	path: string,
	tiers: Record<VariantTier, EncodedImage>,
	written: string[],
	immutable: boolean,
): Promise<Array<{ tier: VariantTier; path: string; width: number; height: number; size: number }>> {
	const out: Array<{ tier: VariantTier; path: string; width: number; height: number; size: number }> = [];
	for (const tier of VARIANT_TIERS) {
		const t = tiers[tier];
		const tierPath = variantObjectPath(path, tier);
		if (!await uploadObject(bucket, tierPath, t.bytes, "image/webp", { immutable })) {
			throw new Error(`storage refused ${bucket}/${tierPath}`);
		}
		written.push(tierPath);
		out.push({ tier, path: tierPath, width: t.width, height: t.height, size: t.bytes.byteLength });
	}
	return out;
}

/**
 * Step 3: inspect, process and admit the upload.
 *
 * Idempotent for a caller who retries after a lost response: an upload that is already `uploaded`
 * answers with the finished asset rather than processing it twice.
 */
export async function completeLibraryUpload(
	actor: ReadActor,
	input: LibraryUploadComplete,
): Promise<ServiceResult<LibraryAsset>> {
	if (!canReadLive(actor)) return denied();
	let claimed: ItemRow | null = null;
	const written: string[] = [];
	try {
		// The caller's own session proves the row is theirs before anything runs as the service role.
		const mine = await getUserClient(actor.accessToken).schema("files").from("items")
			.select(`${ITEM_COLUMNS}, status, purpose`)
			.eq("id", input.assetId)
			.eq("owner_user_id", actor.userId)
			.maybeSingle();
		if (mine.error) return fail(503, { message: UNAVAILABLE });
		const row = mine.data as ItemRow | null;
		if (!row || row.purpose !== "library") return fail(404, { message: "That upload could not be found." });
		if (row.status === "uploaded") {
			const done = await readLibraryAsset(actor, row.id);
			return done ? ok(done) : fail(404, { message: "That upload could not be found." });
		}
		if (row.status !== "pending_upload" || row.bucket_id !== "quarantine") {
			return fail(409, { message: "This upload can't be finished. Upload the file again." });
		}

		// Claim it: exactly one complete may move a row out of `pending_upload`.
		const service = getServiceClient();
		const claim = await service.schema("files").from("items")
			.update({ status: "scanning", updated_at: new Date().toISOString() })
			.eq("id", row.id)
			.eq("status", "pending_upload")
			.select("id");
		if (claim.error) return fail(503, { message: UNAVAILABLE });
		if (!claim.data || claim.data.length === 0) {
			return fail(409, { message: "This upload is already being processed." });
		}
		claimed = row;

		const bytes = await downloadObject("quarantine", row.storage_path);
		if (!bytes || bytes.byteLength === 0) {
			await markRow(row.id, "error");
			return fail(422, { message: "The file didn't finish uploading. Try again.", errors: { file: "missing" } });
		}
		const sniffed = sniffBytes(bytes.subarray(0, SNIFF_BYTES));
		const reason = unsupportedReason(sniffed, true);
		if (reason || !sniffed) return await refuse(row, sniffed, reason ?? "This file can't be used.");
		const limit = sniffed.family === "video" ? LIBRARY_VIDEO_MAX_BYTES : LIBRARY_IMAGE_MAX_BYTES;
		if (bytes.byteLength > limit) {
			return await refuse(row, sniffed, `This file is larger than ${formatLimit(limit)}.`);
		}

		// Decode: the still itself, or the video's poster still (the one frame the server can read).
		let result: ImageJobResult;
		let metadata: AssetMetadata;
		if (sniffed.family === "video") {
			const poster = input.posterDataUrl ? decodeDataUrl(input.posterDataUrl) : null;
			const posterSniff = poster ? sniffBytes(poster.subarray(0, SNIFF_BYTES)) : null;
			if (!poster || posterSniff?.family !== "image") {
				return await refuse(
					row,
					sniffed,
					"We couldn't read a frame from this video. Try an MP4 or WebM that plays in your browser.",
				);
			}
			result = await ingest(poster, posterSniff.mime);
			metadata = videoEnvelope(result, input.durationMs ?? 0);
		} else {
			result = await ingest(bytes, sniffed.mime);
			metadata = imageEnvelope(result);
		}

		// Admit: the original moves into the owner's private library, its tiers beside it.
		const location = libraryLocation(actor.userId, row.id, objectName(row.display_name, sniffed.ext));
		if (!await uploadObject(location.bucket, location.path, bytes, sniffed.mime)) {
			throw new Error("storage refused the original");
		}
		written.push(location.path);
		const tierRows = await writeTiers(location.bucket, location.path, result.tiers, written, false);

		const promoted = await service.schema("files").from("items").update({
			bucket_id: location.bucket,
			storage_path: location.path,
			mime_type: sniffed.mime,
			size_bytes: bytes.byteLength,
			category: sniffed.family === "video" ? "Video" : "Image",
			metadata,
			status: "uploaded",
			updated_at: new Date().toISOString(),
		}).eq("id", row.id);
		if (promoted.error) throw new Error(promoted.error.message);

		const variants = await service.schema("files").from("item_variants").upsert(
			tierRows.map((t) => ({
				item_id: row.id,
				tier: t.tier,
				bucket_id: location.bucket,
				storage_path: t.path,
				mime_type: "image/webp",
				width: t.width,
				height: t.height,
				size_bytes: t.size,
			})),
			{ onConflict: "item_id,tier" },
		);
		if (variants.error) throw new Error(variants.error.message);

		await removeObjects("quarantine", [row.storage_path]);
		const asset = await readLibraryAsset(actor, row.id);
		return asset ? ok(asset) : fail(503, { message: UNAVAILABLE });
	} catch (error) {
		if (claimed) {
			if (written.length > 0) await removeObjects("personal", written);
			if (error instanceof MediaRejectedError) {
				return await refuse(claimed, null, error.message);
			}
			// The pipeline or storage failed, not the file: put the row back so a retry can finish it.
			await markRow(claimed.id, error instanceof MediaUnavailableError ? "pending_upload" : "error");
		}
		return fail(503, {
			message: error instanceof MediaUnavailableError ? error.message : UNAVAILABLE,
		});
	}
}

// #endregion
