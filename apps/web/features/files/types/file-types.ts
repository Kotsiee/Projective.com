/**
 * Files domain types — sourced from the Zod SSOT at `@projective/types/files`.
 *
 * App components / islands / core helpers import shapes through this shim (the stable in-feature
 * path); the fat `FilesBackendService` imports the packages directly. Mirrors
 * `catalogue/types/catalogue-types.ts` and `projects/types/projects-types.ts`.
 *
 * Two things live here beyond the star export, and each is here for a stated reason:
 *
 *  1. **Borrowed re-exports** — `SubmissionTreeNode` (the shape `SubmissionCard` reads) and
 *     `PlanCode` (the key of the SSOT's `PLAN_STORAGE_MIB` ladder), so a consumer needs one import
 *     path rather than three.
 *  2. **Client-only transient shapes** ({@link UploadTask}, {@link PickerRequest}) — the upload queue
 *     and the asset-picker request are per-session browser state that is never persisted and never
 *     round-trips in this form, so they are deliberately NOT SSOT material (the same reasoning that
 *     keeps the chat composer's draft out of `@projective/types`, Decision #66).
 *
 * Nothing that crosses the wire is declared here. The page envelope, the params, the payloads and
 * every enum come from the SSOT unchanged.
 */

// #region SSOT
export * from "@projective/types/files";
// #endregion

// #region Borrowed re-exports
/**
 * The submissions tree node the shared `SubmissionCard` / `SubmissionTree` components read. The hub's
 * `AssetTreeNode` is deliberately assignable to it (see `files/folders.ts`), which is what lets
 * `/files` reuse those components verbatim instead of forking a second folder-card family.
 */
export type { SubmissionTreeNode } from "@projective/types/projects";

/** The subscription plan code keying the SSOT's `PLAN_STORAGE_MIB` storage ladder. */
export type { PlanCode } from "@projective/types/finance";
// #endregion

import type {
	AssetItem,
	AssetListPage,
	AssetTreeNode,
	ContentFingerprint,
	DedupVerdict,
	DuplicateResolution,
	FileKind,
	FileScope,
	UploadTicket,
} from "@projective/types/files";

// #region Applied-page shape
/**
 * The structural minimum `applyPage` needs: the items, and anything else the page happened to carry.
 *
 * Derived FROM {@link AssetListPage} rather than restated, so a field added to the SSOT envelope is
 * automatically applicable and a field removed from it stops compiling here — the two cannot drift.
 * Everything but `items` is optional because the state module leaves an absent field UNTOUCHED rather
 * than resetting it, so a partial payload never silently blanks a region the server simply did not
 * re-send.
 *
 * `tree` is an addition, not part of the envelope: the navigation tree is answered by its own
 * `FilesBackendService.tree` read (it spans every scope, so it does not belong to any one page), and
 * this lets a caller that fetched both apply them in one write instead of two renders.
 */
export type AssetPageLike =
	& Pick<AssetListPage, "items">
	& Partial<Omit<AssetListPage, "items">>
	& { tree?: AssetTreeNode[] };
// #endregion

// #region Client-only transient shapes
/**
 * Where one queued upload has got to.
 *
 * The phases are separate because each one fails differently and each one is worth showing: `hashing`
 * is CPU on this machine, `checking` is a round trip, `uploading` is bytes leaving, and `finalising`
 * is the server promoting a `pending_upload` row. Collapsing them into "uploading" would report a
 * 400 MB file as stuck at 0% for the twenty seconds it is actually being digested.
 *
 * `blocked` is deliberately distinct from `error`: a quota refusal or a `blocked` link scan is a
 * decision, not a failure, and it needs a different sentence in front of it.
 */
export type UploadPhase =
	| "queued"
	| "hashing"
	| "checking"
	| "ready"
	| "uploading"
	| "finalising"
	| "done"
	| "blocked"
	| "error"
	| "cancelled";

/**
 * One entry in the upload queue — browser-only, never persisted, never sent in this shape.
 *
 * `id` is a client-minted queue key and is NOT the asset id: a task exists from the moment a file is
 * dropped, which is before the server has minted anything, and keying the queue on a value that
 * arrives late means the row cannot be addressed while it is hashing.
 */
export interface UploadTask {
	/** Client-minted queue key (see the note above — not `assetId`). */
	id: string;
	/** The picked file. Client-only; `null` for a task rebuilt without its handle. */
	file: File | null;
	name: string;
	sizeBytes: number;
	/** Pre-formatted size for the row, so the queue does not re-derive it every render. */
	sizeLabel: string;
	mimeType: string;
	/** The destination folder; `null` = the library root. */
	folderId: string | null;
	phase: UploadPhase;
	/** 0–1 within the CURRENT phase, so a determinate bar never runs backwards across a transition. */
	progress: number;
	/** The computed digest, or `null` when the browser had no `crypto.subtle` (insecure context). */
	fingerprint: ContentFingerprint | null;
	/** The server's duplicate verdict, once checked. */
	verdict: DedupVerdict | null;
	/** What the person chose about a conflict; `null` while unanswered. */
	resolution: DuplicateResolution | null;
	/** The server-minted `pending_upload` row, once init has answered. */
	assetId: string | null;
	/** The scoped signed-URL ticket, once init has answered. */
	ticket: UploadTicket | null;
	/** A human reason for `blocked` / `error`; `null` otherwise. */
	error: string | null;
}

/**
 * What an Asset Picker was opened for.
 *
 * `requesterId` exists so a picker opened from a composer and a picker opened from a form can share
 * one host: the selection is published globally, and the requester is how a consumer knows whether
 * the answer is for it. Without it the second caller silently receives the first caller's files.
 */
export interface PickerRequest {
	/** Opaque id of whatever opened the picker — the routing key for the resulting selection. */
	requesterId: string;
	/** Header copy; `null` uses the picker's default. */
	title?: string | null;
	/** Restrict to these kinds; empty/absent = every kind. */
	kinds?: FileKind[];
	/** Which spaces the picker may browse; empty/absent = every space the viewer can reach. */
	scopes?: FileScope[];
	/** Whether more than one asset may be returned. */
	multiple: boolean;
	/** Hard ceiling on the selection when `multiple`; absent = unbounded. */
	max?: number;
}

/** The assets a picker resolved to — published for the requester named in its {@link PickerRequest}. */
export type PickerAnswer = AssetItem[];
// #endregion
