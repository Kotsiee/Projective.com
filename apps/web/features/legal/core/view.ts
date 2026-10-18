/**
 * What a `/legal/<slug>` request shows — resolved once, purely, from the slug, the query and today's
 * date (Decision #270). The page handler and the PDF handler are thin over these.
 *
 * Normalisation rules (the URL contract is in `versions.ts`):
 *
 * - an unknown or reserved slug, an unknown `v` or an unknown `compare` is a 404 — versions are never
 *   removed, so a version that does not exist is a typo, not an old link;
 * - a parameter sent EMPTY (`?compare=`, what a no-JavaScript form submits for "don't compare") is
 *   dropped with a `303` to the clean address;
 * - `compare` equal to the shown version is dropped; `compare` NEWER than the shown version is
 *   swapped (`?v=<newer>&compare=<older>`), so a diff always reads from older to newer;
 * - `v` naming the current version is kept: a pinned link means "this version", and must keep
 *   showing it after a newer one takes effect.
 *
 * A page is `noindex` while its version is a draft (owner ruling (e)), and always when it is pinned
 * or comparing — the canonical address is the bare `/legal/<slug>`.
 *
 * @module
 */
import type { LegalDoc, TocEntry } from "@projective/types/content";
import { diffDocuments, type DocumentDiff } from "./diff.ts";
import {
	currentVersion,
	familyStatuses,
	LEGAL_LIBRARY,
	type LegalFamily,
	legalFamily,
	versionOf,
} from "./registry.ts";
import { compareVersions, legalDocumentHref, type LegalVersionSummary } from "./versions.ts";

// #region Document request
/** Everything the document page renders. */
export interface LegalDocumentView {
	family: LegalFamily;
	/** The version shown. */
	doc: LegalDoc;
	/** The version in effect today. */
	current: LegalDoc;
	/** Every version's status, newest first. */
	statuses: LegalVersionSummary[];
	/** The shown version's status. */
	shown: LegalVersionSummary;
	/** The older version the shown one is compared against, when comparing. */
	compare: LegalDoc | null;
	/** The clause diff from `compare` to `doc`, when comparing. */
	diff: DocumentDiff | null;
	/** The request named a version (`?v=`). */
	pinned: boolean;
	/** The shown version has not been reviewed by a lawyer. */
	draft: boolean;
	/** Keep the page out of search indexes. */
	noindex: boolean;
}

/** The outcome of resolving a document request. */
export type LegalDocumentRequest =
	| { kind: "not-found" }
	| { kind: "redirect"; location: string }
	| { kind: "document"; view: LegalDocumentView };

/**
 * Resolve `/legal/<slug>?…` on `today` (`YYYY-MM-DD`) — see the module header for every rule.
 */
export function resolveLegalDocument(
	slug: string,
	params: URLSearchParams,
	today: string,
): LegalDocumentRequest {
	const family = legalFamily(slug);
	if (!family) return { kind: "not-found" };

	const rawV = params.get("v");
	const rawCompare = params.get("compare");
	if ((params.has("v") && !rawV) || (params.has("compare") && !rawCompare)) {
		return {
			kind: "redirect",
			location: legalDocumentHref(slug, { v: rawV, compare: rawCompare }),
		};
	}

	const current = currentVersion(family, today);
	const doc = rawV ? versionOf(family, rawV) : current;
	if (!doc) return { kind: "not-found" };
	const other = rawCompare ? versionOf(family, rawCompare) ?? null : null;
	if (rawCompare && !other) return { kind: "not-found" };

	if (other) {
		const order = compareVersions(other.version, doc.version);
		if (order === 0) {
			return { kind: "redirect", location: legalDocumentHref(slug, { v: rawV }) };
		}
		if (order > 0) {
			return {
				kind: "redirect",
				location: legalDocumentHref(slug, { v: other.version, compare: doc.version }),
			};
		}
	}

	const statuses = familyStatuses(family, today);
	const shown = statuses.find((s) => s.version === doc.version)!;
	const draft = doc.reviewedAt === null;
	return {
		kind: "document",
		view: {
			family,
			doc,
			current,
			statuses,
			shown,
			compare: other,
			diff: other ? diffDocuments(other, doc) : null,
			pinned: rawV !== null,
			draft,
			noindex: draft || rawV !== null || other !== null,
		},
	};
}
// #endregion

// #region PDF request
/** The outcome of resolving `/legal/<slug>/pdf?…`. */
export type LegalPdfRequest =
	| { kind: "not-found" }
	| { kind: "pdf"; doc: LegalDoc; current: boolean };

/** Resolve a PDF request: the pinned version (`?v=`) or the current one. `compare` is ignored. */
export function resolveLegalPdf(
	slug: string,
	params: URLSearchParams,
	today: string,
): LegalPdfRequest {
	const family = legalFamily(slug);
	if (!family) return { kind: "not-found" };
	const current = currentVersion(family, today);
	const rawV = params.get("v");
	const doc = rawV ? versionOf(family, rawV) : current;
	if (!doc) return { kind: "not-found" };
	return { kind: "pdf", doc, current: doc.version === current.version };
}
// #endregion

// #region Document rail
/** The rail id of a document entry — never a section id (pinned by the registry test). */
export function legalRailId(slug: string): string {
	return `legal-${slug}`;
}

/**
 * The "Legal documents" rail: every document as a link (its current title), the one being read
 * marked current and expanded into `children` — its sections, or, when comparing, its changed
 * clauses.
 */
export function legalRailEntries(
	slug: string,
	children: TocEntry[],
	today: string,
): TocEntry[] {
	return LEGAL_LIBRARY.map((family) => {
		const current = family.slug === slug;
		return {
			id: legalRailId(family.slug),
			text: currentVersion(family, today).title,
			level: 2,
			href: legalDocumentHref(family.slug),
			current,
			children: current ? children : [],
		};
	});
}

/**
 * The number column of a removed clause in the compare rail: it has no number in the version shown,
 * and its old number would collide with the clause that now holds it, so it shows a dash — which keeps
 * its title on the same text column as the numbered entries around it.
 */
export const REMOVED_CLAUSE_NUMBER = "–";

/** The rail children of a compared document: each clause that changed, was added or was removed. */
export function changedClauseEntries(diff: DocumentDiff): TocEntry[] {
	return diff.clauses
		.filter((clause) => clause.status !== "unchanged")
		.map((clause) => ({
			id: clause.id,
			text: clause.heading,
			level: 2,
			number: clause.numberAfter ?? REMOVED_CLAUSE_NUMBER,
			children: [],
		}));
}
// #endregion
