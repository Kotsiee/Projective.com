import type { FileObjectTier } from "@projective/types/files";
import { getAnonClient, getServiceClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { shareTarget } from "./live-library.ts";

/**
 * live-objects — may this caller have these bytes, and where are they?
 *
 * The one read decision behind the media proxy (`/api/media/proxy/[fileId]`). Three ways in, and
 * each is the database's own rule rather than a restatement of it:
 *
 *  - a SIGNED-IN caller reads the row under their own session, so `files.fn_can_read` decides (owner,
 *    member of the owning entity, participant of the project a file is anchored on, or public);
 *  - an ANONYMOUS caller reads through the `anon` policy, which admits public rows only;
 *  - a SHARE-LINK recipient presents the slug, which `files.fn_resolve_share` validates (live, not
 *    revoked, not expired, under its limit) — and the slug must reach THIS file, itself or the folder
 *    it sits in. Only then is the row read with the service role, because a link-shared file is
 *    deliberately not readable by id.
 *
 * {@link objectFor} only decides; the proxy streams its answer, so no storage address or signed URL
 * reaches the browser (`ASSET_DELIVERY_ARCHITECTURE.md` §5.3).
 */

/** A readable stored object, and how it should be served. */
export interface ObjectRef {
	bucket: string;
	path: string;
	mime: string;
	/** The name a download is saved as. */
	name: string;
	/** The asset's inspector address (`fil-…`), where a page navigation to its bytes is sent. */
	slug: string;
}

interface ObjectRow {
	id: string;
	slug: string;
	bucket_id: string;
	storage_path: string;
	mime_type: string | null;
	display_name: string | null;
	folder_id: string | null;
	source: string | null;
	status: string | null;
	deleted_at: string | null;
}

const COLUMNS =
	"id, slug, bucket_id, storage_path, mime_type, display_name, folder_id, source, status, deleted_at";

/** Resolve what the caller may read for `id`, or `null` when they may not (or it has no bytes). */
export async function objectFor(
	actor: ReadActor,
	id: string,
	opts: { tier?: FileObjectTier | null; share?: string | null },
): Promise<ObjectRef | null> {
	let row: ObjectRow | null = null;
	let viaService = false;

	if (opts.share) {
		const target = await shareTarget(opts.share);
		if (!target) return null;
		const read = await getServiceClient().schema("files").from("items").select(COLUMNS).eq("id", id).maybeSingle();
		if (read.error) return null;
		const candidate = read.data as unknown as ObjectRow | null;
		const reaches = !!candidate &&
			(target.itemId === candidate.id || (target.folderId !== null && candidate.folder_id === target.folderId));
		if (!reaches) return null;
		row = candidate;
		viaService = true;
	} else {
		const client = canReadLive(actor) ? getUserClient(actor.accessToken) : getAnonClient();
		const read = await client.schema("files").from("items").select(COLUMNS).eq("id", id).maybeSingle();
		// A malformed id, a row RLS hides and a missing row are one answer: not yours to read.
		if (read.error) return null;
		row = read.data as unknown as ObjectRow | null;
	}

	if (!row || row.deleted_at !== null || row.source !== "supabase" || row.status !== "uploaded") return null;

	if (opts.tier) {
		// Variants follow their asset's read rule; a share recipient's grant was just checked above.
		const client = viaService || !canReadLive(actor)
			? getServiceClient()
			: getUserClient((actor as ReadActor & { accessToken: string }).accessToken);
		const variant = await client.schema("files").from("item_variants")
			.select("bucket_id, storage_path, mime_type").eq("item_id", row.id).eq("tier", opts.tier).maybeSingle();
		const v = variant.data as { bucket_id: string; storage_path: string; mime_type: string } | null;
		// No tier written (a document, a seeded original): the original is the honest answer.
		if (v) {
			return {
				bucket: v.bucket_id,
				path: v.storage_path,
				mime: v.mime_type,
				name: row.display_name ?? "file",
				slug: row.slug,
			};
		}
	}

	return {
		bucket: row.bucket_id,
		path: row.storage_path,
		mime: row.mime_type ?? "application/octet-stream",
		name: row.display_name ?? "file",
		slug: row.slug,
	};
}

/**
 * Types a browser may render inline from our storage origin. Everything else is served as a download:
 * HTML, SVG and XML execute or render markup where they are opened, a PDF opens in the browser's own
 * viewer at the app origin (the inspector draws it with pdf.js instead, Decision #563), and a library
 * holds whatever people put in it.
 */
const INLINE_SAFE: readonly RegExp[] = [
	/^image\/(jpeg|png|gif|webp|avif|heic|bmp)$/,
	/^video\/(mp4|webm|quicktime|ogg)$/,
	/^audio\//,
	/^text\/plain$/,
];

/** Whether an object of this type may be shown in place rather than downloaded. */
export function inlineSafe(mime: string): boolean {
	const m = mime.toLowerCase().split(";")[0].trim();
	return INLINE_SAFE.some((re) => re.test(m));
}
