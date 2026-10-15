import { Component, type JSX, type VNode } from "preact";
import { SelectionCheck } from "../../fields/components/SelectionCheck.tsx";
import type { DataColumn, DataColumnAlign } from "../types/data-table.ts";
import { type CellContext, DataTableCell } from "./DataTableCell.tsx";

/** Props for {@link DataTableRow}. */
export interface DataTableRowProps<T> {
	row: T;
	rowKey: string;
	index: number;
	/** `--dt-i` places a fixed-height row; `y` (px) places a measured one. */
	y: number | null;
	columns: readonly DataColumn<T>[];
	aligns: Readonly<Record<string, DataColumnAlign>>;
	queries: Readonly<Record<string, string>>;
	/** Sticky offsets of the pinned columns, px. */
	pins: Readonly<Record<string, number>>;
	ctx: CellContext;
	/** The row's link, stretched under its cells so the whole row is the hit area. */
	href: string | null;
	/** A consumer styling token, rendered as `data-state`. */
	state: string | null;
	selectable: boolean;
	selected: boolean;
	focused: boolean;
	/** Accessible name of the row's check ("Select Brief.pdf"). */
	label: string;
	/** Renders the trailing actions cell; receives the row element (the right-click surface). */
	actions: ((surface: () => HTMLElement | null) => VNode) | null;
	/** The caller's `rowActions`; a new function re-renders the row so its menu is current. */
	actionsSource: unknown;
	measure: ((el: HTMLElement | null) => void) | null;
	/** Index of the first data column for `aria-colindex` (2 when a check column leads). */
	firstColIndex: number;
}

const COMPARED: readonly (keyof DataTableRowProps<unknown>)[] = [
	"row",
	"rowKey",
	"index",
	"y",
	"columns",
	"aligns",
	"queries",
	"pins",
	"ctx",
	"href",
	"state",
	"selectable",
	"selected",
	"focused",
	"label",
	"actionsSource",
	"measure",
];

/**
 * One body row. A class component so it can skip re-rendering when nothing it shows has changed —
 * scrolling mounts and unmounts rows at the edges and must not re-render the rows in between.
 */
export class DataTableRow<T> extends Component<DataTableRowProps<T>> {
	override shouldComponentUpdate(next: DataTableRowProps<T>): boolean {
		const prev = this.props as DataTableRowProps<unknown>;
		const incoming = next as DataTableRowProps<unknown>;
		if (COMPARED.some((key) => prev[key] !== incoming[key])) return true;
		return (prev.actions === null) !== (incoming.actions === null);
	}

	private readonly surface = (): HTMLElement | null =>
		(this.base as HTMLElement | undefined) ?? null;

	override render(): JSX.Element {
		const p = this.props;
		const style = p.y === null ? `--dt-i:${p.index}` : `--dt-y:${p.y}px`;
		return (
			<div
				ref={p.measure ?? undefined}
				class="ui-dt__row"
				role="row"
				aria-rowindex={p.index + 2}
				aria-selected={p.selectable ? p.selected : undefined}
				tabIndex={p.focused ? 0 : -1}
				data-key={p.rowKey}
				data-index={p.index}
				data-selected={p.selected ? "true" : undefined}
				data-measured={p.y === null ? undefined : "true"}
				data-state={p.state ?? undefined}
				style={style}
			>
				{p.href
					? (
						<a
							class="ui-dt__rowlink"
							href={p.href}
							tabIndex={-1}
							aria-hidden="true"
							data-dt-link=""
						/>
					)
					: null}
				{p.selectable
					? (
						<div class="ui-dt__cell ui-dt__lead" role="gridcell" aria-colindex={1}>
							<button
								type="button"
								class="ui-dt__check"
								role="checkbox"
								aria-checked={p.selected}
								aria-label={`Select ${p.label}`}
								tabIndex={-1}
								data-dt-check=""
							>
								<SelectionCheck checked={p.selected} size="sm" />
							</button>
						</div>
					)
					: null}
				{p.columns.map((column, i) => (
					<DataTableCell
						key={column.id}
						column={column}
						row={p.row}
						ctx={p.ctx}
						query={p.queries[column.id] ?? ""}
						align={p.aligns[column.id]}
						pin={p.pins[column.id] ?? null}
						primary={i === 0}
						colIndex={p.firstColIndex + i}
					/>
				))}
				{p.actions
					? <div class="ui-dt__cell ui-dt__tail" role="gridcell">{p.actions(this.surface)}</div>
					: null}
			</div>
		);
	}
}
