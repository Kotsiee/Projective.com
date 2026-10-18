import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import {
	type AnchoredNode,
	anchorNodes,
	type AnchorRegistry,
	CALLOUT_TONE_LABEL,
	type CalloutNode,
	type ContentNode,
	type DefinitionListNode,
	type ListItem,
	type ListMarker,
	type ListNode,
	type QuoteNode,
	type SimpleBlock,
	type TableNode,
} from "@projective/types/content";
import { cx } from "../../core/cx.ts";
import { EditorialGlyphContext, type EditorialGlyphs } from "../core/editorial-glyphs.ts";
import { AnchorHeading } from "./AnchorHeading.tsx";
import { InlineContent } from "./InlineContent.tsx";

// #region Props
/** Props for {@link ContentRenderer}. */
export interface ContentRendererProps {
	/**
	 * The blocks to render. Anchored nodes (from `anchorDoc` / `anchorNodes`) carry their `h3` ids; a
	 * bare node list is anchored here — explicit ids kept, the rest slugified and de-duplicated.
	 */
	nodes: readonly (ContentNode | AnchoredNode)[];
	/**
	 * The registry a bare list's `h3` ids are claimed from. Omitted, the list is de-duplicated on its
	 * own. A page that renders several bodies (a changelog feed) passes ONE registry to every
	 * renderer so two entries' "Fixes" headings never share an id; a registry is consumed by
	 * rendering, so create one per page render (`createAnchorRegistry`).
	 */
	registry?: AnchorRegistry;
}
// #endregion

// #region Blocks
/** The `<ol type>` each list marker style is. */
const OL_TYPE: Readonly<Record<ListMarker, "1" | "a" | "i">> = {
	decimal: "1",
	"lower-alpha": "a",
	"lower-roman": "i",
};

/** A list item: its inline content, then its nested list. */
function renderItem(item: ListItem, key: number): JSX.Element {
	if (typeof item === "string") return <li key={key}>{item}</li>;
	return (
		<li key={key}>
			<InlineContent content={item.content} />
			{item.list ? renderList(item.list) : null}
		</li>
	);
}

/** An ordered or unordered list, recursively; an ordered list's `marker` is its `type`. */
function renderList(list: ListNode, key?: number): JSX.Element {
	const items = list.items.map(renderItem);
	return list.ordered
		? <ol key={key} type={list.marker ? OL_TYPE[list.marker] : undefined}>{items}</ol>
		: <ul key={key}>{items}</ul>;
}

/**
 * A table: header row of column headers, body rows (first cell a row header when asked). The
 * wrapper is keyboard-scrollable (`tabIndex=0`, so a wide table can be panned without a pointer);
 * only a CAPTIONED table is also a named `region` landmark — uncaptioned ones would all be called
 * "Table" and flood the landmark list, as un-named sections would (DocumentBody).
 */
function renderTable(table: TableNode, key: number): JSX.Element {
	return (
		<div
			key={key}
			class="ui-prose__table"
			role={table.caption ? "region" : undefined}
			aria-label={table.caption}
			tabIndex={0}
		>
			<table>
				{table.caption ? <caption>{table.caption}</caption> : null}
				<thead>
					<tr>
						{table.head.map((cell, i) => (
							<th key={i} scope="col">
								<InlineContent content={cell} />
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{table.rows.map((row, r) => (
						<tr key={r}>
							{row.map((cell, i) =>
								i === 0 && table.rowHeaders
									? (
										<th key={i} scope="row">
											<InlineContent content={cell} />
										</th>
									)
									: (
										<td key={i}>
											<InlineContent content={cell} />
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

/**
 * A quotation. With an attribution it is a `<figure>`: the words in the `<blockquote>`, the person in
 * the `<figcaption>` beside it — never a `<cite>` inside the quote, which would make the attribution
 * part of the quoted text (and `<cite>` names a work, not a person).
 */
function renderQuote(node: QuoteNode, key: number): JSX.Element {
	const words = (
		<p>
			<InlineContent content={node.content} />
		</p>
	);
	if (!node.cite) return <blockquote key={key} class="ui-prose__quote">{words}</blockquote>;
	return (
		<figure key={key} class="ui-prose__quote">
			<blockquote class="ui-prose__quote-body">{words}</blockquote>
			<figcaption class="ui-prose__cite">{node.cite}</figcaption>
		</figure>
	);
}

/** A definition list: each term a `<dt>`, its definition the `<dd>` after it. */
function renderDefinitions(node: DefinitionListNode, key: number): JSX.Element {
	return (
		<dl key={key} class="ui-prose__dl">
			{node.items.map((item, i) => (
				<div key={i} class="ui-prose__dl-item">
					<dt>{item.term}</dt>
					<dd>
						<InlineContent content={item.definition} />
					</dd>
				</div>
			))}
		</dl>
	);
}

/** A paragraph or a list — the blocks a callout body holds. */
function renderSimple(block: SimpleBlock, key: number): JSX.Element {
	return block.type === "p"
		? (
			<p key={key}>
				<InlineContent content={block.content} />
			</p>
		)
		: renderList(block, key);
}

/** A callout: `role="note"`, the tone WORD always shown (hue alone never carries it), then the body. */
function renderCallout(node: CalloutNode, key: number, glyphs: EditorialGlyphs): JSX.Element {
	const glyph = glyphs.callout?.[node.tone];
	return (
		<div key={key} class={cx("ui-callout", `ui-callout--${node.tone}`)} role="note">
			<p class="ui-callout__title">
				{glyph ? <span class="ui-callout__glyph" aria-hidden="true">{glyph()}</span> : null}
				<span>{CALLOUT_TONE_LABEL[node.tone]}</span>
				{node.title
					? (
						<>
							<span class="ui-callout__sep" aria-hidden="true">·</span>
							<span>{node.title}</span>
						</>
					)
					: null}
			</p>
			<div class="ui-callout__body">{node.body.map(renderSimple)}</div>
		</div>
	);
}

/** One anchored block. */
function renderNode(node: AnchoredNode, key: number, glyphs: EditorialGlyphs): JSX.Element {
	switch (node.type) {
		case "p":
			return (
				<p key={key}>
					<InlineContent content={node.content} />
				</p>
			);
		case "h3":
			return (
				<AnchorHeading key={key} level={3} id={node.id} number={node.number}>
					{node.text}
				</AnchorHeading>
			);
		case "list":
			return renderList(node, key);
		case "quote":
			return renderQuote(node, key);
		case "code":
			return (
				<pre key={key} class="ui-prose__pre" data-lang={node.lang} tabIndex={0}>
					<code class={node.lang ? `language-${node.lang}` : undefined}>{node.text}</code>
				</pre>
			);
		case "image":
			return (
				<figure key={key} class="ui-prose__figure">
					<img
						class="ui-prose__img"
						src={node.src}
						alt={node.alt}
						width={node.w}
						height={node.h}
						loading="lazy"
						decoding="async"
					/>
					{node.caption ? <figcaption class="ui-prose__caption">{node.caption}</figcaption> : null}
				</figure>
			);
		case "callout":
			return renderCallout(node, key, glyphs);
		case "table":
			return renderTable(node, key);
		case "dl":
			return renderDefinitions(node, key);
	}
}
// #endregion

/**
 * ContentRenderer — maps the editorial AST (`@projective/types/content`) to semantic HTML, one node
 * to one element: `p` → `<p>`, `h3` → an {@link AnchorHeading}, `list` → `<ul>`/`<ol>` (nesting; an
 * ordered list's marker style is its `type`), `quote` → `<blockquote>` (in a `<figure>` with a
 * `<figcaption>` attribution), `code` → `<pre><code>`, `image` → `<figure>` with intrinsic
 * `width`/`height` (no layout shift) and lazy decoding, `callout` → `role="note"` with its tone word,
 * `table` → a `<table>` with scoped headers inside a keyboard-scrollable wrapper (a named region
 * when captioned), `dl` → `<dl>` of `<dt>`/`<dd>` pairs. Inline runs render `<strong>`, `<em>`,
 * `<code>`, `<kbd>` and `<a>`.
 *
 * There is no `dangerouslySetInnerHTML` and no markdown parser: every string is a text child. Render
 * it inside a {@link Prose} (DocumentBody does). Zero-JS and stylesheet-free (prose.css via the
 * editorial aggregate), so the contract is unit-testable.
 */
export function ContentRenderer({ nodes, registry }: ContentRendererProps): JSX.Element {
	const glyphs = useContext(EditorialGlyphContext);
	const anchored = anchorNodes(nodes, registry);
	return <>{anchored.map((node, i) => renderNode(node, i, glyphs))}</>;
}
