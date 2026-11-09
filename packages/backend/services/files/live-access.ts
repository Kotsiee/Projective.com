import type { AccessTargetList, ItemAccess, SetItemAccess } from "@projective/types/files";
import { getUserClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import { accessRefusal, toAccessTargets, toItemAccess } from "./access-dto.ts";
import { isAssetId } from "./inspect-dto.ts";
import { managedShareSlug } from "./live-inspect.ts";

/**
 * live-access — who may open one file (Decision #402), read and saved under the caller's own session.
 * The rules live in the definers `files.get_item_access`, `files.set_item_access` and
 * `files.list_access_targets`; this module calls them and turns their refusals into answers.
 */

type Actor = ReadActor & { accessToken: string };
type Outcome<T> =
	| { ok: true; data: T; message?: string }
	| { ok: false; status: number; message: string; errors?: Record<string, string> };

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

/** Save one Access tab in one transaction, then answer the state it left. */
export async function saveItemAccess(actor: Actor, input: SetItemAccess): Promise<Outcome<ItemAccess>> {
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
