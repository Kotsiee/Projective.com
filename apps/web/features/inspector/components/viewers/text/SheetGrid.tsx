import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { headerCells, isNumericCell, nextSort } from "../../../core/csv.ts";
import {
	columnEdges,
	columnSpan,
	fitColumnWidths,
	moveCursor,
	rowSpan,
	selectionBox,
	selectionText,
	SHEET_GUTTER_PX,
	SHEET_ROW_PX,
	type SheetCell,
} from "../../../core/sheet-window.ts";
import { useInspectorActions } from "../../InspectorContext.ts";
import type { TableTools } from "./text-tools.ts";

/** Props for {@link SheetGrid}. */
export interface SheetGridProps {
	shell: InspectorShell;
	tools: TableTools;
	/** The grid's own scroller, shared with the stage's keys. */
	gridRef: RefObject<HTMLDivElement>;
}

const GRID_ID = "ins-grid";

function cellFrom(target: EventTarget | null): SheetCell | null {
	if (!(target instanceof Element)) return null;
	const address = target.closest<HTMLElement>("[data-cell]")?.dataset.cell;
	if (!address) return null;
	const [row, column] = address.split(":").map(Number);
	return { row, column };
}

/**
 * The spreadsheet grid: a sticky header row and row-number column around a window of cells, drawn
 * for whatever part of the sheet is in view, so a 200,000-row sheet costs the same as a 20-row one.
 * The rows are in normal flow inside a body sized for all of them; one shared grid template places
 * every cell, so a scroll restyles a handful of properties rather than thousands of cells.
 *
 * A cell is selected with a press, a drag, Shift or the keyboard, and Ctrl+C copies the selection as
 * tab-separated text. Headers sort, as they always did for a CSV.
 */
export function SheetGrid({ shell, tools, gridRef }: SheetGridProps): JSX.Element | null {
	const actions = useInspectorActions();
	const top = useSignal(0);
	const left = useSignal(0);
	const viewWidth = useSignal(0);
	const viewHeight = useSignal(0);
	const dragging = useRef(false);

	const table = tools.table.value;
	const declared = tools.widths.value;
	const header = tools.header.value;
	const widths = useMemo(
		() => (table ? fitColumnWidths(table.rows, table.columns, declared) : []),
		[table, declared],
	);
	const edges = useMemo(() => columnEdges(widths), [widths]);
	const labels = useMemo(() => (table ? headerCells(table, header) : []), [table, header]);

	useLayoutEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const measure = () => {
			viewWidth.value = grid.clientWidth;
			viewHeight.value = grid.clientHeight;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(grid);
		return () => observer.disconnect();
	}, [gridRef]);

	// A new sheet starts at its top-left corner, not wherever the last one was left.
	useLayoutEffect(() => gridRef.current?.scrollTo(0, 0), [table]);

	if (!table) return null;

	const order = tools.order.value;
	const sort = tools.sort.value;
	const cursor = tools.cursor.value;
	const rows = rowSpan(top.value, viewHeight.value, order.length);
	const cols = columnSpan(edges, left.value, viewWidth.value - SHEET_GUTTER_PX);
	const box = cursor ? selectionBox(cursor) : null;
	const focus = cursor?.focus ?? null;

	const shownColumns: number[] = [];
	for (let c = cols.first; c <= cols.last; c++) shownColumns.push(c);
	const template = [
		`${SHEET_GUTTER_PX}px`,
		`${edges[cols.first] ?? 0}px`,
		...shownColumns.map((c) => `${widths[c]}px`),
	].join(" ");
	const lastEdge = edges[edges.length - 1] ?? 0;

	function reveal(cell: SheetCell): void {
		const grid = gridRef.current;
		if (!grid) return;
		const rowTop = cell.row * SHEET_ROW_PX;
		const bottomLimit = rowTop + 2 * SHEET_ROW_PX - grid.clientHeight;
		if (rowTop < grid.scrollTop) grid.scrollTop = rowTop;
		else if (bottomLimit > grid.scrollTop) grid.scrollTop = bottomLimit;
		const start = edges[cell.column];
		const end = edges[cell.column + 1];
		const room = grid.clientWidth - SHEET_GUTTER_PX;
		if (start < grid.scrollLeft) grid.scrollLeft = start;
		else if (end > grid.scrollLeft + room) grid.scrollLeft = end - room;
	}

	function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const modified = event.ctrlKey || event.metaKey;
		if (modified && !event.altKey && event.key.toLowerCase() === "c" && box) {
			event.preventDefault();
			void actions.copy(selectionText(table?.rows ?? [], order, box), "Copied the selected cells");
			return;
		}
		const grid = gridRef.current;
		const page = Math.max(1, Math.floor((grid?.clientHeight ?? 0) / SHEET_ROW_PX) - 1);
		const next = moveCursor(cursor, event, {
			rows: order.length,
			columns: widths.length,
			page,
		});
		if (!next) return;
		event.preventDefault();
		tools.cursor.value = next;
		reveal(next.focus);
	}

	function onPointerDown(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const cell = cellFrom(event.target);
		if (!cell || event.button !== 0) return;
		// Stops the press from starting a text selection, which fights the cell selection.
		event.preventDefault();
		gridRef.current?.focus({ preventScroll: true });
		const anchor = event.shiftKey && cursor ? cursor.anchor : cell;
		tools.cursor.value = { anchor, focus: cell };
		dragging.current = true;
	}

	function onPointerMove(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!dragging.current) return;
		const cell = cellFrom(event.target);
		const current = tools.cursor.peek();
		if (!cell || !current) return;
		if (cell.row === current.focus.row && cell.column === current.focus.column) return;
		tools.cursor.value = { anchor: current.anchor, focus: cell };
	}

	const endDrag = () => (dragging.current = false);

	const activeShown = focus !== null && focus.row >= rows.first && focus.row <= rows.last &&
		focus.column >= cols.first && focus.column <= cols.last;

	return (
		<div
			ref={gridRef}
			id={GRID_ID}
			class="ins-grid__grid"
			role="grid"
			aria-label={`${shell.asset.name} cells`}
			aria-readonly="true"
			aria-multiselectable="true"
			aria-rowcount={order.length + 1}
			aria-colcount={widths.length + 1}
			aria-activedescendant={activeShown ? `${GRID_ID}-active` : undefined}
			tabIndex={0}
			style={styleVars({
				"--sheet-cols": template,
				"--sheet-row": `${SHEET_ROW_PX}px`,
				"--sheet-width": `${SHEET_GUTTER_PX + lastEdge}px`,
				"--sheet-height": `${order.length * SHEET_ROW_PX}px`,
				"--sheet-offset": `${Math.max(rows.first, 0) * SHEET_ROW_PX}px`,
			})}
			onScroll={(event) => {
				top.value = event.currentTarget.scrollTop;
				left.value = Math.abs(event.currentTarget.scrollLeft);
			}}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<div class="ins-grid__head" role="row" aria-rowindex={1}>
				<div class="ins-grid__corner" role="columnheader" aria-colindex={1}>
					<span class="ui-visually-hidden">Row</span>
				</div>
				{shownColumns.map((column) => {
					const label = labels[column];
					const direction = sort?.column === column ? sort.direction : null;
					return (
						<div
							key={column}
							class="ins-grid__colhead"
							role="columnheader"
							aria-colindex={column + 2}
							aria-sort={direction ?? undefined}
						>
							<button
								type="button"
								class="ins-grid__sort"
								onClick={() => {
									const next = nextSort(tools.sort.peek(), column);
									tools.sort.value = next;
									tools.cursor.value = null;
									shell.announce(
										next ? `Sorted by ${label}, ${next.direction}` : `Sorting by ${label} cleared`,
									);
								}}
							>
								<span class="ins-grid__label">{label}</span>
								<span class="ins-grid__sort-mark" aria-hidden="true">
									<Icon
										name={direction === "ascending"
											? "sort-asc"
											: direction === "descending"
											? "sort-desc"
											: "sort"}
										size="xs"
									/>
								</span>
							</button>
						</div>
					);
				})}
			</div>
			<div class="ins-grid__body" role="rowgroup">
				{order.slice(rows.first, rows.last + 1).map((source, offset) => {
					const row = rows.first + offset;
					const cells = table.rows[source];
					return (
						<div key={source} class="ins-grid__row" role="row" aria-rowindex={row + 2}>
							<div class="ins-grid__rownum" role="rowheader" aria-colindex={1}>
								{header ? source : source + 1}
							</div>
							{shownColumns.map((column) => {
								const text = cells[column] ?? "";
								const selected = box !== null && row >= box.top && row <= box.bottom &&
									column >= box.left && column <= box.right;
								const active = focus?.row === row && focus.column === column;
								return (
									<div
										key={column}
										id={active ? `${GRID_ID}-active` : undefined}
										class="ins-grid__cell"
										role="gridcell"
										aria-colindex={column + 2}
										aria-selected={selected || undefined}
										data-cell={`${row}:${column}`}
										data-numeric={isNumericCell(text) ? "true" : undefined}
										data-selected={selected ? "true" : undefined}
										data-active={active ? "true" : undefined}
									>
										{text}
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
