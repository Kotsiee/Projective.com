import type { ComponentChildren, JSX, Ref, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { Icon } from "../../icons/mod.ts";
import { SelectionCheck } from "../../fields/components/SelectionCheck.tsx";
import { Popover } from "../../feedback/islands/Popover.tsx";
import DndContext from "../../dnd/islands/DndContext.tsx";
import { DragOverlay } from "../../dnd/components/DragOverlay.tsx";
import { useDraggable } from "../../dnd/hooks/useDraggable.ts";
import { useDroppable } from "../../dnd/hooks/useDroppable.ts";
import { useDnd } from "../../dnd/core/context.ts";
import type { DragEndEvent } from "../../dnd/core/types.ts";
import type {
	ColumnFilterSpec,
	ColumnFilterState,
	ColumnFilterValue,
	DataColumn,
	DataColumnAlign,
	DataSort,
	FilterOption,
} from "../types/data-table.ts";
import { isFilterActive } from "../core/table-filter.ts";
import { DataTableFilter } from "./DataTableFilter.tsx";

const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;

/** Props for {@link DataTableHead}. */
export interface DataTableHeadProps<T> {
	columns: readonly DataColumn<T>[];
	aligns: Readonly<Record<string, DataColumnAlign>>;
	pins: Readonly<Record<string, number>>;
	widths: Readonly<Record<string, number>>;
	sortKeys: Readonly<Record<string, string | null>>;
	sorts: readonly DataSort[];
	onSort: (key: string, append: boolean) => void;
	filterSpecs: Readonly<Record<string, ColumnFilterSpec | null>>;
	filters: ColumnFilterState;
	onFilter: (columnId: string, value: ColumnFilterValue | null) => void;
	optionsOf: (column: DataColumn<T>) => readonly FilterOption[];
	unitOf: (column: DataColumn<T>) => string | null;
	resizable: boolean;
	/** Live width while dragging (no re-render); `commit` persists it. */
	onResize: (columnId: string, width: number, commit: boolean) => void;
	onAutoFit: (columnId: string) => void;
	reorderable: boolean;
	onMove: (columnId: string, overId: string) => void;
	/** The leading select-all cell; `null` when rows are not selectable. */
	lead: { state: "none" | "some" | "all"; multiple: boolean; onToggle: () => void } | null;
	/** The trailing cell's content (the column chooser), or `null` for no tail track. */
	tail: ComponentChildren | null;
	hasTail: boolean;
	headRef: RefObject<HTMLDivElement>;
	firstColIndex: number;
}

interface HeaderCellProps<T> {
	column: DataColumn<T>;
	head: DataTableHeadProps<T>;
	colIndex: number;
	dropRef?: (el: HTMLElement | null) => void;
	over?: boolean;
	grip?: JSX.Element | null;
}

function SortMark(
	{ dir, priority }: { dir: "asc" | "desc" | null; priority: number | null },
): JSX.Element {
	return (
		<span class="ui-dt__sortmark" data-active={dir ? "true" : undefined} aria-hidden="true">
			<Icon name={dir === "asc" ? "sort-asc" : dir === "desc" ? "sort-desc" : "sort"} />
			{priority !== null ? <span class="ui-dt__prio">{priority}</span> : null}
		</span>
	);
}

function FilterTrigger<T>(
	{ column, head }: { column: DataColumn<T>; head: DataTableHeadProps<T> },
) {
	const spec = head.filterSpecs[column.id];
	if (!spec) return null;
	const value = head.filters[column.id];
	const active = isFilterActive(value);
	return (
		<Popover
			placement="bottom-start"
			label={`Filter ${column.header}`}
			trigger={(api) => (
				<button
					ref={api.ref as Ref<HTMLButtonElement>}
					type="button"
					class="ui-dt__filter"
					data-active={active ? "true" : undefined}
					aria-label={active ? `Filter ${column.header} (active)` : `Filter ${column.header}`}
					aria-haspopup="dialog"
					aria-expanded={api.expanded}
					aria-controls={api.expanded ? api.panelId : undefined}
					onClick={api.toggle}
				>
					<Icon name="filter" />
				</button>
			)}
		>
			<DataTableFilter
				header={column.header}
				spec={spec}
				value={value}
				onChange={(next) => head.onFilter(column.id, next)}
				options={head.optionsOf(column)}
				unit={head.unitOf(column)}
			/>
		</Popover>
	);
}

function ResizeHandle<T>({ column, head }: { column: DataColumn<T>; head: DataTableHeadProps<T> }) {
	const drag = useRef<
		{ x: number; width: number; rtl: boolean; next: number; frame: number } | null
	>(
		null,
	);
	const width = () => head.widths[column.id];

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget;
		el.setPointerCapture(e.pointerId);
		drag.current = {
			x: e.clientX,
			width: width(),
			rtl: getComputedStyle(el).direction === "rtl",
			next: width(),
			frame: 0,
		};
	};
	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		const d = drag.current;
		if (!d) return;
		const dx = (e.clientX - d.x) * (d.rtl ? -1 : 1);
		d.next = d.width + dx;
		if (!d.frame) {
			d.frame = requestAnimationFrame(() => {
				if (!drag.current) return;
				drag.current.frame = 0;
				head.onResize(column.id, drag.current.next, false);
			});
		}
	};
	const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		const d = drag.current;
		if (!d) return;
		if (d.frame) cancelAnimationFrame(d.frame);
		e.currentTarget.releasePointerCapture?.(e.pointerId);
		drag.current = null;
		head.onResize(column.id, d.next, true);
	};
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		let delta = 0;
		if (e.key === "ArrowRight") delta = rtl ? -step : step;
		else if (e.key === "ArrowLeft") delta = rtl ? step : -step;
		else if (e.key === "Enter") {
			e.preventDefault();
			head.onAutoFit(column.id);
			return;
		} else return;
		e.preventDefault();
		e.stopPropagation();
		head.onResize(column.id, width() + delta, true);
	};

	return (
		<span
			class="ui-dt__resize"
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${column.header} column`}
			aria-valuenow={width()}
			aria-valuemin={column.minWidth}
			aria-valuemax={column.maxWidth}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onDblClick={() => head.onAutoFit(column.id)}
			onKeyDown={onKeyDown}
		/>
	);
}

function HeaderCell<T>(props: HeaderCellProps<T>): JSX.Element {
	const { column, head, colIndex } = props;
	const key = head.sortKeys[column.id];
	const index = key ? head.sorts.findIndex((s) => s.key === key) : -1;
	const dir = index >= 0 ? head.sorts[index].dir : null;
	const priority = index >= 0 && head.sorts.length > 1 ? index + 1 : null;
	const pin = head.pins[column.id];
	const label = (
		<span class={column.headerHidden ? "ui-visually-hidden" : "ui-dt__label"}>{column.header}</span>
	);

	return (
		<div
			ref={props.dropRef}
			class="ui-dt__th"
			role="columnheader"
			aria-colindex={colIndex}
			aria-sort={dir === "asc"
				? "ascending"
				: dir === "desc"
				? "descending"
				: key
				? "none"
				: undefined}
			data-col={column.id}
			data-align={head.aligns[column.id]}
			data-pinned={pin === undefined ? undefined : "true"}
			data-over={props.over ? "true" : undefined}
			style={pin === undefined ? undefined : `--dt-pin:${pin}px`}
		>
			{key
				? (
					<button
						type="button"
						class="ui-dt__sort"
						onClick={(e) => head.onSort(key, e.shiftKey)}
						title={head.sorts.length > 0
							? "Shift+click to sort by more than one column"
							: undefined}
					>
						{label}
						<SortMark dir={dir} priority={priority} />
					</button>
				)
				: <span class="ui-dt__sort ui-dt__sort--static">{label}</span>}
			<FilterTrigger column={column} head={head} />
			{props.grip ?? null}
			{head.resizable && column.resizable !== false && !column.fill
				? <ResizeHandle column={column} head={head} />
				: null}
		</div>
	);
}

function ReorderableHeaderCell<T>(props: HeaderCellProps<T>): JSX.Element {
	const { column } = props;
	const drag = useDraggable({
		id: column.id,
		data: { type: "dt-column" },
		roleDescription: "column",
	});
	const drop = useDroppable({ id: column.id, data: { accepts: ["dt-column"] } });
	const grip = (
		<button
			ref={drag.setNodeRef}
			type="button"
			class="ui-dt__grip"
			aria-label={`Move ${column.header} column`}
			data-dragging={drag.isDragging.value ? "true" : undefined}
			{...drag.attributes}
			onPointerDown={drag.listeners.onPointerDown}
			onKeyDown={drag.listeners.onKeyDown}
		>
			<Icon name="grip" />
		</button>
	);
	return (
		<HeaderCell
			{...props}
			dropRef={drop.setNodeRef}
			over={drop.isOver.value && !drag.isDragging.value}
			grip={grip}
		/>
	);
}

function ColumnGhost<T>({ columns }: { columns: readonly DataColumn<T>[] }): JSX.Element {
	const { store } = useDnd();
	const id = store.active.value?.id;
	const column = id ? columns.find((c) => c.id === id) : undefined;
	return (
		<DragOverlay class="ui-dt-ghost">
			{column ? <span class="ui-dt-ghost__label">{column.header}</span> : null}
		</DragOverlay>
	);
}

/** The sticky header row: sort, filter, resize, reorder, select-all and the column chooser. */
export function DataTableHead<T>(head: DataTableHeadProps<T>): JSX.Element {
	const { lead, columns } = head;
	const onDragEnd = (e: DragEndEvent) => {
		if (e.canceled || !e.over || e.over === e.active.id) return;
		head.onMove(e.active.id, e.over);
	};

	const cells = columns.map((column, i) => {
		const props: HeaderCellProps<T> = { column, head, colIndex: head.firstColIndex + i };
		return head.reorderable && column.reorderable !== false && !column.pinned
			? <ReorderableHeaderCell key={column.id} {...props} />
			: <HeaderCell key={column.id} {...props} />;
	});

	const row = (
		<div class="ui-dt__row ui-dt__row--head" role="row" aria-rowindex={1}>
			{lead
				? (
					<div class="ui-dt__th ui-dt__lead" role="columnheader" aria-colindex={1}>
						{lead.multiple
							? (
								<button
									type="button"
									class="ui-dt__check"
									role="checkbox"
									aria-checked={lead.state === "all"
										? true
										: lead.state === "some"
										? "mixed"
										: false}
									aria-label="Select all rows"
									data-state={lead.state}
									onClick={lead.onToggle}
								>
									<SelectionCheck checked={lead.state !== "none"} size="sm" />
								</button>
							)
							: <span class="ui-visually-hidden">Selection</span>}
					</div>
				)
				: null}
			{cells}
			{head.hasTail
				? (
					<div class="ui-dt__th ui-dt__tail" role="columnheader">
						{head.tail}
						<span class="ui-visually-hidden">Actions</span>
					</div>
				)
				: null}
		</div>
	);

	return (
		<div class="ui-dt__head" ref={head.headRef} role="rowgroup">
			{head.reorderable
				? (
					<DndContext onDragEnd={onDragEnd} activationDistance={4}>
						{row}
						<ColumnGhost columns={columns} />
					</DndContext>
				)
				: row}
		</div>
	);
}
