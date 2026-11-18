import {
	DATA_EXPORT_POLICY,
	type DataExportFailure,
	type DataExportState,
} from "@projective/types/org";

/**
 * data-export-model — what Settings → Account's "Download your data" block shows (Decision #450),
 * decided from the definer's answer alone, and the dev `dataExport` axis's substitute answers. Pure,
 * so every state is unit-tested and the block only renders the view it is handed.
 */

// #region View
/** One state of the block. */
export type DataExportView =
	| { kind: "unavailable" }
	| { kind: "closing" }
	| { kind: "preparing"; requestedAt: string }
	| {
		kind: "ready";
		expiresAt: string;
		byteSize: number | null;
		/** A new copy may be asked for once the 24-hour limit allows (`null` = now, unless closing). */
		next: NextRequest;
	}
	| {
		kind: "request";
		/** How the last request ended, when it did not end in a download still waiting. */
		last: "expired" | "failed" | null;
		failureReason: DataExportFailure | null;
		next: NextRequest;
	};

/** Whether, and how, the next request can be filed. */
export interface NextRequest {
	/** When the 24-hour limit lets the next request be filed; `null` = now. */
	at: string | null;
	/** Whether this session must sign in again before the request is filed. */
	needsSignIn: boolean;
	/** An erasure is scheduled, so no new request can be filed. */
	closing: boolean;
}

/** The view for an answer, or `unavailable` when it could not be read. */
export function dataExportView(state: DataExportState | null, now: Date): DataExportView {
	if (!state) return { kind: "unavailable" };
	const latest = state.latest;
	if (latest && (latest.status === "pending" || latest.status === "building")) {
		return { kind: "preparing", requestedAt: latest.requestedAt };
	}
	const next: NextRequest = {
		at: state.nextRequestAt && Date.parse(state.nextRequestAt) > now.getTime()
			? state.nextRequestAt
			: null,
		needsSignIn: !state.signInFresh,
		closing: state.accountClosing,
	};
	if (
		latest?.status === "ready" && latest.expiresAt && Date.parse(latest.expiresAt) > now.getTime()
	) {
		return { kind: "ready", expiresAt: latest.expiresAt, byteSize: latest.byteSize, next };
	}
	if (state.accountClosing) return { kind: "closing" };
	return {
		kind: "request",
		last: latest?.status === "failed" ? "failed" : latest ? "expired" : null,
		failureReason: latest?.status === "failed" ? latest.failureReason : null,
		next,
	};
}

/** The size of an archive as a person reads it (`1.4 MB`). */
export function archiveSize(bytes: number | null, locale: string): string | null {
	if (bytes === null) return null;
	const units = ["byte", "kilobyte", "megabyte"] as const;
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	try {
		return new Intl.NumberFormat(locale, {
			style: "unit",
			unit: units[unit],
			unitDisplay: "short",
			maximumFractionDigits: unit === 0 ? 0 : 1,
		}).format(value);
	} catch {
		return `${Math.round(value)} ${["B", "kB", "MB"][unit]}`;
	}
}

/** Where a stale session goes to sign in again, coming back to the block. */
export const DATA_EXPORT_SIGN_IN_HREF = `/login?redirectTo=${
	encodeURIComponent("/settings/account#data-export")
}`;

/** What the download link answers when nothing is ready (`?export=unavailable`). */
export const DATA_EXPORT_UNAVAILABLE_PARAM = "unavailable";

/** Why a failed request failed, in the person's words. */
export const DATA_EXPORT_FAILURE_COPY: Readonly<Record<DataExportFailure, string>> = {
	build_failed: "We couldn't prepare your last copy. You can ask again.",
	too_large:
		"Your last copy came out too large to store. Contact us and we'll send it another way.",
	account_erased: "Your last copy was cancelled.",
};
// #endregion

// #region Dev simulation
/** The positions of the dev `dataExport` axis (mirrors `DevDataExport`). */
export type DataExportSimulation =
	| "auto"
	| "none"
	| "preparing"
	| "ready"
	| "expired"
	| "failed"
	| "reauth"
	| "closing";

const HOUR = 3_600_000;

function at(now: Date, hours: number): string {
	return new Date(now.getTime() + hours * HOUR).toISOString();
}

/**
 * The answer a simulation position substitutes for `org.get_data_export`; `auto` returns the real one
 * untouched. Nothing is written, and the request button still calls the real door.
 */
export function simulatedDataExport(
	mode: DataExportSimulation,
	real: DataExportState | null,
	now: Date,
): DataExportState | null {
	if (mode === "auto") return real;
	const base: DataExportState = {
		latest: null,
		nextRequestAt: null,
		signInFresh: true,
		accountClosing: false,
	};
	const request = (status: "pending" | "ready" | "failed", hoursAgo: number) => ({
		id: "00000000-0000-4000-8000-0000000004a0",
		status,
		requestedAt: at(now, -hoursAgo),
		readyAt: status === "ready" ? at(now, -hoursAgo + 0.2) : null,
		expiresAt: status === "ready"
			? at(now, -hoursAgo + 0.2 + DATA_EXPORT_POLICY.linkDays * 24)
			: null,
		byteSize: status === "ready" ? 1_482_113 : null,
		failureReason: status === "failed" ? "build_failed" as const : null,
	});
	switch (mode) {
		case "none":
			return base;
		case "preparing":
			return { ...base, latest: request("pending", 0.1), nextRequestAt: at(now, 23.9) };
		case "ready":
			return { ...base, latest: request("ready", 2), nextRequestAt: at(now, 22) };
		case "expired":
			return { ...base, latest: { ...request("ready", 24 * 9), status: "expired" } };
		case "failed":
			return { ...base, latest: request("failed", 1) };
		case "reauth":
			return { ...base, signInFresh: false };
		case "closing":
			return { ...base, accountClosing: true };
	}
}
// #endregion
