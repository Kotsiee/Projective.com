import { z } from "zod";
import { AssetVisibility, LinkScanStatus } from "./assets.ts";
import { DedupOutcome } from "./dedup.ts";

/**
 * files.sim — the developer SIMULATION overlay for the asset-hub reads.
 *
 * The Dev Context Switcher is a CLIENT-side seam (`<html data-dev-*>`), so the server cannot see it.
 * Every axis on this surface changes data the SERVER produced — which provider a mount came from,
 * whether a connection is healthy, how full the quota is, what a link scan concluded — so reading the
 * seam client-side would move nothing. The axes therefore travel as validated QUERY PARAMS on the read
 * and the fat service applies them as an overlay: the same mechanism `/wallet` (Decision #55) and
 * `/teams` (Decision #61) use, for the same reason.
 *
 * It grants **no access**. It only changes what the developer's own request is answered with; the live
 * path ignores it entirely and RLS remains the real gate. Every field is optional — an absent field
 * means "use the real projection", and an overlay that restated the defaults would make every request
 * look simulated and hide which axis is actually being exercised.
 *
 * **The connection-state vocabulary is declared HERE rather than imported from
 * `@projective/types/integrations`.** The integrations domain imports THIS one (its drive-browse page
 * is projected over `AssetItem`/`AssetFolder`), so the files domain must never import back — that edge
 * is one-way by construction, and closing it would be the TDZ crash class recorded in Decision #49
 * rather than a style problem. The members mirror `integrations.connection_status` exactly.
 */

// #region Axes

/**
 * Which storage backend the hub is simulating. `link` is deliberately absent — it is an asset SOURCE,
 * not a provider you can be connected to, and offering it as a connection axis would imply an account
 * to authorise.
 */
export const SimStorageProvider = z.enum([
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
]);
export type SimStorageProvider = z.infer<typeof SimStorageProvider>;

/**
 * The simulated health of the connector the mounts are coming from. Mirrors
 * `integrations.connection_status` member for member, plus `none` for the never-connected path — which
 * is a distinct surface (an empty state that offers to connect) and not a degraded one.
 */
export const SimConnectionState = z.enum([
	"none",
	"pending",
	"active",
	"degraded",
	"expired",
	"revoked",
	"disconnected",
	"error",
]);
export type SimConnectionState = z.infer<typeof SimConnectionState>;

/**
 * The simulated quota band. Mirrors {@link StorageQuotaState} plus `unlimited`, because an unlimited
 * allowance renders a different meter entirely (no ceiling, no percentage) rather than a full one.
 */
export const SimQuotaState = z.enum([
	"empty",
	"healthy",
	"warning",
	"critical",
	"exceeded",
	"unlimited",
]);
export type SimQuotaState = z.infer<typeof SimQuotaState>;

// #endregion

// #region Overlay

/** The simulation overlay. Every field optional; an absent field uses the real projection. */
export const FilesSimSchema = z.object({
	/** Force the source the listed assets appear to come from. */
	storageProvider: SimStorageProvider.optional(),
	/** Force the connector's health — reaches the reconnect, re-consent and never-connected paths. */
	connectionState: SimConnectionState.optional(),
	/** Force the quota band — reaches the warning, critical, exceeded and unlimited meters. */
	storageQuota: SimQuotaState.optional(),
	/** Force the privacy scope of the listed assets — reaches the shared and public badge states. */
	assetVisibility: AssetVisibility.optional(),
	/** Force the link-safety verdict — reaches the suspicious, blocked and unscannable link cards. */
	linkScan: LinkScanStatus.optional(),
	/** Force the duplicate-detection outcome — reaches both conflict prompts without a real collision. */
	dedupState: DedupOutcome.optional(),
});
export type FilesSim = z.infer<typeof FilesSimSchema>;

/** Whether a simulation overlay asks for anything at all. */
export function filesSimIsEmpty(sim: FilesSim | undefined): boolean {
	if (!sim) return true;
	return sim.storageProvider === undefined &&
		sim.connectionState === undefined &&
		sim.storageQuota === undefined &&
		sim.assetVisibility === undefined &&
		sim.linkScan === undefined &&
		sim.dedupState === undefined;
}

// #endregion

// #region Query-param transport

/**
 * Parse an overlay from a request's query string, or `undefined` when none was asked for.
 *
 * Validated through {@link FilesSimSchema}, so a hand-crafted URL cannot inject an unvalidated shape.
 * A failed parse yields `undefined` — the real projection — because a malformed simulation should show
 * the truth rather than nothing.
 */
export function simFromParams(params: URLSearchParams): FilesSim | undefined {
	const raw: Record<string, unknown> = {};
	const storageProvider = params.get("simStorageProvider");
	const connectionState = params.get("simConnection");
	const storageQuota = params.get("simQuota");
	const assetVisibility = params.get("simVisibility");
	const linkScan = params.get("simLinkScan");
	const dedupState = params.get("simDedup");

	if (storageProvider) raw.storageProvider = storageProvider;
	if (connectionState) raw.connectionState = connectionState;
	if (storageQuota) raw.storageQuota = storageQuota;
	if (assetVisibility) raw.assetVisibility = assetVisibility;
	if (linkScan) raw.linkScan = linkScan;
	if (dedupState) raw.dedupState = dedupState;

	if (Object.keys(raw).length === 0) return undefined;
	const parsed = FilesSimSchema.safeParse(raw);
	if (!parsed.success) return undefined;
	return filesSimIsEmpty(parsed.data) ? undefined : parsed.data;
}

/**
 * Render an overlay as query params to append to a read.
 *
 * Returns `""` when there is nothing to simulate, so a production request is byte-identical to one
 * from before this seam existed — and otherwise a string with a **leading `&`**, matching
 * `workspace-seam.ts simToQuery`, because every call site appends it to a read that already carries a
 * scope param (`?scope=hub${simToQuery(sim)}`). The separator is part of the returned value on purpose:
 * the alternative silently concatenates onto the previous param when a caller forgets it.
 */
export function simToQuery(sim: FilesSim | undefined): string {
	if (!sim || filesSimIsEmpty(sim)) return "";
	const params = new URLSearchParams();
	if (sim.storageProvider) params.set("simStorageProvider", sim.storageProvider);
	if (sim.connectionState) params.set("simConnection", sim.connectionState);
	if (sim.storageQuota) params.set("simQuota", sim.storageQuota);
	if (sim.assetVisibility) params.set("simVisibility", sim.assetVisibility);
	if (sim.linkScan) params.set("simLinkScan", sim.linkScan);
	if (sim.dedupState) params.set("simDedup", sim.dedupState);
	const q = params.toString();
	return q ? `&${q}` : "";
}

// #endregion
