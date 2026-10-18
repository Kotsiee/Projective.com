/**
 * The legal library — every legal document, every version, in the order the hub and the document
 * rail list them (Decision #270). SERVER-ONLY: it imports the content modules, which build schemas at
 * import time, so no island may import it (islands read `versions.ts`).
 *
 * @module
 */
import {
	isLegalSlug,
	LEGAL_DOCUMENT_SLUGS,
	type LegalDoc,
	type LegalSlug,
} from "@projective/types/content";
import { type LegalVersionSummary, versionStatuses } from "./versions.ts";
import { ACCEPTABLE_USE_VERSIONS } from "./content/acceptable-use.ts";
import { COOKIES_VERSIONS } from "./content/cookies.ts";
import { ESCROW_TERMS_VERSIONS } from "./content/escrow-terms.ts";
import { IP_TRANSFER_DEED_VERSIONS } from "./content/ip-transfer-deed.ts";
import { PRIVACY_VERSIONS } from "./content/privacy.ts";
import { TERMS_VERSIONS } from "./content/terms.ts";

// #region Library
/** One legal document: its slug and every version, newest first. */
export interface LegalFamily {
	slug: LegalSlug;
	versions: readonly LegalDoc[];
}

/** Every version of every document, keyed by slug. */
const VERSIONS: Readonly<Record<LegalSlug, readonly LegalDoc[]>> = {
	terms: TERMS_VERSIONS,
	privacy: PRIVACY_VERSIONS,
	cookies: COOKIES_VERSIONS,
	"acceptable-use": ACCEPTABLE_USE_VERSIONS,
	"escrow-terms": ESCROW_TERMS_VERSIONS,
	"ip-transfer-deed": IP_TRANSFER_DEED_VERSIONS,
};

/** The library, in {@link LEGAL_DOCUMENT_SLUGS} order. */
export const LEGAL_LIBRARY: readonly LegalFamily[] = LEGAL_DOCUMENT_SLUGS.map((slug) => ({
	slug,
	versions: VERSIONS[slug],
}));

/**
 * How the hub groups the documents: the ones that apply to everyone, and the ones that govern work
 * and money. Every slug is in exactly one group (pinned by the registry test).
 */
export const LEGAL_GROUPS: ReadonlyArray<
	{ id: string; label: string; slugs: readonly LegalSlug[] }
> = [
	{
		id: "everyone",
		label: "For everyone",
		slugs: ["terms", "privacy", "cookies", "acceptable-use"],
	},
	{ id: "work", label: "For work and payments", slugs: ["escrow-terms", "ip-transfer-deed"] },
];

/**
 * The document a path segment names, or `undefined` — for an unknown slug and for every reserved
 * segment (`workspace`), so a reserved word can never be served as a document.
 */
export function legalFamily(slug: string): LegalFamily | undefined {
	if (!isLegalSlug(slug)) return undefined;
	return LEGAL_LIBRARY.find((family) => family.slug === slug);
}
// #endregion

// #region Versions
/** Today's date in UTC (`YYYY-MM-DD`) — the day the "current" version is chosen on. */
export function legalToday(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** The status of each version of `family` on `today` (see `versionStatuses`). */
export function familyStatuses(family: LegalFamily, today: string): LegalVersionSummary[] {
	return versionStatuses(family.versions, today);
}

/** The version in effect on `today`. */
export function currentVersion(family: LegalFamily, today: string): LegalDoc {
	const statuses = familyStatuses(family, today);
	const index = statuses.findIndex((s) => s.status === "current");
	return family.versions[index];
}

/** One version of `family` by its label, or `undefined`. */
export function versionOf(family: LegalFamily, version: string): LegalDoc | undefined {
	return family.versions.find((doc) => doc.version === version);
}
// #endregion
