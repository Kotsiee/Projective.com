import type { JSX } from "preact";
import type { TocEntry } from "@projective/types/content";
import { cx } from "../../core/cx.ts";
import type { EditorialGlyphs } from "../core/editorial-glyphs.ts";
import { tocText } from "../core/scroll-spy.ts";

// #region TocList
/** Props for {@link TocList}. */
export interface TocListProps {
	/** The tree to list. */
	entries: readonly TocEntry[];
	/** The current section's id, marked `aria-current="location"`. */
	activeId?: string | null;
	/** `inline` for the rail and the disclosure; `sheet` for the bottom sheet's larger rows. */
	variant?: "inline" | "sheet";
	/** The root list's id. */
	id?: string;
	/**
	 * Called when an in-page link is activated. Omit it and the links are plain anchors (the browser
	 * scrolls, honouring the scroll margin, and writes the hash); the bottom sheet passes one so it can
	 * close before it scrolls. Cross-page entries (`href`) are never intercepted.
	 */
	onNavigate?: (id: string, event: MouseEvent) => void;
}

/**
 * One entry and its children. An in-page entry links to `#id` and is `aria-current="location"` while
 * its section is the one being read; a cross-page entry (`href`) links away, is never intercepted by
 * `onNavigate`, and is `aria-current="page"` when it is the document being read.
 *
 * The label is set twice in one grid cell: the visible text, and an `aria-hidden`, invisible copy at
 * the active weight. The cell is therefore always as tall as the heavier setting needs, so marking an
 * entry current (`--fw-medium`) never re-wraps it into an extra line and pushes the entries below —
 * a scroll-driven layout shift.
 */
function TocItem(
	{ entry, activeId, onNavigate }:
		& { entry: TocEntry }
		& Pick<TocListProps, "activeId" | "onNavigate">,
): JSX.Element {
	const external = entry.href !== undefined;
	const current = external
		? (entry.current ? "page" : undefined)
		: (entry.id === activeId ? "location" : undefined);
	return (
		<li class="ui-toc__item" data-level={entry.level}>
			<a
				class="ui-toc__link"
				href={entry.href ?? `#${entry.id}`}
				aria-current={current}
				onClick={onNavigate && !external ? (event) => onNavigate(entry.id, event) : undefined}
			>
				{entry.number ? <span class="ui-toc__num">{entry.number}</span> : null}
				<span class="ui-toc__text">
					<span class="ui-toc__text-ink">{entry.text}</span>
					<span class="ui-toc__text-reserve" aria-hidden="true">{entry.text}</span>
				</span>
			</a>
			{entry.children.length > 0
				? (
					<ol class="ui-toc__list ui-toc__list--nested" role="list">
						{entry.children.map((child) => (
							<TocItem key={child.id} entry={child} activeId={activeId} onNavigate={onNavigate} />
						))}
					</ol>
				)
				: null}
		</li>
	);
}

/**
 * TocList — the table of contents as nested ordered lists of links: in-page `#id` links, the current
 * section marked with `aria-current="location"`, and optionally cross-page entries (`TocEntry.href`),
 * the document being read marked `aria-current="page"` (a rail listing several documents, the
 * current one expanded into its sections). `role="list"` is explicit because the list is unstyled and
 * WebKit drops list semantics from a `list-style: none` list.
 */
export function TocList(
	{ entries, activeId = null, variant = "inline", id, onNavigate }: TocListProps,
): JSX.Element {
	return (
		<ol
			id={id}
			class={cx("ui-toc__list", "ui-toc__list--root", variant === "sheet" && "ui-toc__list--sheet")}
			role="list"
		>
			{entries.map((entry) => (
				<TocItem key={entry.id} entry={entry} activeId={activeId} onNavigate={onNavigate} />
			))}
		</ol>
	);
}
// #endregion

// #region TocNav
/** Props for {@link TocNav}. */
export interface TocNavProps {
	/** The tree to list (`docToc(anchorDoc(doc))`). */
	entries: readonly TocEntry[];
	/** The current section's id. */
	activeId?: string | null;
	/** The navigation's name and visible label (default "On this page"). */
	label?: string;
	/** The nav's id; the rail list and the sheet derive theirs from it (default `doc-toc`). */
	id?: string;
	/** Set once the island has hydrated: below `--bp-md` the sheet trigger replaces the disclosure. */
	enhanced?: boolean;
	/** Whether the bottom sheet is open (reflected on the trigger's `aria-expanded`). */
	sheetOpen?: boolean;
	/** Opens the bottom sheet. */
	onOpenSheet?: () => void;
	/** Decorative glyphs for the disclosure chevron and the sheet trigger. */
	glyphs?: Pick<EditorialGlyphs, "disclosure" | "sheet">;
}

/**
 * TocNav — the markup of "On this page": one `<nav aria-label>` holding the three presentations the
 * document frame chooses between by its width (toc.css) — the rail list (from `--bp-lg`), a native
 * `<details>` disclosure (`--bp-md` to `--bp-lg`, and the no-JavaScript fallback below `--bp-md`), and
 * the bottom-sheet trigger (below `--bp-md` once `enhanced`). The disclosure and the trigger share
 * one row geometry, so the swap on hydration moves nothing.
 *
 * Pure and stylesheet-free: the `TableOfContents` island owns the state (scroll-spy, the sheet) and
 * renders this, and a test can render it without a DOM.
 */
export function TocNav(props: TocNavProps): JSX.Element {
	const {
		entries,
		activeId = null,
		label = "On this page",
		id = "doc-toc",
		enhanced = false,
		sheetOpen = false,
		onOpenSheet,
		glyphs = {},
	} = props;
	const current = tocText(entries, activeId);
	return (
		<nav id={id} class="ui-toc" aria-label={label} data-enhanced={enhanced ? "" : undefined}>
			<div class="ui-toc__rail">
				<p class="ui-toc__title" aria-hidden="true">{label}</p>
				<TocList entries={entries} activeId={activeId} id={`${id}-list`} />
			</div>
			<details class="ui-toc__disclosure">
				<summary class="ui-toc__summary">
					<span class="ui-toc__label">{label}</span>
					{glyphs.disclosure
						? <span class="ui-toc__glyph" aria-hidden="true">{glyphs.disclosure()}</span>
						: null}
				</summary>
				<TocList entries={entries} activeId={activeId} />
			</details>
			<button
				type="button"
				class="ui-toc__sheet-trigger"
				aria-haspopup="dialog"
				aria-expanded={sheetOpen}
				onClick={onOpenSheet}
			>
				<span class="ui-toc__label">{label}</span>
				{current ? <span class="ui-toc__current">{current}</span> : null}
				{glyphs.sheet
					? <span class="ui-toc__glyph" aria-hidden="true">{glyphs.sheet()}</span>
					: null}
			</button>
		</nav>
	);
}
// #endregion
