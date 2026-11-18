import { BUCKETS, dataExportLocation } from "@projective/types/files";
import {
	DATA_EXPORT_MANIFEST_VERSION,
	DATA_EXPORT_POLICY,
	type DataExportClaim,
	DataExportClaimSchema,
	DataExportDomain,
	type DataExportExpiry,
	DataExportExpirySchema,
	type DataExportFailure,
	type DataExportState,
	DataExportStateRowSchema,
	type DataExportSweep,
} from "@projective/types/org";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { signedObjectUrl, uploadObject } from "../../core/storage-signed.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { RpcError } from "./account-lifecycle-refusals.ts";
import { dataExportFailure } from "./data-export-refusals.ts";
import { collectDomain, collectProfile } from "./data-export-collectors.ts";
import { buildArchive } from "./data-export-archive.ts";
import { AccountLifecycleBackendService } from "./AccountLifecycleBackendService.ts";

/**
 * DataExportBackendService — the FAT service behind "Download your data" in Settings → Account
 * (Decision #450; migration 00001061).
 *
 * The person's doors ({@link state}, {@link request}, {@link downloadLink}) run definers bound to
 * the caller's OWN access token, which resolve the person from `auth.uid()` and enforce every rule:
 * a sign-in in the last 10 minutes, one open request, one a day, none while an erasure is scheduled.
 * {@link sweep} is the scheduler's door: as the service role it builds each claimed request into a ZIP
 * in the private `data_exports` bucket and removes archives past their 7 days. A download link is
 * minted per read, for {@link DATA_EXPORT_POLICY.downloadLinkSeconds} seconds, and never stored.
 *
 * Gated on `AUTH_BACKEND_LIVE`: with no database there is nothing truthful to answer, so every method
 * refuses with a 503. A guest is a 401.
 */

const BUCKET = "data_exports" as const;

// #region Guards
function sessionToken(actor: ReadActor): string | ServiceResult<never> {
	if (!actor.userId) return fail(401, { message: "Sign in to download your data." });
	if (!isAuthBackendLive()) {
		return fail(503, { message: "Your data can't be exported in this environment." });
	}
	if (!canReadLive(actor)) {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return actor.accessToken;
}

function unreachable(error: unknown): ServiceResult<never> {
	return fail(503, {
		message: "We couldn't reach the server. Try again in a moment.",
		details: { reason: error instanceof Error ? error.message : String(error) },
	});
}

function malformed(): ServiceResult<never> {
	return fail(502, { message: "The server answered with an unreadable export status." });
}

function archiveName(readyAt: string | null): string {
	return `projective-data-${(readyAt ?? new Date().toISOString()).slice(0, 10)}.zip`;
}
// #endregion

// #region The job's steps
function service() {
	return getServiceClient().schema("security");
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
	const res = await service().rpc(fn, args);
	if (res.error) {
		throw new Error(`security.${fn}: ${res.error.message}`, { cause: res.error });
	}
	return res.data;
}

/** Build one claimed request: every domain, the ZIP, the upload, the settlement. */
async function build(claim: DataExportClaim, origin: string): Promise<"built" | DataExportFailure> {
	const collect = (domain: DataExportDomain) =>
		rpc("collect_data_export", { p_request: claim.id, p_domain: domain });
	const profile = collectProfile(await collect("profile"));
	const files = new Map<DataExportDomain, unknown>([["profile", profile]]);
	for (const domain of DataExportDomain.options) {
		if (domain === "profile") continue;
		files.set(domain, collectDomain(domain, await collect(domain), { origin }));
	}

	const { bytes } = buildArchive({
		requestId: claim.id,
		requestedAt: claim.requested_at,
		userId: claim.user_id,
		handle: profile.profile?.username ?? null,
		generatedAt: new Date(),
		files,
	});
	if (bytes.byteLength > BUCKETS[BUCKET].maxBytes) return "too_large";

	const { path } = dataExportLocation(claim.user_id, claim.id);
	const uploaded = await uploadObject(BUCKET, path, bytes, "application/zip", { upsert: true });
	if (!uploaded) throw new Error(`Storage refused the archive for request ${claim.id}.`);

	const settled = await rpc("complete_data_export", {
		p_request: claim.id,
		p_path: path,
		p_bytes: bytes.byteLength,
		p_manifest_version: DATA_EXPORT_MANIFEST_VERSION,
	});
	if (settled !== true) {
		await removeArchive(path);
		return "account_erased";
	}
	return "built";
}

/** Remove one archive. Throws when storage refuses, so the row is not marked expired over live bytes. */
async function removeArchive(path: string): Promise<void> {
	const { error } = await getServiceClient().storage.from(BUCKET).remove([path]);
	if (error) {
		throw new Error(`Storage refused to remove ${path}: ${error.message}`, { cause: error });
	}
}
// #endregion

export class DataExportBackendService {
	// #region The person's doors
	/** The caller's latest request, when the next may be filed, and whether their sign-in is fresh. */
	static async state(actor: ReadActor): Promise<ServiceResult<{ dataExport: DataExportState }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("get_data_export");
			if (res.error) return dataExportFailure(res.error as RpcError);
			const parsed = DataExportStateRowSchema.safeParse(res.data);
			return parsed.success ? ok({ dataExport: parsed.data }) : malformed();
		} catch (error) {
			return unreachable(error);
		}
	}

	/** File a request for a copy of the caller's own data. Answers the state afterwards. */
	static async request(actor: ReadActor): Promise<ServiceResult<{ dataExport: DataExportState }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const res = await getUserClient(token).schema("org").rpc("request_data_export");
			if (res.error) return dataExportFailure(res.error as RpcError);
			const parsed = DataExportStateRowSchema.safeParse(res.data);
			if (!parsed.success) return malformed();
			return ok({ dataExport: parsed.data }, {
				message: "We're preparing your copy. We'll let you know here when it's ready.",
			});
		} catch (error) {
			return unreachable(error);
		}
	}

	/**
	 * A short-lived link to the caller's ready archive, minted now. The archive is found from the
	 * caller's own request (read under their JWT) at the path the completion door enforces, so no
	 * client-supplied path is ever signed.
	 */
	static async downloadLink(actor: ReadActor): Promise<ServiceResult<{ url: string }>> {
		const current = await DataExportBackendService.state(actor);
		if (!current.ok || !current.data) {
			return fail(current.status, { message: current.message, details: current.details });
		}
		const latest = current.data.dataExport.latest;
		if (!latest || latest.status !== "ready") {
			return fail(404, { message: "There's no copy ready to download. Request a new one." });
		}
		try {
			const { path } = dataExportLocation(actor.userId, latest.id);
			const url = await signedObjectUrl(
				BUCKET,
				path,
				DATA_EXPORT_POLICY.downloadLinkSeconds,
				archiveName(latest.readyAt),
			);
			return url
				? ok({ url })
				: fail(404, { message: "Your copy couldn't be found. Request a new one." });
		} catch (error) {
			return unreachable(error);
		}
	}
	// #endregion

	// #region Scheduler
	/** Whether a request carries the scheduler's bearer token (`ACCOUNT_CRON_SECRET`). */
	static isCronAuthorised(authorization: string | null): boolean {
		return AccountLifecycleBackendService.isCronAuthorised(authorization);
	}

	/**
	 * One run of the `account-data-exports` job: build up to `limit` claimed requests, then remove every
	 * archive past its expiry. A build that throws is handed back for a retry (failing for good on its
	 * third attempt) and logged with its cause; it never stops the rest of the run.
	 */
	static async sweep(limit = 5): Promise<ServiceResult<DataExportSweep>> {
		if (!isAuthBackendLive()) {
			return fail(503, { message: "The data export job can't run in this environment." });
		}
		const tally: DataExportSweep = { built: 0, retried: 0, failed: 0, expired: 0 };
		let claims: DataExportClaim[];
		let expiries: DataExportExpiry[];
		try {
			claims = DataExportClaimSchema.array().parse(
				await rpc("claim_data_exports", { p_limit: limit }),
			);
		} catch (error) {
			return unreachable(error);
		}
		const origin = serverEnv().appUrl;

		for (const claim of claims) {
			try {
				const outcome = await build(claim, origin);
				if (outcome === "built") tally.built += 1;
				else if (outcome === "too_large") {
					await rpc("release_data_export", { p_request: claim.id, p_reason: "too_large" });
					tally.failed += 1;
				}
			} catch (error) {
				console.error("[data-export:build]", claim.id, error);
				try {
					const next = await rpc("release_data_export", {
						p_request: claim.id,
						p_reason: "build_failed",
					});
					if (next === "pending") tally.retried += 1;
					else tally.failed += 1;
				} catch (releaseError) {
					console.error("[data-export:release]", claim.id, releaseError);
				}
			}
		}

		try {
			expiries = DataExportExpirySchema.array().parse(
				await rpc("due_data_export_expiries", { p_limit: 50 }),
			);
		} catch (error) {
			return unreachable(error);
		}
		for (const expiry of expiries) {
			try {
				await removeArchive(expiry.storage_path);
				if (await rpc("expire_data_export", { p_request: expiry.id }) === true) tally.expired += 1;
			} catch (error) {
				console.error("[data-export:expire]", expiry.id, error);
			}
		}
		return ok(tally);
	}
	// #endregion
}
