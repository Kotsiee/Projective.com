/**
 * legal/manifest — the versions of the three documents sign-up records (Decision #446).
 *
 * The server's one source for "which version is current": the join and re-accept doors stamp
 * {@link currentLegalVersions} into the payload, and the database re-checks every stamp against
 * `org.legal_document_versions`, so a version a client names itself is refused. `packages/backend`
 * cannot import `@features/*`, so the versions live here and two tests hold the copies together:
 * `manifest.contract.test.ts` (this list ⇄ the 00005050 seed) and
 * `features/legal/core/manifest.test.ts` (this list ⇄ the content modules).
 *
 * Publishing a version: add it to the content module, here (newest first) and to the 00005050 seed.
 * Mark it `material` when everyone who accepted an older one must accept it before they carry on;
 * any other version relies on the Terms' continued-use clause.
 *
 * @module
 */

// #region Documents
/** The documents a sign-up records, in the order the consent line names them. */
export const SIGNUP_LEGAL_SLUGS = ["terms", "acceptable-use", "privacy"] as const;
export type SignupLegalSlug = typeof SIGNUP_LEGAL_SLUGS[number];

/**
 * How a document is recorded: the Terms and the Acceptable Use Policy are `accepted`; the privacy
 * notice informs and is not consented to (its lawful basis is not consent), so it is `shown`.
 */
export const LEGAL_ACCEPTANCE_KINDS = ["accepted", "shown"] as const;
export type LegalAcceptanceKind = typeof LEGAL_ACCEPTANCE_KINDS[number];

/** Where an acceptance was given. */
export const LEGAL_ACCEPTANCE_SURFACES = [
	"join",
	"join_oauth",
	"join_enterprise",
	"reaccept",
] as const;
export type LegalAcceptanceSurface = typeof LEGAL_ACCEPTANCE_SURFACES[number];

/** The kind a document is recorded with (mirrors `org.fn_legal_acceptance_kind`). */
export function legalAcceptanceKind(slug: SignupLegalSlug): LegalAcceptanceKind {
	return slug === "privacy" ? "shown" : "accepted";
}
// #endregion

// #region Versions
/** One published version of a sign-up document. */
export interface LegalVersionEntry {
	/** `MAJOR.MINOR`. */
	version: string;
	/** `YYYY-MM-DD`: the day it governs from. */
	effectiveDate: string;
	/** Whether accepting an older version stops being enough once this one is in effect. */
	material: boolean;
}

/** Every version of each sign-up document, newest first. */
export const LEGAL_VERSIONS: Readonly<Record<SignupLegalSlug, readonly LegalVersionEntry[]>> =
	Object
		.freeze({
			terms: [
				{ version: "2.0", effectiveDate: "2026-10-17", material: false },
				{ version: "1.0", effectiveDate: "2026-08-01", material: false },
			],
			"acceptable-use": [
				{ version: "1.0", effectiveDate: "2026-10-17", material: false },
			],
			privacy: [
				{ version: "1.1", effectiveDate: "2026-11-18", material: false },
				{ version: "1.0", effectiveDate: "2026-10-17", material: false },
			],
		});

/** The version of each sign-up document a person accepts or is shown: `{ terms: "2.0", … }`. */
export type LegalVersionStamp = Record<SignupLegalSlug, string>;

/** Today in UTC, `YYYY-MM-DD` — the day `org.fn_current_legal_version` counts in. */
export function utcToday(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * The version of `slug` in effect on `today`: the newest whose effective date has arrived, else the
 * oldest (the one that takes effect first), as the `/legal` pages and the database resolve it.
 */
export function currentLegalVersion(slug: SignupLegalSlug, today: string = utcToday()): string {
	const versions = LEGAL_VERSIONS[slug];
	const current = versions.find((v) => v.effectiveDate <= today) ?? versions[versions.length - 1];
	if (!current) throw new Error(`legal manifest: "${slug}" has no version`);
	return current.version;
}

/** The stamp the join and re-accept doors send: every sign-up document at today's version. */
export function currentLegalVersions(today: string = utcToday()): LegalVersionStamp {
	return {
		terms: currentLegalVersion("terms", today),
		"acceptable-use": currentLegalVersion("acceptable-use", today),
		privacy: currentLegalVersion("privacy", today),
	};
}
// #endregion
