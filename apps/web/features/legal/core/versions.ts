/**
 * Legal versions and addresses — the pure, schema-free half of the legal surface (Decision #270).
 *
 * Client-reachable on purpose: the version controls island imports this module, so it imports no
 * content module, no Zod schema and nothing server-only. The content registry (`registry.ts`) and the
 * request resolver (`view.ts`) build on it server-side.
 *
 * The URL contract of a legal document, stated once:
 *
 * | Address                                   | Shows                                                  |
 * | :---------------------------------------- | :----------------------------------------------------- |
 * | `/legal/<slug>`                           | the version in effect today (the canonical URL)        |
 * | `/legal/<slug>?v=<version>`               | that version, pinned — a shared link keeps showing it  |
 * | `/legal/<slug>?compare=<older>`           | today's version, diffed clause by clause against older |
 * | `/legal/<slug>?v=<newer>&compare=<older>` | `newer` diffed against `older`                         |
 * | `/legal/<slug>/pdf` (`?v=<version>`)      | the same version as a PDF download                     |
 *
 * The canonical link is always the bare `/legal/<slug>`, whatever the parameters.
 *
 * @module
 */

// #region Version labels
/** The parts of a `MAJOR.MINOR` label, or `null` when it is not one. */
function parts(version: string): [number, number] | null {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
	return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Whether `value` is a `MAJOR.MINOR` version label (`2.0`). */
export function isVersionLabel(value: string): boolean {
	return parts(value) !== null;
}

/**
 * Order two `MAJOR.MINOR` labels numerically (`1.10` is newer than `1.9`): negative when `a` is
 * older, positive when newer, zero when equal. A label that does not parse sorts as the oldest.
 */
export function compareVersions(a: string, b: string): number {
	const pa = parts(a);
	const pb = parts(b);
	if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
	return pa[0] - pb[0] || pa[1] - pb[1];
}
// #endregion

// #region Version status
/**
 * Where a version stands today: `current` (the newest one in effect), `superseded` (replaced by a
 * newer one in effect) or `upcoming` (published, with an effective date still ahead).
 */
export type LegalVersionStatus = "current" | "superseded" | "upcoming";

/** What the version controls and the meta line need to know about one version. */
export interface LegalVersionSummary {
	version: string;
	/** `YYYY-MM-DD`. */
	effectiveDate: string;
	/** `YYYY-MM-DD` when a lawyer signed it off; `null` while it is a draft. */
	reviewedAt: string | null;
	changeSummary: string;
	status: LegalVersionStatus;
}

/**
 * The status of every version (newest first in, newest first out) on `today` (`YYYY-MM-DD`): the
 * first version whose effective date has arrived is `current`, every newer one `upcoming`, every
 * older one `superseded`. When none is in effect yet, the OLDEST is current — a document always has
 * one version to show, and it is the one that will take effect first.
 */
export function versionStatuses<
	V extends {
		version: string;
		effectiveDate: string;
		reviewedAt: string | null;
		changeSummary: string;
	},
>(versions: readonly V[], today: string): LegalVersionSummary[] {
	let current = versions.findIndex((v) => v.effectiveDate <= today);
	if (current === -1) current = versions.length - 1;
	return versions.map((v, i) => ({
		version: v.version,
		effectiveDate: v.effectiveDate,
		reviewedAt: v.reviewedAt,
		changeSummary: v.changeSummary,
		status: i === current ? "current" : i < current ? "upcoming" : "superseded",
	}));
}

/** The versions older than `version` (still newest first) — what it can be compared against. */
export function olderThan<V extends { version: string }>(
	versions: readonly V[],
	version: string,
): V[] {
	return versions.filter((v) => compareVersions(v.version, version) < 0);
}
// #endregion

// #region Addresses
/** The query a legal document address may carry. */
export interface LegalAddressQuery {
	/** The version to show; omitted, the version in effect today. */
	v?: string | null;
	/** An older version to diff the shown one against. */
	compare?: string | null;
}

/** `?v=…&compare=…` with empty values dropped, or `""`. */
function query({ v, compare }: LegalAddressQuery): string {
	const params = new URLSearchParams();
	if (v) params.set("v", v);
	if (compare) params.set("compare", compare);
	const text = params.toString();
	return text ? `?${text}` : "";
}

/** The address of a legal document, optionally pinned to a version and/or comparing (module table). */
export function legalDocumentHref(slug: string, q: LegalAddressQuery = {}): string {
	return `/legal/${slug}${query(q)}`;
}

/** The address of a legal document's PDF, optionally pinned to a version. */
export function legalPdfHref(slug: string, version?: string | null): string {
	return `/legal/${slug}/pdf${query({ v: version })}`;
}

/** The legal hub. */
export const LEGAL_HUB_HREF = "/legal";
// #endregion
