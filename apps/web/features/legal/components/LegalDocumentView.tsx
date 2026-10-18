import type { ComponentType, JSX } from "preact";
import { anchorDoc, docToc, formatContentDate, readingMinutes } from "@projective/types/content";
import {
	DocumentBody,
	DocumentHeader,
	DocumentLayout,
	type DocumentMetaFact,
	EditorialGlyphContext,
} from "@projective/ui/display/editorial";
import {
	type DocumentIslands,
	STATIC_DOCUMENT_ISLANDS,
} from "@features/marketing/components/DocumentPageView.tsx";
import type { LegalVersionControlsProps } from "../types/controls.ts";
import type { DocumentDiff } from "../core/diff.ts";
import { changedClauseEntries, type LegalDocumentView, legalRailEntries } from "../core/view.ts";
import { LEGAL_HUB_HREF, legalDocumentHref, type LegalVersionSummary } from "../core/versions.ts";
import { LegalCompareBody } from "./LegalCompareBody.tsx";
import { LegalDate } from "./LegalDate.tsx";
import { LegalDraftNotice } from "./LegalDraftNotice.tsx";

// #region Islands
/**
 * The interactive parts a legal document mounts, injected so this composite imports no island (an
 * island imports CSS, which `deno test` cannot load): the editorial pair plus the version controls.
 */
export interface LegalIslands extends DocumentIslands {
	VersionControls: ComponentType<LegalVersionControlsProps>;
}

/** The page without JavaScript, for a render test: static TOC, no progress, a bare controls slot. */
export const STATIC_LEGAL_ISLANDS: LegalIslands = {
	...STATIC_DOCUMENT_ISLANDS,
	VersionControls: (props) => <div class="lgl-controls" data-static-controls={props.slug} />,
};
// #endregion

// #region Copy
/** The label above each clause's summary. */
export const LEGAL_TLDR_LABEL = "Plain-English summary";

/** The name of the document rail (it lists every legal document). */
export const LEGAL_TOC_LABEL = "Legal documents";

/** How a version reads in the version picker: `2.0 — current`, `1.0 — effective 1 August 2026`. */
export function versionOptionLabel(summary: LegalVersionSummary): string {
	switch (summary.status) {
		case "current":
			return `${summary.version} — current`;
		case "upcoming":
			return `${summary.version} — takes effect ${formatContentDate(summary.effectiveDate)}`;
		default:
			return `${summary.version} — effective ${formatContentDate(summary.effectiveDate)}`;
	}
}

/** `3 clauses changed, 1 added, 1 removed, 7 unchanged` — empty kinds left out. */
export function compareCounts(diff: DocumentDiff): string {
	const { changed, added, removed, unchanged } = diff.counts;
	const parts = [
		changed ? `${changed} ${changed === 1 ? "clause" : "clauses"} changed` : "",
		added ? `${added} added` : "",
		removed ? `${removed} removed` : "",
		unchanged ? `${unchanged} unchanged` : "",
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : "no differences";
}
// #endregion

// #region Notices
/** The lines under the header: the draft disclosure, then where this version stands. */
function Notices({ view }: { view: LegalDocumentView }): JSX.Element {
	const { doc, current, shown, diff, compare, family } = view;
	const slug = family.slug;
	const currentHref = legalDocumentHref(slug);
	const oldest = family.versions[family.versions.length - 1];
	return (
		<div class="lgl-notices">
			{view.draft ? <LegalDraftNotice /> : null}
			{shown.status === "superseded"
				? (
					<p class="lgl-notice">
						You are reading version {doc.version}, which was replaced by version {current.version}
						{" "}
						on{" "}
						<time dateTime={current.effectiveDate}>{formatContentDate(current.effectiveDate)}
						</time>. <a class="lgl-link" href={currentHref}>Read the current version</a>
					</p>
				)
				: null}
			{shown.status === "upcoming"
				? (
					<p class="lgl-notice">
						Version {doc.version} takes effect on{" "}
						<time dateTime={doc.effectiveDate}>{formatContentDate(doc.effectiveDate)}</time>. Until
						then, version {current.version} applies.{" "}
						<a class="lgl-link" href={currentHref}>Read the version in effect today</a>
					</p>
				)
				: null}
			{diff && compare
				? (
					<p class="lgl-notice">
						Showing what changed from version {compare.version} to version {doc.version}:{" "}
						{compareCounts(diff)}.{" "}
						<a
							class="lgl-link"
							href={legalDocumentHref(slug, { v: view.pinned ? doc.version : null })}
						>
							Stop comparing
						</a>
					</p>
				)
				: null}
			{!diff && doc.version !== oldest.version
				? (
					<p class="lgl-notice">
						What changed in version {doc.version}: {doc.changeSummary}
					</p>
				)
				: null}
		</div>
	);
}
// #endregion

// #region View
/** Props for {@link LegalDocumentViewComponent}. */
export interface LegalDocumentViewProps {
	/** The resolved request (`resolveLegalDocument`). */
	view: LegalDocumentView;
	/** Today (`YYYY-MM-DD`), the day the rail's titles and the version statuses are read on. */
	today: string;
	islands: LegalIslands;
}

/**
 * LegalDocumentViewComponent — one legal document, composed from the editorial primitives
 * (Decision #270): the reading-progress bar; the header (eyebrow "Legal", the title, the summary,
 * the version and its dates, then the draft disclosure and the version notices); the "Legal
 * documents" rail listing every document with this one expanded into its clauses — or, comparing,
 * into the clauses that changed; the body — the numbered clauses, each opening with its plain-English
 * summary, or the clause compare; the version controls in the meta rail; and a closing line.
 *
 * Every heading is anchored once (`anchorDoc`, numbered), so the rail and the headings agree on
 * every id. It renders no `<main>` and no SEO; the route does.
 */
export function LegalDocumentViewComponent(
	{ view, today, islands }: LegalDocumentViewProps,
): JSX.Element {
	const { doc, diff, family } = view;
	const { TableOfContents, ReadingProgress, VersionControls } = islands;
	const anchored = anchorDoc(doc, { numbered: true });
	const children = diff ? changedClauseEntries(diff) : docToc(anchored, { depth: 2 });
	const facts: DocumentMetaFact[] = [
		`Version ${doc.version}`,
		<LegalDate key="effective" prefix="Effective" iso={doc.effectiveDate} />,
		<LegalDate key="updated" prefix="Updated" iso={doc.updatedAt} />,
		doc.reviewedAt ? <LegalDate key="reviewed" prefix="Reviewed" iso={doc.reviewedAt} /> : null,
		`${readingMinutes(doc)} min read`,
	];
	const only = view.statuses.length === 1 ? view.statuses[0] : null;

	return (
		<EditorialGlyphContext.Provider value={islands.glyphs}>
			<DocumentLayout
				class="ui-doc--clauses"
				progress={<ReadingProgress />}
				header={
					<DocumentHeader eyebrow="Legal" title={doc.title} summary={doc.summary} meta={facts}>
						<Notices view={view} />
					</DocumentHeader>
				}
				toc={
					<TableOfContents
						entries={legalRailEntries(family.slug, children, today)}
						label={LEGAL_TOC_LABEL}
					/>
				}
				meta={
					<VersionControls
						slug={family.slug}
						versions={view.statuses.map((s) => ({
							version: s.version,
							label: versionOptionLabel(s),
							status: s.status,
						}))}
						shown={doc.version}
						current={view.current.version}
						compare={view.compare?.version ?? null}
						onlyVersionNote={only
							? `${only.version} · in effect since ${formatContentDate(only.effectiveDate)}`
							: undefined}
					/>
				}
				metaLabel="Versions and downloads"
				footer={
					<p class="lgl-doc-foot">
						Questions about this document?{" "}
						<a class="lgl-link" href="/contact?intent=support">Contact us</a>.{" "}
						<a class="lgl-link" href={LEGAL_HUB_HREF}>All legal documents</a>
					</p>
				}
			>
				{diff
					? (
						<LegalCompareBody
							diff={diff}
							sections={anchored.sections}
							tldrLabel={LEGAL_TLDR_LABEL}
						/>
					)
					: <DocumentBody doc={anchored} tldrLabel={LEGAL_TLDR_LABEL} />}
			</DocumentLayout>
		</EditorialGlyphContext.Provider>
	);
}
// #endregion
