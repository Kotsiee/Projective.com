import {
	type AccessTargetList,
	AccessTargetListSchema,
	type ItemAccess,
	ItemAccessSchema,
	shareHref,
} from "@projective/types/files";
import { mediaUrl, parseMediaRef } from "./public-media.ts";

/**
 * access-dto — the pure projection behind a file's Access tab (Decision #402): what
 * `files.get_item_access` and `files.list_access_targets` answer, as the SSOT shapes, and what each
 * refusal they raise means to a caller.
 */

// #region Shapes
type Json = Record<string, unknown>;

function record(raw: unknown): Json {
	return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Json : {};
}

function rows(raw: unknown): Json[] {
	return Array.isArray(raw) ? raw.map(record) : [];
}

/** A public media reference as the `sm` picture a list row draws, or `null` for initials. */
export function avatarOf(raw: unknown): string | null {
	return mediaUrl(parseMediaRef(raw), "sm");
}

/**
 * `files.get_item_access` as the SSOT's {@link ItemAccess}. `shareSlug` is the owner's live share link,
 * read beside the RPC because its terms (expiry, download limit) are judged in TypeScript. Throws when
 * the answer does not fit the schema: a read that drifted from its contract is a failure, not a state.
 */
export function toItemAccess(raw: unknown, shareSlug: string | null): ItemAccess {
	const body = record(raw);
	const standing = body.standing;
	const parsed = ItemAccessSchema.safeParse({
		itemId: body.itemId,
		visibility: body.visibility,
		standing,
		container: body.container,
		grants: rows(body.grants).map((grant) => ({
			kind: grant.kind,
			id: grant.id,
			role: grant.role,
			name: grant.name,
			detail: grant.detail ?? null,
			avatar: avatarOf(grant.avatar),
			grantedAt: grant.grantedAt,
		})),
		ownerId: standing === "owner" || standing === "editor" ? body.ownerId ?? null : null,
		messageShares: standing === "owner" && typeof body.messageShares === "number"
			? body.messageShares
			: null,
		shareUrl: standing === "owner" && shareSlug ? shareHref(shareSlug) : null,
	});
	if (!parsed.success) throw new Error(`Item access failed its schema: ${parsed.error.message}`);
	return parsed.data;
}

/** `files.list_access_targets` as the SSOT's {@link AccessTargetList}. Throws on a drifted answer. */
export function toAccessTargets(raw: unknown): AccessTargetList {
	const parsed = AccessTargetListSchema.safeParse({
		targets: rows(raw).map((target) => ({
			kind: target.kind,
			id: target.id,
			name: target.name,
			detail: target.detail ?? null,
			avatar: avatarOf(target.avatar),
		})),
	});
	if (!parsed.success) throw new Error(`Access targets failed their schema: ${parsed.error.message}`);
	return parsed.data;
}
// #endregion

// #region Refusals
/** A refusal a caller can act on: the status and the sentence to show, keyed to its field. */
export interface AccessRefusal {
	status: 403 | 404 | 422;
	message: string;
	errors?: Record<string, string>;
}

/** A database error from the access RPCs. */
export interface AccessDbError {
	code?: string;
	message?: string;
}

const NOT_YOURS = "Only the owner and people who can edit decide who has access.";
const ARCHIVED = "This workspace is archived, so its files can't be changed.";

/**
 * What a refusal from `files.get_item_access` / `files.set_item_access` means: `42501` not the caller's
 * to change, `PF404` a file they cannot read, `22023` a grant list the rules refuse (its sentence is
 * the database's), `22P02` a malformed kind, role or id. Anything else is `null`: a failure to throw.
 */
export function accessRefusal(error: AccessDbError): AccessRefusal | null {
	const text = (error.message ?? "").trim();
	switch (error.code) {
		case "42501":
			if (text.startsWith("files: an archived library")) return { status: 403, message: ARCHIVED };
			return { status: 403, message: text ? `${text.replace(/\.$/, "")}.` : NOT_YOURS };
		case "PF404":
			return { status: 404, message: "No such file." };
		case "22023":
			return {
				status: 422,
				message: text ? `${text.replace(/\.$/, "")}.` : "Those access changes are not valid.",
				errors: { grants: "refused" },
			};
		case "22P02":
			return {
				status: 422,
				message: "Those access changes are not valid.",
				errors: { grants: "invalid" },
			};
		default:
			return null;
	}
}
// #endregion
