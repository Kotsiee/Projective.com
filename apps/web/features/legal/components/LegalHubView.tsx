import type { ComponentChildren, JSX } from "preact";
import type { LegalDoc } from "@projective/types/content";
import { DocumentDate } from "@projective/ui/display/editorial";
import { legalDocumentHref } from "../core/versions.ts";
import { LegalDraftNotice } from "./LegalDraftNotice.tsx";

// #region Props
/** One document as the hub lists it: its version in effect today. */
export interface LegalHubEntry {
	doc: LegalDoc;
}

/** One group of documents on the hub. */
export interface LegalHubGroup {
	id: string;
	label: string;
	entries: LegalHubEntry[];
}

/** Props for {@link LegalHubView}. */
export interface LegalHubViewProps {
	groups: LegalHubGroup[];
	/** Show the library-wide draft disclosure (while any listed version is unreviewed). */
	draft: boolean;
	/** A zero-UI island that carries `legal.css` (the hub mounts no other island). */
	styleAnchor?: ComponentChildren;
}
// #endregion

/**
 * A Meta-register facts line: items as siblings, `aria-hidden` middots between them (§B.11.2). Every
 * item opens with its separator and the wrapper clips the one that would start a line, so a line
 * that wraps on a phone never begins with a middot (legal.css, "Non-actionable facts").
 */
function Facts({ items }: { items: ComponentChildren[] }): JSX.Element {
	return (
		<div class="lgl-facts">
			<ul class="lgl-facts__list">
				{items.map((item, i) => (
					<li key={i} class="lgl-facts__item">
						<span class="lgl-facts__sep" aria-hidden="true">·</span>
						{item}
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * LegalHubView — `/legal` (Decision #270): the display title, a one-paragraph introduction and the
 * draft disclosure, then every legal document in two groups as a plain list — never cards. Each row
 * is its document's title (the link, stretched over the row), its one-line summary and its facts in
 * the Meta register: version, effective date, last update. A side note sends legal questions to
 * the contact form. Server-rendered and zero-JS; its sheet rides `styleAnchor`.
 */
export function LegalHubView({ groups, draft, styleAnchor }: LegalHubViewProps): JSX.Element {
	return (
		<div class="lgl-hub">
			{styleAnchor}
			<div class="lgl-hub__inner">
				<header class="lgl-hub__header">
					<p class="lgl-hub__eyebrow">Projective</p>
					<h1 class="lgl-hub__title" id="legal-title">Legal</h1>
					<p class="lgl-hub__intro">
						The agreements and policies that govern Projective, written to match how the platform
						actually works. Every clause opens with a plain-English summary, and every earlier
						version stays here to read and compare.
					</p>
					{draft ? <LegalDraftNotice id="lgl-hub-draft-title" scope="library" /> : null}
				</header>
				<nav class="lgl-hub__docs" aria-label="Legal documents">
					{groups.map((group) => (
						<section key={group.id} class="lgl-hub__group">
							<h2 class="lgl-hub__group-title" id={`legal-group-${group.id}`}>{group.label}</h2>
							<ul class="lgl-hub__list" role="list">
								{group.entries.map(({ doc }) => (
									<li key={doc.slug} class="lgl-hub__row">
										<h3 class="lgl-hub__name">
											<a class="lgl-hub__link" href={legalDocumentHref(doc.slug)}>{doc.title}</a>
										</h3>
										<p class="lgl-hub__summary">{doc.summary}</p>
										<Facts
											items={[
												`Version ${doc.version}`,
												<DocumentDate key="effective" prefix="Effective" iso={doc.effectiveDate} />,
												<DocumentDate key="updated" prefix="Updated" iso={doc.updatedAt} />,
												doc.reviewedAt ? "Reviewed" : "Draft",
											]}
										/>
									</li>
								))}
							</ul>
						</section>
					))}
				</nav>
				<aside class="lgl-hub__aside" aria-labelledby="legal-questions-title">
					<h2 class="lgl-hub__aside-title" id="legal-questions-title">Questions</h2>
					<p>
						If something here is unclear, or you want to exercise a right these documents describe,
						{" "}
						<a class="lgl-link" href="/contact?intent=support">contact us</a>.
					</p>
					<p>
						Each document lists its versions; you can read any of them and compare two clause by
						clause.
					</p>
				</aside>
			</div>
		</div>
	);
}
