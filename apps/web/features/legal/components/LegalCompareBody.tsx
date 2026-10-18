import type { ComponentChildren, JSX } from "preact";
import type {
	AnchoredSection,
	InlineContent as InlineContentValue,
} from "@projective/types/content";
import {
	AnchorHeading,
	ContentRenderer,
	InlineContent,
	Prose,
} from "@projective/ui/display/editorial";
import {
	type BlockDiff,
	type CellDiff,
	type ClauseDiff,
	clauseRuns,
	type DiffSpan,
	type DocumentDiff,
	spell,
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

/** Inserted text: underlined and tinted, announced as "Added:". */
function Ins({ gap, children }: { gap?: boolean; children: ComponentChildren }): JSX.Element {
	return (
		<ins class={gap ? "lgl-diff__ins lgl-diff__ins--gap" : "lgl-diff__ins"}>
			<span class="ui-visually-hidden">{ADDED_LABEL}</span>
			{children}
		</ins>
	);
}

/** Deleted text: struck through and tinted, announced as "Removed:". */
function Del({ children }: { children: ComponentChildren }): JSX.Element {
	return (
		<del class="lgl-diff__del">
			<span class="ui-visually-hidden">{REMOVED_LABEL}</span>
			{children}
		</del>
	);
}

/** A word diff as text runs: inserted words in `<ins>`, deleted ones in `<del>`, each announced. */
function Spans({ spans }: { spans: readonly DiffSpan[] }): JSX.Element {
	return (
		<>
			{spans.map((span, i) => {
				if (span.op === "insert") return <Ins key={i} gap={span.gap}>{span.text}</Ins>;
				if (span.op === "delete") return <Del key={i}>{span.text}</Del>;
				return span.text;
			})}
		</>
	);
}

/**
 * A unit's text: its authored content (links and code kept) when it did not change word by word —
 * plain when unchanged, wrapped whole in `<ins>` / `<del>` when added or removed — otherwise its
 * word diff.
 */
function Text(
	{ spans, content }: { spans: readonly DiffSpan[]; content?: InlineContentValue },
): JSX.Element {
	if (content === undefined || spans.length > 1) return <Spans spans={spans} />;
	const authored = <InlineContent content={content} />;
	const op = spans[0]?.op ?? "equal";
	if (op === "insert") return <Ins>{authored}</Ins>;
	if (op === "delete") return <Del>{authored}</Del>;
	return authored;
}
// #endregion

// #region Tables
/** One cell of a compared row. */
function Cell({ cell }: { cell: CellDiff }): JSX.Element {
	return <Text spans={cell.spans} content={cell.content} />;
}

/**
 * A run of compared table units drawn as the table it is — the document's own `ui-prose__table`:
 * the caption as `<caption>`, the header row as `<th scope="col">` cells, each body row's first cell
 * a `<th scope="row">` when the table has row headers. Every cell carries its own word diff.
 */
function DiffTable({ units }: { units: readonly BlockDiff[] }): JSX.Element {
	const caption = units.find((u) => u.table?.part === "caption");
	const head = units.filter((u) => u.table?.part === "head");
	const body = units.filter((u) => u.table?.part === "body");
	const label = caption
		? spell(caption.spans, caption.status === "removed" ? "before" : "after")
		: undefined;
	return (
		<div
			class="ui-prose__table"
			role={label ? "region" : undefined}
			aria-label={label}
			tabIndex={0}
		>
			<table>
				{caption?.table
					? <caption>{caption.table.cells.map((c, i) => <Cell key={i} cell={c} />)}</caption>
					: null}
				{head.length > 0
					? (
						<thead>
							{head.map((row, r) => (
								<tr key={r}>
									{row.table!.cells.map((cell, i) => (
										<th key={i} scope="col">
											<Cell cell={cell} />
										</th>
									))}
								</tr>
							))}
						</thead>
					)
					: null}
				<tbody>
					{body.map((row, r) => (
						<tr key={r}>
							{row.table!.cells.map((cell, i) =>
								i === 0 && row.table!.rowHeaders
									? (
										<th key={i} scope="row">
											<Cell cell={cell} />
										</th>
									)
									: (
										<td key={i}>
											<Cell cell={cell} />
										</td>
									)
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
// #endregion

// #region Blocks
/** One aligned unit in the element its kind is drawn as. */
function Block({ block, tldrLabel }: { block: BlockDiff; tldrLabel: string }): JSX.Element {
	const text = <Text spans={block.spans} content={block.content} />;
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
		default:
			return <p>{text}</p>;
	}
}

/**
 * A clause's blocks: consecutive list items gathered into one list, consecutive table units into one
 * table (a caption, or a header row after body rows, starts the next table).
 */
function Blocks(
	{ blocks, tldrLabel }: { blocks: readonly BlockDiff[]; tldrLabel: string },
): JSX.Element {
	const out: ComponentChildren[] = [];
	let items: BlockDiff[] = [];
	let rows: BlockDiff[] = [];
	const flushItems = () => {
		if (items.length === 0) return;
		out.push(
			<ul key={`list-${out.length}`} class="lgl-diff__list">
				{items.map((item, i) => (
					<li
						key={i}
						class={item.depth > 0 ? `lgl-diff__item--depth-${Math.min(item.depth, 2)}` : undefined}
					>
						<Text spans={item.spans} content={item.content} />
					</li>
				))}
			</ul>,
		);
		items = [];
	};
	const flushRows = () => {
		if (rows.length === 0) return;
		out.push(<DiffTable key={`table-${out.length}`} units={rows} />);
		rows = [];
	};
	blocks.forEach((block, i) => {
		if (block.table) {
			flushItems();
			const part = block.table.part;
			const startsNext = part === "caption" ||
				(part === "head" && rows.some((r) => r.table?.part === "body"));
			if (startsNext) flushRows();
			rows.push(block);
			return;
		}
		flushRows();
		if (block.kind === "item") {
			items.push(block);
			return;
		}
		flushItems();
		out.push(<Block key={i} block={block} tldrLabel={tldrLabel} />);
	});
	flushItems();
	flushRows();
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
 * words in `<ins>`, removed in `<del>`, each with visually hidden "Added" / "Removed" text; a table
 * drawn as the table it is, cell by cell; a unit that did not change word by word in its authored
 * form, links kept — and every run of unchanged clauses folded behind one native `<details>`
 * ("Show 3 unchanged clauses"), rendered exactly as the document renders them. Server-rendered,
 * zero-JS.
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
