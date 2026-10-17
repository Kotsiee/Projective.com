import type { JSX } from "preact";
import { useContext } from "preact/hooks";
import {
	type AnchoredNode,
	type AnchorRegistry,
	CALLOUT_TONE_LABEL,
	type CalloutNode,
	type ContentNode,
	createAnchorRegistry,
	type ListItem,
	type ListNode,
	RESERVED_ANCHOR_IDS,
	type SimpleBlock,
	slugify,
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
	 * The blocks to render. Anchored nodes (from `anchorDoc`) carry their `h3` ids; a bare node list
	 * gets ids slugified and de-duplicated within this one render.
	 */
	nodes: readonly (ContentNode | AnchoredNode)[];
}
// #endregion

// #region Blocks
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

/** An ordered or unordered list, recursively. */
function renderList(list: ListNode, key?: number): JSX.Element {
	const items = list.items.map(renderItem);
	return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

/** A table: header row of column headers, body rows (first cell a row header when asked). */
function renderTable(table: TableNode, key: number): JSX.Element {
	return (
		<div
			key={key}
			class="ui-prose__table"
			role="region"
			tabIndex={0}
			aria-label={table.caption ?? "Table"}
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

/** One block. `ids` resolves an `h3` that arrived without one. */
function renderNode(
	node: ContentNode | AnchoredNode,
	key: number,
	glyphs: EditorialGlyphs,
	ids: () => AnchorRegistry,
): JSX.Element {
	switch (node.type) {
		case "p":
			return (
				<p key={key}>
					<InlineContent content={node.content} />
				</p>
			);
		case "h3":
			return (
				<AnchorHeading
					key={key}
					level={3}
					id={node.id ?? ids().claim(slugify(node.text))}
					number={"number" in node ? node.number : undefined}
				>
					{node.text}
				</AnchorHeading>
			);
		case "list":
			return renderList(node, key);
		case "quote":
			return (
				<blockquote key={key} class="ui-prose__quote">
					<p>
						<InlineContent content={node.content} />
					</p>
					{node.cite ? <cite class="ui-prose__cite">{node.cite}</cite> : null}
				</blockquote>
			);
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
	}
}
// #endregion

/**
 * ContentRenderer — maps the editorial AST (`@projective/types/content`) to semantic HTML, one node
 * to one element: `p` → `<p>`, `h3` → an {@link AnchorHeading}, `list` → `<ul>`/`<ol>` (nesting),
 * `quote` → `<blockquote>` + `<cite>`, `code` → `<pre><code>`, `image` → `<figure>` with intrinsic
 * `width`/`height` (no layout shift) and lazy decoding, `callout` → `role="note"` with its tone word,
 * `table` → a captioned `<table>` with scoped headers inside a keyboard-scrollable region.
 *
 * There is no `dangerouslySetInnerHTML` and no markdown parser: every string is a text child. Render
 * it inside a {@link Prose} (DocumentBody does). Zero-JS and stylesheet-free (prose.css via the
 * editorial aggregate), so the contract is unit-testable.
 */
export function ContentRenderer({ nodes }: ContentRendererProps): JSX.Element {
	const glyphs = useContext(EditorialGlyphContext);
	let registry: AnchorRegistry | null = null;
	// Only a bare node list needs one; explicit ids are seeded first so a generated id never takes one.
	const ids = () =>
		registry ??= createAnchorRegistry([
			...RESERVED_ANCHOR_IDS,
			...nodes.flatMap((node) => node.type === "h3" && node.id ? [node.id] : []),
		]);
	return <>{nodes.map((node, i) => renderNode(node, i, glyphs, ids))}</>;
}
