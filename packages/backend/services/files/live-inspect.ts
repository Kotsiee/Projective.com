import type { SupabaseClient } from "supabaseClient";
import { type InspectAsset, InspectAssetSchema } from "@projective/types/files";
import { getAnonClient, getServiceClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { ITEM_COLUMNS, type ItemRow, toAssetItem } from "./asset-row.ts";
import {
	extensionOf,
	inspectAccess,
	isAssetId,
	liveShareSlug,
	type OwnerProfileRow,
	type ShareLinkRow,
	toInspectAsset,
	toInspectOwner,
} from "./inspect-dto.ts";
import { shareTarget } from "./live-library.ts";

/**
 * live-inspect — the inspector page's one read: the asset the viewer may open, resolved under the same
 * three doors as the media proxy's `objectFor` so the page and its bytes always agree.
 *
 *  - a SHARE-LINK recipient: `fn_resolve_share` validates the slug, the row is read with the service role
 *    and the slug must reach it (the file itself, or the folder it sits in);
 *  - a SIGNED-IN viewer: the row is read under their own session, so `files.fn_can_read` decides;
 *  - an ANONYMOUS viewer: the anon policy admits public rows only.
 *
 * Only stored, settled bytes are inspectable. Every refusal is `null` (the route's 404); a malformed id
 * never reaches the database.
 */

const INVALID_TEXT_REPRESENTATION = "22P02";

async function readRow(client: SupabaseClient, id: string): Promise<ItemRow | null> {
	const { data, error } = await client.schema("files").from("items").select(ITEM_COLUMNS)
		.eq("id", id).is("deleted_at", null).maybeSingle();
	if (error) {
		if (error.code === INVALID_TEXT_REPRESENTATION) return null;
		throw new Error(`files.items read failed: ${error.message}`);
	}
	return data as unknown as ItemRow | null;
}

async function hasRendition(client: SupabaseClient, id: string): Promise<boolean> {
	const { data, error } = await client.schema("files").from("item_variants").select("tier")
		.eq("item_id", id).eq("tier", "lg").maybeSingle();
	if (error) throw new Error(`files.item_variants read failed: ${error.message}`);
	return data !== null;
}

interface DirectoryRow extends OwnerProfileRow {
	avatar_path: string | null;
}

async function ownerProfile(ownerUserId: string): Promise<OwnerProfileRow | null> {
	const { data, error } = await getAnonClient().schema("org").from("profiles_index")
		.select("handle, name, avatar_file_id, avatar_path").eq("entity_id", ownerUserId)
		.in("entity_type", ["user", "freelancer"]).maybeSingle();
	if (error) throw new Error(`org.profiles_index read failed: ${error.message}`);
	const row = data as DirectoryRow | null;
	if (!row) return null;
	return {
		handle: row.handle,
		name: row.name,
		avatar_file_id: row.avatar_path ? row.avatar_file_id : null,
	};
}

async function managedShareSlug(
	client: SupabaseClient,
	actorId: string,
	id: string,
): Promise<string | null> {
	const { data, error } = await client.schema("files").from("share_links")
		.select("slug, expires_at, download_limit, download_count, created_at")
		.eq("item_id", id).eq("created_by", actorId).is("revoked_at", null)
		.order("created_at", { ascending: false }).limit(20);
	if (error) throw new Error(`files.share_links read failed: ${error.message}`);
	return liveShareSlug((data ?? []) as ShareLinkRow[], Date.now());
}

/** The inspector DTO for `id` as this viewer may see it, or `null` for every refusal. */
export async function inspectAssetFor(
	actor: ReadActor,
	id: string,
	opts: { share: string | null },
): Promise<InspectAsset | null> {
	if (!isAssetId(id)) return null;
	const share = opts.share || null;
	const userClient = !share && canReadLive(actor) ? getUserClient(actor.accessToken) : null;

	let row: ItemRow | null;
	if (share) {
		const target = await shareTarget(share);
		if (!target) return null;
		row = await readRow(getServiceClient(), id);
		const reaches = !!row &&
			(target.itemId === row.id || (target.folderId !== null && row.folder_id === target.folderId));
		if (!reaches) return null;
	} else {
		row = await readRow(userClient ?? getAnonClient(), id);
	}
	if (!row || row.source !== "supabase" || row.status !== "uploaded") return null;

	const viewerId = userClient ? actor.userId : "";
	const manages = viewerId.length > 0 && row.owner_user_id === viewerId;
	const [renditionAvailable, profile, shareSlug] = await Promise.all([
		hasRendition(userClient ?? getServiceClient(), row.id),
		ownerProfile(row.owner_user_id),
		userClient && manages ? managedShareSlug(userClient, viewerId, row.id) : Promise.resolve(null),
	]);

	const item = toAssetItem(row, {
		viewerId,
		folderPaths: new Map(),
		downloaded: new Set(),
		shareSlugs: new Map(),
		now: Date.now(),
	});
	const display = (row.display_name ?? "").trim();
	const fileName = extensionOf(display) || !row.original_name
		? display || item.name
		: row.original_name;

	const parsed = InspectAssetSchema.safeParse(toInspectAsset({
		item,
		fileName,
		mimeType: row.mime_type,
		access: inspectAccess({ viaShare: share !== null, viewerId, ownerUserId: row.owner_user_id }),
		share,
		renditionAvailable,
		owner: toInspectOwner(profile),
		shareSlug,
	}));
	if (!parsed.success) throw new Error(`Inspect DTO failed its schema: ${parsed.error.message}`);
	return parsed.data;
}
