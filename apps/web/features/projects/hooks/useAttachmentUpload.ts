import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import { uploadForProject } from "../core/upload.ts";

/**
 * useAttachmentUpload — device files becoming `files.items` ids, with a card on screen the whole
 * time.
 *
 * Two places on the setup surface take a file: the reference attachments, and the custom NDA inside
 * Advanced options. They differ in how many files they accept and in what they do with the ids, and
 * in nothing else — so the optimistic card, the in-flight state, the per-file failure and the object
 * URL lifetime live here once rather than being written twice with two chances to leak a blob.
 *
 * ## The card exists before the upload does
 *
 * A file dropped into a form is a thing the reader has already decided about. Waiting for a round
 * trip before showing it means the interface says nothing for however long the network takes, and
 * the reader's only recourse is to drop it again — which is how one attachment becomes three. So the
 * row is inserted from the LOCAL file's own metadata immediately, carrying an object URL for its
 * thumbnail, and the upload resolves it in place.
 *
 * ## Failure is reported ON the card
 *
 * A file that does not land keeps its row, marked, with the reason beside it. A toast would be the
 * easier build and is wrong here: a drop of six files where one fails needs to say WHICH, and a
 * notification that names a file the reader then has to find in a list is asking them to do the
 * matching that the interface is for. The failed row also keeps its own remove control, so
 * dismissing the error and dismissing the file are the same gesture rather than two.
 */

// #region Shapes
/** One file the reader has dropped, before it is an asset. */
export interface PendingAttachment {
	/** Local identity. Not an asset id — this row exists precisely because there is not one yet. */
	key: string;
	name: string;
	sizeBytes: number;
	/** An object URL for a thumbnail, or `null` for a file with nothing to show. */
	previewUrl: string | null;
	status: "uploading" | "failed";
	/** Why it failed, already phrased for display. `null` while it is still in flight. */
	error: string | null;
}

/** One asset that landed — the shape both call sites fold into their own state. */
export interface LandedAttachment {
	id: string;
	name: string;
	sizeBytes: number | null;
}

export interface UseAttachmentUpload {
	/** The optimistic rows, in the order they were dropped. */
	pending: Signal<PendingAttachment[]>;
	/** At least one transfer is in flight. */
	busy: Signal<boolean>;
	/**
	 * Thumbnails for assets that landed in THIS session, keyed by asset id.
	 *
	 * Kept after the upload finishes so the row does not lose its picture at the moment it succeeds —
	 * a thumbnail that vanishes on success reads as something having gone wrong, which is the exact
	 * opposite of what happened. The server's own thumbnail is not available synchronously (it is
	 * derived after `upload-complete`), so the local one is the only image there is until a reload.
	 */
	previews: Signal<Record<string, string>>;
	/** Upload these files, capped at whatever room the caller reports. */
	send: (files: File[]) => void;
	/** Drop a pending row — a failure the reader has read, or one they no longer want. */
	dismiss: (key: string) => void;
}

/** How the hook is wired to its call site. */
export interface AttachmentUploadOptions {
	/** Called with the assets that landed, in the order they were dropped. */
	onLanded: (assets: LandedAttachment[]) => void;
	/**
	 * How many more files this zone will accept, read at the moment of the drop.
	 *
	 * A function rather than a number because the room changes as rows land — a value captured when
	 * the hook mounted would let a second drop exceed a cap the first one had just filled.
	 */
	room: () => number;
}
// #endregion

// #region Object URLs
/** Only a file the browser can actually paint gets a preview; everything else shows its kind glyph. */
function previewFor(file: File): string | null {
	if (!file.type.startsWith("image/")) return null;
	try {
		return URL.createObjectURL(file);
	} catch {
		return null;
	}
}

/** Release an object URL. Safe to call with `null` and safe to call twice. */
function release(url: string | null): void {
	if (!url) return;
	try {
		URL.revokeObjectURL(url);
	} catch {
		// Already revoked, or a URL this document did not mint. Nothing to undo either way.
	}
}
// #endregion

let seq = 0;
/** A local row id. Only has to be unique within this list, for the life of this mount. */
function newKey(): string {
	seq += 1;
	return `pending-${seq}`;
}

export function useAttachmentUpload(opts: AttachmentUploadOptions): UseAttachmentUpload {
	const pending = useSignal<PendingAttachment[]>([]);
	const busy = useSignal<boolean>(false);
	const previews = useSignal<Record<string, string>>({});

	/*
	 * Every object URL this mount created is revoked when it unmounts.
	 *
	 * An object URL pins the whole file in memory until it is revoked or the document is discarded, so
	 * a 40 MB reference PDF dropped and navigated away from stays resident for the life of the tab.
	 * Both maps are swept, not just the pending one: a landed preview outlives its row by design.
	 */
	useEffect(() => () => {
		for (const row of pending.peek()) release(row.previewUrl);
		for (const url of Object.values(previews.peek())) release(url);
	}, []);

	const dismiss = (key: string) => {
		const row = pending.peek().find((p) => p.key === key);
		release(row?.previewUrl ?? null);
		pending.value = pending.peek().filter((p) => p.key !== key);
	};

	/** Resolve one row: drop it on success, mark it in place on failure. */
	const settle = (key: string, error: string | null) => {
		if (error === null) {
			// The real row takes over from here, so the optimistic one goes — but its preview does NOT,
			// because the real row is about to render it. Ownership of the URL transfers to `previews`.
			pending.value = pending.peek().filter((p) => p.key !== key);
			return;
		}
		pending.value = pending.peek().map((p) =>
			p.key === key ? { ...p, status: "failed" as const, error } : p
		);
	};

	const send = (files: File[]) => {
		if (files.length === 0) return;
		const room = Math.max(0, opts.room());
		const accepted = files.slice(0, room);
		if (accepted.length === 0) return;

		const rows: PendingAttachment[] = accepted.map((file) => ({
			key: newKey(),
			name: file.name,
			sizeBytes: file.size,
			previewUrl: previewFor(file),
			status: "uploading",
			error: null,
		}));
		pending.value = [...pending.peek(), ...rows];

		void (async () => {
			busy.value = true;
			try {
				const me = await AccountService.current();
				const ownerId = me?.userId ?? null;
				if (!ownerId) {
					// Nothing was attempted, so every row fails with the same, accurate reason. Reported on
					// the rows rather than as one message, because the rows are what the reader is looking
					// at and a row left spinning forever is the one outcome that is never acceptable.
					for (const row of rows) {
						settle(row.key, "We could not tell whose library to file this in — sign in again.");
					}
					return;
				}

				const landed: LandedAttachment[] = [];
				const outcome = await uploadForProject(accepted, {
					ownerType: "user",
					ownerId,
					metadataFor: extractMetadata,
					// Resolves each card the moment ITS file finishes, rather than when the slowest file in
					// the drop does.
					onSettled: (index, result) => {
						const row = rows[index];
						if (!row) return;
						if (result.ok) {
							if (row.previewUrl) {
								previews.value = { ...previews.peek(), [result.assetId]: row.previewUrl };
							}
							landed.push({
								id: result.assetId,
								name: accepted[index].name,
								sizeBytes: accepted[index].size,
							});
						}
						settle(row.key, result.ok ? null : result.message);
					},
				});

				/*
				 * Handed over in ONE call at the end rather than per file.
				 *
				 * The caller folds these into the draft, and every fold is a `patchSetup` that re-derives
				 * the whole ladder — six files dropped together would otherwise be six re-derivations and
				 * six potential auto-saves. The cards have already resolved individually, so nothing the
				 * reader watches is waiting on this.
				 *
				 * Ordered by the caller's own array via `outcome.assetIds`, not by completion, so a drop
				 * of several files attaches them in the order they were picked.
				 */
				const byId = new Map(landed.map((a) => [a.id, a]));
				const ordered = outcome.assetIds
					.map((id) => byId.get(id))
					.filter((a): a is LandedAttachment => a !== undefined);
				if (ordered.length > 0) opts.onLanded(ordered);
			} finally {
				busy.value = false;
			}
		})();
	};

	return { pending, busy, previews, send, dismiss };
}
