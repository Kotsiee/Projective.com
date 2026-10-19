import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { useId } from "../../hooks/useId.ts";
import {
	cellAccessibleName,
	cellLockReason,
	cellPressed,
	cellToggleable,
	clampPos,
	groupRuns,
	lockReasonIds,
	matrixKeyIntent,
	type MatrixPos,
	PERMISSION_STATE_LABELS,
	type PermissionCellState,
	type PermissionMatrixColumn,
	type PermissionMatrixRow,
} from "../core/permission-matrix-nav.ts";

// #region Props
/** The glyph per marked state — `off` draws none. Supplied by the consumer (an `IconShell` glyph). */
export interface PermissionMatrixGlyphs {
	allowed: ComponentChildren;
	conditional: ComponentChildren;
	locked: ComponentChildren;
}

/** Props for {@link PermissionMatrix} and its stylesheet-free table, {@link PermissionMatrixGrid}. */
export interface PermissionMatrixProps {
	/** Capabilities, one row each, in display order. */
	rows: readonly PermissionMatrixRow[];
	/** Roles, one column each, in display order. */
	columns: readonly PermissionMatrixColumn[];
	/** The state of one cell. */
	value: (row: PermissionMatrixRow, column: PermissionMatrixColumn) => PermissionCellState;
	/** Toggle one cell; absent renders the matrix read-only (`aria-readonly`, no buttons). */
	onToggle?: (row: PermissionMatrixRow, column: PermissionMatrixColumn) => void;
	/** The table's caption — required; hide it visually with `captionHidden`. */
	caption: string;
	/** Keep the caption for assistive tech only. */
	captionHidden?: boolean;
	/** The corner header naming the capability column (e.g. "Capability"). */
	rowHeaderLabel: string;
	/** State glyphs; shape carries the state alongside the fill, so colour is never the only cue. */
	glyphs: PermissionMatrixGlyphs;
	/** Override the spoken state words (defaults: Allowed · Conditional · Locked · Not allowed). */
	stateLabels?: Partial<Record<PermissionCellState, string>>;
	/**
	 * Why a locked cell cannot change; every locked cell is described by it unless its column carries
	 * its own `lockedHint` or `cellLock` gives the cell a reason.
	 */
	lockedHint?: string;
	/**
	 * Fix one cell with the reason it cannot change, or return `null` to leave it to the state and its
	 * column. A fixed cell keeps the state it draws (allowed, off, …) and stays focusable; it refuses
	 * activation like a locked one and is described by the reason — e.g. a grant the editor may not
	 * make. Ignored on a read-only matrix.
	 */
	cellLock?: (
		row: PermissionMatrixRow,
		column: PermissionMatrixColumn,
	) => string | null | undefined;
	/**
	 * Controls for one column, rendered in its header beside the label (e.g. an `ActionMenu` kebab for
	 * a role). They sit outside the grid's roving focus — each is its own tab stop — so keep them to
	 * one compact control per column, and return `null` for a column that has none.
	 */
	columnActions?: (column: PermissionMatrixColumn, index: number) => ComponentChildren;
	/** The inline word shown on a `sensitive` capability (default "Sensitive"). */
	sensitiveLabel?: string;
	/** Root id; minted when absent. */
	id?: string;
	class?: string;
}
// #endregion

const DEFAULT_LOCKED_HINT = "Fixed for this role; it can't be changed here.";

/** The DOM attribute pair a cell's focus target carries, so the grid can find it by position. */
function cellSelector(at: MatrixPos): string {
	return `[data-pm-row="${at.row}"][data-pm-col="${at.col}"]`;
}

/**
 * The matrix table itself, without its stylesheet or scroll container — the part a unit test can
 * render. Consumers use {@link PermissionMatrix}, which wraps this in a `ScrollArea` and carries the
 * CSS.
 *
 * One tab stop: a roving `tabindex` keeps exactly one cell at `0`. Arrow keys, Home/End and
 * Ctrl+Home/End move it (see `permission-matrix-nav.ts`); Space/Enter fall through to the native
 * button, whose click toggles. Each cell is a toggle button inside its `td` gridcell — the APG
 * "single widget per cell" form — because `aria-pressed` is not a gridcell attribute and a
 * `button[role=gridcell]` inside a `td` would nest one gridcell in another.
 */
export function PermissionMatrixGrid(props: PermissionMatrixProps): JSX.Element {
	const {
		rows,
		columns,
		value,
		onToggle,
		caption,
		captionHidden = false,
		rowHeaderLabel,
		glyphs,
		stateLabels,
		lockedHint = DEFAULT_LOCKED_HINT,
		sensitiveLabel = "Sensitive",
		cellLock,
		columnActions,
		id: idProp,
		class: className,
	} = props;

	const id = useId(idProp, "ui-pm");
	const lockedId = `${id}-locked`;
	const tableRef = useRef<HTMLTableElement>(null);
	const interactive = typeof onToggle === "function";
	const dims = { rows: rows.length, cols: columns.length };
	const active = useSignal<MatrixPos>({ row: 0, col: 0 });
	const focus = clampPos(active.value, dims);
	const labels = { ...PERMISSION_STATE_LABELS, ...stateLabels };

	// #region Cell facts
	/**
	 * Every cell's state and the consumer's fix on it, read once per render: the cells, the keyboard
	 * and the hidden lock reasons all answer from the same reading.
	 */
	const facts = rows.map((row) =>
		columns.map((column) => ({
			state: value(row, column),
			fixed: interactive ? cellLock?.(row, column) ?? null : null,
		}))
	);
	const reasonAt = (at: MatrixPos): string | null => {
		const fact = facts[at.row][at.col];
		return cellLockReason(fact.state, columns[at.col], fact.fixed, lockedHint);
	};
	/** One hidden sentence per distinct reason; the matrix-wide hint keeps `<id>-locked`. */
	const reasonIds = lockReasonIds(
		facts.flatMap((cells, row) => cells.map((_, col) => reasonAt({ row, col }))),
		lockedHint,
		lockedId,
	);

	const toggleableAt = (at: MatrixPos): boolean => {
		const fact = facts[at.row][at.col];
		return cellToggleable(fact.state, columns[at.col], interactive, fact.fixed);
	};
	// #endregion

	// #region Keyboard
	const positionOf = (target: EventTarget | null): MatrixPos | null => {
		const el = (target as Element | null)?.closest?.("[data-pm-row]");
		if (!el) return null;
		return {
			row: Number(el.getAttribute("data-pm-row")),
			col: Number(el.getAttribute("data-pm-col")),
		};
	};

	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTableElement>) => {
		const from = positionOf(event.target);
		if (!from) return;
		const intent = matrixKeyIntent(event, from, dims, toggleableAt);
		if (intent.kind === "move") {
			event.preventDefault();
			active.value = intent.to;
			tableRef.current?.querySelector<HTMLElement>(cellSelector(intent.to))?.focus();
		} else if (intent.kind === "refuse") {
			// A locked or read-only cell: no activation, and Space must not scroll the page.
			event.preventDefault();
		}
		// `toggle` is left to the native button click, so pointer, keyboard and assistive-tech
		// activation all take the one path below.
	};

	const onFocusCell = (at: MatrixPos) => {
		if (active.value.row !== at.row || active.value.col !== at.col) active.value = at;
	};
	// #endregion

	// #region Cells
	const renderCell = (
		row: PermissionMatrixRow,
		rowIndex: number,
		column: PermissionMatrixColumn,
		colIndex: number,
	) => {
		const at = { row: rowIndex, col: colIndex };
		const { state } = facts[rowIndex][colIndex];
		const toggleable = toggleableAt(at);
		const reason = reasonAt(at);
		const locked = reason !== null;
		const name = cellAccessibleName(row.label, column.label, labels[state]);
		const describedBy = cx(
			reason !== null && reasonIds.get(reason),
			row.hint && `${id}-hint-${rowIndex}`,
		) || undefined;
		const tabIndex = focus.row === rowIndex && focus.col === colIndex ? 0 : -1;
		const glyph = state === "off" ? null : glyphs[state];
		const mark = cx(
			"ui-permission-matrix__cell",
			`ui-permission-matrix__cell--${state}`,
			locked && "ui-permission-matrix__cell--fixed",
		);

		if (!interactive) {
			return (
				<td
					key={column.key}
					class="ui-permission-matrix__slot ui-permission-matrix__slot--read"
					tabIndex={tabIndex}
					aria-label={name}
					aria-describedby={describedBy}
					data-pm-row={rowIndex}
					data-pm-col={colIndex}
					onFocus={() => onFocusCell(at)}
				>
					<span class={mark} aria-hidden="true">
						{glyph && <span class="ui-permission-matrix__glyph">{glyph}</span>}
					</span>
				</td>
			);
		}

		return (
			<td key={column.key} class="ui-permission-matrix__slot">
				<button
					type="button"
					class={mark}
					tabIndex={tabIndex}
					aria-label={name}
					aria-pressed={cellPressed(state)}
					aria-disabled={toggleable ? undefined : "true"}
					aria-describedby={describedBy}
					data-pm-row={rowIndex}
					data-pm-col={colIndex}
					onFocus={() => onFocusCell(at)}
					onClick={() => {
						if (toggleable) onToggle?.(row, column);
					}}
				>
					{glyph && <span class="ui-permission-matrix__glyph" aria-hidden="true">{glyph}</span>}
				</button>
			</td>
		);
	};
	// #endregion

	return (
		<>
			<table
				ref={tableRef}
				id={id}
				role="grid"
				class={cx("ui-permission-matrix__table", className)}
				aria-readonly={interactive ? undefined : "true"}
				onKeyDown={onKeyDown}
			>
				<caption class={cx("ui-permission-matrix__caption", captionHidden && "ui-visually-hidden")}>
					{caption}
				</caption>
				<colgroup>
					<col class="ui-permission-matrix__col ui-permission-matrix__col--head" />
					{columns.map((column) => <col key={column.key} class="ui-permission-matrix__col" />)}
				</colgroup>
				<thead>
					<tr>
						<th scope="col" class="ui-permission-matrix__corner">{rowHeaderLabel}</th>
						{columns.map((column, colIndex) => {
							const actions = columnActions?.(column, colIndex);
							const label = (
								<span class="ui-permission-matrix__colhead-label">
									{column.label}
									{column.locked && (
										<span class="ui-permission-matrix__colhead-lock" aria-hidden="true">
											{glyphs.locked}
										</span>
									)}
								</span>
							);
							return (
								<th
									key={column.key}
									scope="col"
									class={cx(
										"ui-permission-matrix__colhead",
										column.locked && "ui-permission-matrix__colhead--locked",
									)}
								>
									{actions == null || actions === false
										? label
										: (
											<span class="ui-permission-matrix__colhead-row">
												{label}
												<span class="ui-permission-matrix__colhead-actions">{actions}</span>
											</span>
										)}
									{column.meta && <span class="ui-permission-matrix__meta">{column.meta}</span>}
								</th>
							);
						})}
					</tr>
				</thead>
				{groupRuns(rows).map((run, runIndex) => (
					<tbody key={`${run.group ?? ""}-${runIndex}`} class="ui-permission-matrix__group">
						{run.group !== null && (
							<tr class="ui-permission-matrix__group-row">
								<th
									scope="rowgroup"
									colSpan={columns.length + 1}
									class="ui-permission-matrix__group-head"
								>
									<span class="ui-permission-matrix__group-label">{run.group}</span>
								</th>
							</tr>
						)}
						{run.rows.map(({ row, index }) => (
							<tr key={row.key} class="ui-permission-matrix__row">
								<th scope="row" class="ui-permission-matrix__rowhead">
									<span class="ui-permission-matrix__rowhead-label">{row.label}</span>
									{(row.sensitive || row.hint) && (
										<span
											class="ui-permission-matrix__meta"
											id={row.hint ? `${id}-hint-${index}` : undefined}
										>
											{row.sensitive && (
												<span class="ui-permission-matrix__sensitive">{sensitiveLabel}</span>
											)}
											{row.sensitive && row.hint && (
												<>
													<span class="ui-permission-matrix__sep" aria-hidden="true">·</span>
													<span class="ui-visually-hidden">,</span>
												</>
											)}
											{row.hint}
										</span>
									)}
								</th>
								{columns.map((column, colIndex) => renderCell(row, index, column, colIndex))}
							</tr>
						))}
					</tbody>
				))}
			</table>
			{[...reasonIds].map(([reason, reasonId]) => (
				<span key={reasonId} id={reasonId} hidden>{reason}</span>
			))}
		</>
	);
}
