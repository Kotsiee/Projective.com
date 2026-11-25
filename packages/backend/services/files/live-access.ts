import {
	type AccessTargetList,
	type ItemAccess,
	LINKS_WOULD_STOP,
	type SetItemAccess,
	SharedFileRowSchema,
	type SharedWithMe,
	stopsShareLinks,
	toSharedFile,
} from "@projective/types/files";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { accessRefusal, toAccessTargets, toItemAccess } from "./access-dto.ts";
import { isAssetId } from "./inspect-dto.ts";
import { managedShareSlug } from "./live-inspect.ts";

/**
 * live-access — who may open one file (Decision #402), read and saved under the caller's own session.
 * The rules live in the definers `files.get_item_access`, `files.set_item_access`,
 * `files.list_access_targets` and `files.list_shared_with_me`; this module calls them and turns their
 * refusals into answers.
 */

type Actor = ReadActor & { accessToken: string };
type Outcome<T> =
	| { ok: true; data: T; message?: string }
	| {
		ok: false;
		status: number;
		message: string;
		errors?: Record<string, string>;
		details?: Record<string, string | number>;
	};

const MISSING = { ok: false, status: 404, message: "No such file." } as const;

function filesRpc(actor: Actor) {
	return getUserClient(actor.accessToken).schema("files");
}

/** The file's access as the caller may know it, with the owner's live share link. */
export async function readItemAccess(actor: Actor, id: string): Promise<Outcome<ItemAccess>> {
	if (!isAssetId(id)) return MISSING;
	const db = filesRpc(actor);
	const { data, error } = await db.rpc("get_item_access", { p_item_id: id });
	if (error) {
		const refusal = accessRefusal(error);
		if (refusal) return { ok: false, ...refusal };
		throw new Error(`files.get_item_access failed: ${error.message}`);
	}
	const standing = (data as { standing?: unknown } | null)?.standing;
	const slug = standing === "owner"
		? await managedShareSlug(getUserClient(actor.accessToken), actor.userId, id)
		: null;
	return { ok: true, data: toItemAccess(data, slug) };
}

/**
 * Save one Access tab in one transaction, then answer the state it left. A tier drop that would stop
 * live share links waits for the owner's confirm (409 `links_would_stop`, Decision #570).
 */
export async function saveItemAccess(actor: Actor, input: SetItemAccess): Promise<Outcome<ItemAccess>> {
	if (input.visibility && stopsShareLinks(input.visibility) && !input.stopLinks) {
		const links = await linksAtStake(actor, [input.itemId]);
		if (links > 0) return tierDropRefusal(links);
	}
	const { error } = await filesRpc(actor).rpc("set_item_access", {
		p_item_id: input.itemId,
		p_visibility: input.visibility ?? null,
		p_member_access: input.memberAccess ?? null,
		p_grants: input.grants ?? null,
	});
	if (error) {
		const refusal = accessRefusal(error);
		if (refusal) return { ok: false, ...refusal };
		throw new Error(`files.set_item_access failed: ${error.message}`);
	}
	const saved = await readItemAccess(actor, input.itemId);
	return saved.ok ? { ...saved, message: "Access saved." } : saved;
}

/** The caller's grantable teams, businesses and projects, narrowed by `query`. */
export async function readAccessTargets(
	actor: Actor,
	query: string | null,
): Promise<Outcome<AccessTargetList>> {
	const { data, error } = await filesRpc(actor).rpc("list_access_targets", {
		p_query: query,
		p_limit: 30,
	});
	if (error) throw new Error(`files.list_access_targets failed: ${error.message}`);
	return { ok: true, data: toAccessTargets(data) };
}

/** The files other people shared with the caller, by name or through a group, newest first. */
export async function readSharedWithMe(actor: Actor): Promise<Outcome<SharedWithMe>> {
	const { data, error } = await filesRpc(actor).rpc("list_shared_with_me", { p_limit: 200 });
	if (error) throw new Error(`files.list_shared_with_me failed: ${error.message}`);
	const rows = SharedFileRowSchema.array().safeParse(data ?? []);
	if (!rows.success) throw new Error(`Shared with me failed its schema: ${rows.error.message}`);
	return { ok: true, data: { files: rows.data.map(toSharedFile) } };
}

// #region Tier drop
/**
 * How many working share links a tier drop of `itemIds` would stop: live, unexpired and under their cap,
 * on those files that are on Anyone with the link or Public now. Read under the caller's session, whose
 * policy shows a person the links they made; only a file's owner makes its links or lowers its tier.
 */
export async function linksAtStake(actor: Actor, itemIds: readonly string[]): Promise<number> {
	const ids = itemIds.filter(isAssetId);
	if (ids.length === 0) return 0;
	const db = filesRpc(actor);
	const shared = await db.from("items").select("id").in("id", ids)
		.in("visibility", ["link", "public"]).is("deleted_at", null);
	if (shared.error) throw new Error(`files.items read failed: ${shared.error.message}`);
	const open = ((shared.data ?? []) as Array<{ id: string }>).map((row) => row.id);
	if (open.length === 0) return 0;
	const { data, error } = await db.from("share_links").select("download_limit, download_count")
		.in("item_id", open).is("revoked_at", null)
		.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
	if (error) throw new Error(`files.share_links read failed: ${error.message}`);
	return ((data ?? []) as Array<{ download_limit: number | null; download_count: number }>)
		.filter((link) => link.download_limit === null || link.download_count < link.download_limit)
		.length;
}

/** The 409 a tier drop answers while `links` share links would stop and the owner has not confirmed. */
export function tierDropRefusal(links: number): {
	ok: false;
	status: 409;
	message: string;
	details: { code: string; links: number };
} {
	return {
		ok: false,
		status: 409,
		message: links === 1
			? "A share link would stop working."
			: `${links} share links would stop working.`,
		details: { code: LINKS_WOULD_STOP, links },
	};
}
// #endregion
