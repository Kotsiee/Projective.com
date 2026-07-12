import type { JSX } from "preact";
import "../styles/paginator.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

// #region Props
/** Emitted whenever the page (or the row count driving it) changes. */
export interface PaginatorPageEvent {
	first: number;
	rows: number;
	page: number;
	pageCount: number;
}

/** Props for {@link Paginator} (aliased as {@link Pagination}). */
export interface PaginatorProps {
	/** Index of the first record on the current page — raw number (uncontrolled) or `Signal<number>`. */
	first: Bindable<number>;
	/** Fired whenever `first` changes (page or row-size navigation). */
	onFirstChange?: ValueChange<number>;
	/** Rows per page — raw number (uncontrolled) or `Signal<number>`. */
	rows: Bindable<number>;
	/** Fired whenever `rows` changes (rows-per-page select). */
	onRowsChange?: ValueChange<number>;
	/** Total record count across all pages. */
	totalRecords: number;
	/** Row-size choices for an optional rows-per-page `<select>` (omit to hide the control). */
	rowsPerPageOptions?: number[];
	/** Fired on any navigation (page, first/prev/next/last, or a rows-per-page change). */
	onPageChange?: (event: PaginatorPageEvent) => void;
	/** Sibling page buttons shown around the current page on each side (default `1`). */
	siblingCount?: number;
	/** Page buttons always shown at each boundary (default `1`). */
	boundaryCount?: number;
	/** Report string with `{first}`/`{last}`/`{totalRecords}` placeholders (omit to hide the report). */
	currentPageReportTemplate?: string;
	/** Accessible label for the `nav` landmark (default `"Pagination"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Page range
function range(start: number, end: number): number[] {
	const len = end - start + 1;
	return len > 0 ? Array.from({ length: len }, (_, i) => start + i) : [];
}

/**
 * Boundary + sibling page numbers (0-based) with an `"ellipsis"` marker wherever a gap collapses.
 * Always shows `boundaryCount` pages at each end and `siblingCount` pages either side of `page`.
 */
function getPageItems(
	page: number,
	pageCount: number,
	siblingCount: number,
	boundaryCount: number,
): (number | "ellipsis")[] {
	if (pageCount <= 0) return [];
	const totalSlots = boundaryCount * 2 + siblingCount * 2 + 3;
	if (pageCount <= totalSlots) return range(0, pageCount - 1);

	const siblingsStart = Math.max(page - siblingCount, boundaryCount);
	const siblingsEnd = Math.min(page + siblingCount, pageCount - boundaryCount - 1);

	const items: (number | "ellipsis")[] = [];
	items.push(...range(0, boundaryCount - 1));
	if (siblingsStart > boundaryCount) items.push("ellipsis");
	items.push(...range(siblingsStart, siblingsEnd));
	if (siblingsEnd < pageCount - boundaryCount - 1) items.push("ellipsis");
	items.push(...range(pageCount - boundaryCount, pageCount - 1));

	const seen = new Set<number>();
	return items.filter((it) => {
		if (it === "ellipsis") return true;
		if (seen.has(it)) return false;
		seen.add(it);
		return true;
	});
}
// #endregion

/**
 * Paginator (aliased `Pagination`) — page control for `first`/`rows`/`totalRecords`. Renders
 * first/previous/page-numbers/next/last as native buttons (boundary + sibling numbers with `…` gaps
 * per `siblingCount`/`boundaryCount`), an optional rows-per-page `<select>`, and an optional
 * `currentPageReportTemplate` string (`{first}`/`{last}`/`{totalRecords}` placeholders). Every
 * control is a native, independently tabbable button/select, so the full keyboard model (Tab,
 * Enter, Space, native select) comes for free; the active page carries `aria-current="page"` and
 * boundary buttons disable natively at the ends.
 */
export function Paginator(props: PaginatorProps): JSX.Element {
	const {
		first,
		onFirstChange,
		rows,
		onRowsChange,
		totalRecords,
		rowsPerPageOptions,
		onPageChange,
		siblingCount = 1,
		boundaryCount = 1,
		currentPageReportTemplate,
		"aria-label": ariaLabel = "Pagination",
		class: className,
	} = props;

	const firstCtrl = useControllable<number>(first, 0, onFirstChange);
	const rowsCtrl = useControllable<number>(rows, 10, onRowsChange);
	const firstV = firstCtrl.signal.value;
	const rowsV = Math.max(1, rowsCtrl.signal.value);

	const pageCount = Math.max(1, Math.ceil(totalRecords / rowsV));
	const page = Math.min(Math.max(Math.floor(firstV / rowsV), 0), pageCount - 1);

	// #region Navigation
	const emit = (nextFirst: number, nextRows: number) => {
		const nextPageCount = Math.max(1, Math.ceil(totalRecords / nextRows));
		const nextPage = Math.min(Math.max(Math.floor(nextFirst / nextRows), 0), nextPageCount - 1);
		const resolvedFirst = nextPage * nextRows;
		onPageChange?.({ first: resolvedFirst, rows: nextRows, page: nextPage, pageCount: nextPageCount });
		return resolvedFirst;
	};

	const goToPage = (p: number) => {
		const clamped = Math.min(Math.max(p, 0), pageCount - 1);
		firstCtrl.set(emit(clamped * rowsV, rowsV));
	};

	const changeRows = (r: number) => {
		rowsCtrl.set(r);
		firstCtrl.set(emit(page * r, r));
	};
	// #endregion

	const items = getPageItems(page, pageCount, siblingCount, boundaryCount);

	const firstRecord = totalRecords === 0 ? 0 : firstV + 1;
	const lastRecord = Math.min(firstV + rowsV, totalRecords);
	const report = currentPageReportTemplate
		? currentPageReportTemplate
			.replace("{first}", String(firstRecord))
			.replace("{last}", String(lastRecord))
			.replace("{totalRecords}", String(totalRecords))
		: null;

	return (
		<nav class={cx("ui-paginator", className)} aria-label={ariaLabel}>
			<button
				type="button"
				class="ui-paginator__nav-btn"
				aria-label="First page"
				disabled={page === 0}
				onClick={() => goToPage(0)}
			>
				«
			</button>
			<button
				type="button"
				class="ui-paginator__nav-btn"
				aria-label="Previous page"
				disabled={page === 0}
				onClick={() => goToPage(page - 1)}
			>
				‹
			</button>

			<ul class="ui-paginator__pages">
				{items.map((it, i) =>
					it === "ellipsis"
						? (
							<li key={`e-${i}`} class="ui-paginator__ellipsis" aria-hidden="true">
								…
							</li>
						)
						: (
							<li key={it}>
								<button
									type="button"
									class={cx("ui-paginator__page", it === page && "ui-paginator__page--active")}
									aria-current={it === page ? "page" : undefined}
									aria-label={`Page ${it + 1}`}
									onClick={() => goToPage(it)}
								>
									{it + 1}
								</button>
							</li>
						)
				)}
			</ul>

			<button
				type="button"
				class="ui-paginator__nav-btn"
				aria-label="Next page"
				disabled={page >= pageCount - 1}
				onClick={() => goToPage(page + 1)}
			>
				›
			</button>
			<button
				type="button"
				class="ui-paginator__nav-btn"
				aria-label="Last page"
				disabled={page >= pageCount - 1}
				onClick={() => goToPage(pageCount - 1)}
			>
				»
			</button>

			{rowsPerPageOptions && rowsPerPageOptions.length > 0 && (
				<label class="ui-paginator__rows">
					<span class="ui-paginator__rows-label">Rows</span>
					<select
						class="ui-paginator__rows-select"
						value={rowsV}
						aria-label="Rows per page"
						onChange={(e: JSX.TargetedEvent<HTMLSelectElement>) =>
							changeRows(Number(e.currentTarget.value))}
					>
						{rowsPerPageOptions.map((n) => <option key={n} value={n}>{n}</option>)}
					</select>
				</label>
			)}

			{report && <span class="ui-paginator__report">{report}</span>}
		</nav>
	);
}

/** PrimeNG-parity alias for {@link Paginator}. */
export const Pagination = Paginator;
