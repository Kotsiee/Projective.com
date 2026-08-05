import { z } from "zod";

/**
 * files.downloads — the Zod SSOT for the download ledger.
 *
 * Two jobs, and only two. It answers "who has taken a copy of this?" for an owner reviewing a shared
 * asset, and it answers "have I already downloaded this?" for the viewer, so the hub can offer
 * "you downloaded this on Tuesday — open it instead" rather than silently handing over a second copy.
 *
 * **There is no IP address field here, and one must not be added.** An IP is personal data under GDPR,
 * it is the single highest-value column in any breach of this table, and neither job above needs it:
 * an owner wants to know a person took a copy, not where they were standing. Identity comes from
 * `actorUserId` when the downloader is signed in, and from an opaque, rotating `deviceFingerprint`
 * when they are an anonymous share recipient — which is enough to answer "again?" and deliberately not
 * enough to locate anyone. Abuse metering is a separate, short-retention concern and belongs at the
 * edge, not in a user-visible ledger the owner can read.
 *
 * Only enum/array/string/number/boolean primitives are used so the module stays stable across Zod
 * majors.
 */

// #region Vocabulary

/**
 * The route a download came through — the ONE thing that distinguishes an owner pulling their own
 * file from a stranger draining a share link.
 *
 * - `hub`     — the `/files` library.
 * - `share`   — a public share slug (the only anonymous path).
 * - `picker`  — the attachment picker inside a composer or a form.
 * - `preview` — a save from the preview modal.
 * - `api`     — a programmatic pull (a plugin or an integration acting on the user's behalf).
 */
export const DownloadVia = z.enum(["hub", "share", "picker", "preview", "api"]);
export type DownloadVia = z.infer<typeof DownloadVia>;

// #endregion

// #region Event row

/**
 * One row of `files.download_events`.
 *
 * `assetName` is denormalised onto the event on purpose: a ledger entry has to stay readable after the
 * asset it refers to is renamed or archived, and an owner auditing a leak needs to see the name the
 * file had when it left.
 */
export const DownloadEventSchema = z.object({
	id: z.string().min(1).max(80),
	assetId: z.string().min(1).max(120),
	/** The asset's name AT DOWNLOAD TIME — the ledger must survive a later rename. */
	assetName: z.string().min(1).max(200),
	/** The signed-in downloader, or `null` for an anonymous share recipient. */
	actorId: z.string().max(80).nullable(),
	/** The downloader's `@handle` → the canonical `/@handle` link (Decision #3); `null` when anonymous. */
	actorHandle: z.string().max(40).nullable(),
	via: DownloadVia,
	/** The share link used, when `via === "share"`; `null` otherwise. */
	shareSlug: z.string().max(64).nullable(),
	/**
	 * An opaque, rotating per-browser token. It exists so the "you already have this" prompt works for
	 * an anonymous recipient; it is not an identifier, is never shown to an owner, and must never be
	 * derived from anything stable about the person or their network.
	 */
	deviceFingerprint: z.string().max(120).nullable(),
	/** ISO timestamp — the sortable key. */
	at: z.string(),
	/** Pre-formatted absolute date-time ("Jul 14 · 2:30 PM") — SSR == the client refetch. */
	dateLabel: z.string().max(28),
});
export type DownloadEvent = z.infer<typeof DownloadEventSchema>;

// #endregion

// #region Page envelope

/** A cursor-paged slice of the ledger for one asset (or one owner's whole library). */
export const DownloadHistoryPageSchema = z.object({
	events: z.array(DownloadEventSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	/** Total matched across all pages — drives the "N downloads" caption. */
	total: z.number().int().min(0),
});
export type DownloadHistoryPage = z.infer<typeof DownloadHistoryPageSchema>;

// #endregion

// #region Guard

/**
 * The server's answer to "has the acting viewer taken this one already?" — computed server-side so the
 * client never has to guess from `localStorage`, which is wiped, per-browser, and wrong the moment the
 * same person opens the asset on their phone.
 */
export const DownloadGuardSchema = z.object({
	alreadyDownloaded: z.boolean(),
	/** ISO timestamp of the most recent prior download; `null` when there was none. */
	lastAt: z.string().nullable(),
	/**
	 * A human description of where it happened ("this browser", "another device"); `null` when unknown.
	 * Deliberately vague — enough to jog a memory, never enough to profile a person's devices.
	 */
	lastDeviceLabel: z.string().max(60).nullable(),
});
export type DownloadGuard = z.infer<typeof DownloadGuardSchema>;

// #endregion

// #region Pure helpers

/**
 * Whether this asset was already downloaded by this actor, or failing that by this device.
 *
 * Signed-in identity wins: when `actorId` is given, only a matching `actorId` counts, because the same
 * person on a new browser has still downloaded it. Only when there is no actor does the opaque
 * `deviceFingerprint` stand in, which is the anonymous-share case.
 *
 * With NEITHER an actor nor a fingerprint this returns `false` even if the ledger is full — an
 * unidentifiable caller must never inherit a stranger's history, and the honest answer to "is this you
 * again?" when nothing identifies you is no.
 */
export function wasDownloadedBy(
	history: readonly DownloadEvent[],
	assetId: string,
	actorId: string | null,
	deviceFingerprint: string | null,
): boolean {
	if (!actorId && !deviceFingerprint) return false;
	return history.some((event) => {
		if (event.assetId !== assetId) return false;
		if (actorId) return event.actorId === actorId;
		return event.deviceFingerprint !== null &&
			event.deviceFingerprint === deviceFingerprint;
	});
}

// #endregion
