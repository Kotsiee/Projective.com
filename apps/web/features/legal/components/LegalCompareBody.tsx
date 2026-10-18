import type { ComponentChildren, JSX } from "preact";
import type { AnchoredSection } from "@projective/types/content";
import {
	AnchorHeading,
	ContentRenderer,
	InlineContent,
	Prose,
} from "@projective/ui/display/editorial";
import {
	type BlockDiff,
	type ClauseDiff,
	clauseRuns,
	type DiffSpan,
	type DocumentDiff,
} from "../core/diff.ts";

// #region Props
/** Props for {@link LegalCompareBody}. */
export interface LegalCompareBodyProps {
	/** The clause diff from the older version to the shown one. */
	diff: DocumentDiff;
	/** The shown version's sections, anchored once with clause numbers (for the folded clauses). */
	sections: readonly AnchoredSection[];
	/** The label above each clause's summary. */
	tldrLabel: string;
}
// #endregion

// #region Spans
/** What a screen reader hears before inserted and deleted words (the trailing space is spoken text). */
const ADDED_LABEL = "Added: ";
const REMOVED_LABEL = "Removed: ";

/** A word diff as text runs: inserted words in `<ins>`, deleted ones in `<del>`, each announced. */
function Spans({ spans }: { spans: readonly DiffSpan[] }): JSX.Element {
	return (
		<>
			{spans.map((span, i) => {
				if (span.op === "insert") {
					return (
						<ins key={i} class="lgl-diff__ins">
							<span class="ui-visually-hidden">{ADDED_LABEL}</span>
							{span.text}
						</ins>
					);
				}
				if (span.op === "delete") {
					return (
						<del key={i} class="lgl-diff__del">
							<span class="ui-visually-hidden">{REMOVED_LABEL}</span>
							{span.text}
						</del>
					);
				}
				return span.text;
			})}
		</>
	);
}
// #endregion

// #region Blocks
/** One aligned unit in the element its kind is drawn as. */
function Block({ block, tldrLabel }: { block: BlockDiff; tldrLabel: string }): JSX.Element {
	const text = <Spans spans={block.spans} />;
	switch (block.kind) {
		case "summary":
			return (
				<p class="ui-doc-section__tldr">
					<span class="ui-doc-section__tldr-label">{tldrLabel}</span>
					{text}
				</p>
			);
		case "subheading":
			return <h3 class="lgl-diff__h3">{text}</h3>;
		case "quote":
			return (
				<blockquote class="ui-prose__quote">
					<p>{text}</p>
				</blockquote>
			);
		case "code":
			return <pre class="lgl-diff__code">{text}</pre>;
		case "row":
			return <p class="lgl-diff__row">{text}</p>;
		default:
			return <p>{text}</p>;
	}
}

/** A clause's blocks, consecutive list items gathered into one list. */
function Blocks(
	{ blocks, tldrLabel }: { blocks: readonly BlockDiff[]; tldrLabel: string },
): JSX.Element {
	const out: ComponentChildren[] = [];
	let items: BlockDiff[] = [];
	const flushItems = () => {
		if (items.length === 0) return;
		out.push(
			<ul key={`list-${out.length}`} class="lgl-diff__list">
				{items.map((item, i) => (
					<li
						key={i}
						class={item.depth > 0 ? `lgl-diff__item--depth-${Math.min(item.depth, 2)}` : undefined}
					>
						<Spans spans={item.spans} />
					</li>
				))}
			</ul>,
		);
		items = [];
	};
	blocks.forEach((block, i) => {
		if (block.kind === "item") {
			items.push(block);
			return;
		}
		flushItems();
		out.push(<Block key={i} block={block} tldrLabel={tldrLabel} />);
	});
	flushItems();
	return <>{out}</>;
}
// #endregion

// #region Clauses
/** The words under a compared clause's heading: what happened to it, and in which version. */
function changeNote(clause: ClauseDiff, diff: DocumentDiff): string {
	switch (clause.status) {
		case "added":
			return `Added in version ${diff.to}`;
		case "removed":
			return `Removed in version ${diff.to} (was clause ${clause.numberBefore})`;
		default:
			return clause.numberBefore && clause.numberBefore !== clause.numberAfter
				? `Changed in version ${diff.to} (was clause ${clause.numberBefore})`
				: `Changed in version ${diff.to}`;
	}
}

/** A clause that changed, was added or was removed — in full, with its diff. */
function ComparedClause(
	{ clause, diff, tldrLabel }: { clause: ClauseDiff; diff: DocumentDiff; tldrLabel: string },
): JSX.Element {
	const noteId = `${clause.id}-change`;
	return (
		<section class={`ui-doc-section lgl-clause lgl-clause--${clause.status}`}>
			<div class="lgl-clause__marked">
				<AnchorHeading level={2} id={clause.id} number={clause.numberAfter}>
					<Spans spans={clause.headingSpans} />
				</AnchorHeading>
				<p class="lgl-clause__change" id={noteId}>{changeNote(clause, diff)}</p>
				<div class="lgl-diff" role="group" aria-labelledby={clause.id} aria-describedby={noteId}>
					<Blocks blocks={clause.blocks} tldrLabel={tldrLabel} />
				</div>
			</div>
		</section>
	);
}

/** An unchanged clause exactly as the document renders it. */
function UnchangedClause(
	{ section, tldrLabel }: { section: AnchoredSection; tldrLabel: string },
): JSX.Element {
	return (
		<section class="ui-doc-section lgl-unchanged__clause">
			<AnchorHeading level={2} id={section.anchor} number={section.number}>
				{section.heading}
			</AnchorHeading>
			{section.tldr
				? (
					<p class="ui-doc-section__tldr">
						<span class="ui-doc-section__tldr-label">{tldrLabel}</span>
						<InlineContent content={section.tldr} />
					</p>
				)
				: null}
			<ContentRenderer nodes={section.body} />
		</section>
	);
}
// #endregion

/**
 * LegalCompareBody — the body of `/legal/<slug>?compare=<older>` (Decision #270): every clause that
 * changed, was added or was removed, in full with its word diff — a 2px bar in the gutter and a
 * "Changed in version 2.0" line that describes the clause's diff region (`aria-describedby`); added
 * words in `<ins>`, removed in `<del>`, each with visually hidden "Added" / "Removed" text — and
 * every run of unchanged clauses folded behind one native `<details>` ("Show 3 unchanged clauses"),
 * rendered exactly as the document renders them. Server-rendered, zero-JS.
 */
export function LegalCompareBody(
	{ diff, sections, tldrLabel }: LegalCompareBodyProps,
): JSX.Element {
	const byId = new Map(sections.map((section) => [section.anchor, section]));
	return (
		<Prose class="ui-doc-body ui-doc-body--numbered lgl-compare">
			{clauseRuns(diff.clauses).map((run) => {
				if (run.kind === "clause") {
					return (
						<ComparedClause
							key={run.clause.id}
							clause={run.clause}
							diff={diff}
							tldrLabel={tldrLabel}
						/>
					);
				}
				const count = run.clauses.length;
				const noun = count === 1 ? "clause" : "clauses";
				return (
					<details key={`same-${run.clauses[0].id}`} class="lgl-unchanged">
						<summary class="lgl-unchanged__summary">
							<span class="lgl-unchanged__show">Show {count} unchanged {noun}</span>
							<span class="lgl-unchanged__hide">Hide {count} unchanged {noun}</span>
						</summary>
						{run.clauses.map((clause) => {
							const section = byId.get(clause.id);
							return section
								? <UnchangedClause key={clause.id} section={section} tldrLabel={tldrLabel} />
								: null;
						})}
					</details>
				);
			})}
		</Prose>
	);
}
