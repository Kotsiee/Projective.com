import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { useVirtualScroll } from "@projective/ui/hooks";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import {
	type AssetItem,
	type FileSortDir,
	type FileSortKey,
	sourceLabel,
} from "../types/projects-types.ts";
import { listRowHeight, listShowsThumbnails, zoom } from "../core/view-state.ts";
import { FileKindIcon } from "./file-glyphs.tsx";
import { Icon } from "@projective/ui/icons";

/**
 * FileTable — the dense list/table presentation of the workspace, window-virtualized (only in-view
 * rows mount) so an unbounded corpus stays cheap. Rows are transparent with an ultra-faint bottom
 * hairline, highlighting to a muted tone on hover (§B.4 — no boxing; the row is interactive so its
 * hover highlight is allowed). Columns: Filename · Sender · Date/Time · Size. Headers are drag-
 * RESIZABLE (sender/date/size; the name column flexes to absorb) and click-SORTABLE (they drive the
 * SAME shared sort signals as the toolbar's SortControl — one source of truth). The filename cell is
 * zoom-adaptive: a clean category icon at low zoom, an inline media thumbnail at high zoom.
 *
 * Rendered inside the FileExplorer island (its hooks run there); no data access of its own.
 */
export interface FileTableProps {
	items: AssetItem[];
	/** Shared sort key (a plain-string signal so it binds the same signal the toolbar SortControl uses). */
	sortKey: Signal<string>;
	sortDir: Signal<FileSortDir>;
	/** Set/toggle the shared sort (owned by the island — it refetches). */
	onSort: (key: FileSortKey) => void;
	onOpen: (file: AssetItem) => void;
	onReachEnd?: () => void;
	loading?: boolean;
	/**
	 * Whether rows window-virtualize. Default on — the explorer's corpus is unbounded.
	 *
	 * Turn it OFF inside an overlay. This list virtualizes against the WINDOW, but a dialog's scroll
	 * container is its own body, so the measurement would be of a box the rows are not in and the
	 * window would report a viewport the list does not occupy. A ticket's attachments are a bounded
	 * handful, so they simply all render — the same reasoning the ticket's Submissions tab follows.
	 */
	virtualize?: boolean;
}

interface ColumnDef {
	key: string;
	label: string;
	sort: FileSortKey;
	resizable: boolean;
	defaultWidth: number;
	align?: "end";
}

const COLUMNS: ColumnDef[] = [
	{ key: "name", label: "Name", sort: "name", resizable: false, defaultWidth: 0 },
	{ key: "sender", label: "Sender", sort: "sender", resizable: true, defaultWidth: 200 },
	{ key: "date", label: "Date", sort: "date", resizable: true, defaultWidth: 176 },
	{ key: "size", label: "Size", sort: "size", resizable: true, defaultWidth: 112 },
];

function loadWidths(): Record<string, number> {
	const raw = readStored("local", LocalKeys.FILES_COLUMNS);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, number>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function FileTable(props: FileTableProps): JSX.Element {
	const { items, sortKey, sortDir, onSort, onOpen, onReachEnd, loading, virtualize = true } = props;

	const widths = useSignal<Record<string, number>>({
		sender: COLUMNS[1].defaultWidth,
		date: COLUMNS[2].defaultWidth,
		size: COLUMNS[3].defaultWidth,
		...loadWidths(),
	});

	const viewportRef = useRef<HTMLDivElement>(null);
	const resizeState = useRef<{ key: string; startX: number; startW: number } | null>(null);

	const rowH = listRowHeight(zoom.value);
	const showThumb = listShowsThumbnails(zoom.value);

	const vs = useVirtualScroll({
		// Held at zero when the caller opted out, so the hook does no measuring it would only get
		// wrong. Hooks cannot be conditional; the work they do can be.
		count: virtualize ? items.length : 0,
		itemSize: rowH,
		useWindow: true,
		parentRef: viewportRef,
		overscan: 8,
		onReachEnd,
		getItemKey: (i) => items[i]?.id ?? i,
	});

	// Rows keep their absolute placement in both modes, so the two presentations are the same markup
	// at the same metrics — only how many of them exist differs.
	const rows = virtualize
		? vs.virtualItems
		: items.map((_, index) => ({ index, start: index * rowH }));
	const totalSize = virtualize ? vs.totalSize : items.length * rowH;

	const gridTemplate =
		`minmax(200px, 1fr) ${widths.value.sender}px ${widths.value.date}px ${widths.value.size}px`;

	// #region Column resize
	const onResizeDown = (key: string) => (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		e.stopPropagation();
		e.preventDefault();
		resizeState.current = { key, startX: e.clientX, startW: widths.value[key] ?? 160 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onResizeMove = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		const r = resizeState.current;
		if (!r) return;
		const next = Math.max(72, Math.min(480, r.startW + (e.clientX - r.startX)));
		widths.value = { ...widths.value, [r.key]: next };
	};
	const onResizeUp = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		if (!resizeState.current) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		resizeState.current = null;
		writeStored("local", LocalKeys.FILES_COLUMNS, JSON.stringify(widths.value));
	};
	const onResizeKey = (key: string) => (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		let d = 0;
		if (e.key === "ArrowRight") d = 12;
		else if (e.key === "ArrowLeft") d = -12;
		else return;
		e.preventDefault();
		e.stopPropagation();
		const next = Math.max(72, Math.min(480, (widths.value[key] ?? 160) + d));
		widths.value = { ...widths.value, [key]: next };
		writeStored("local", LocalKeys.FILES_COLUMNS, JSON.stringify(widths.value));
	};
	// #endregion

	// 3-state indicator: ▲ asc · ▼ desc on the active column, a muted ⇅ hint on the rest (a further
	// click of the active column clears the sort back to the default order).
	function sortIndicator(col: ColumnDef): JSX.Element {
		const active = sortKey.value === col.sort;
		return (
			<span class="fx-th__sort" data-active={active ? "true" : undefined} aria-hidden="true">
				<Icon name={active ? (sortDir.value === "asc" ? "sort-asc" : "sort-desc") : "sort"} />
			</span>
		);
	}

	return (
		<div
			class="fx-table"
			style={`--fx-cols:${gridTemplate};--fx-rowh:${rowH}px`}
			role="table"
			aria-label="Files"
			aria-rowcount={items.length + 1}
			aria-colcount={COLUMNS.length}
		>
			<div class="fx-table__head" role="row">
				{COLUMNS.map((col) => (
					<div
						key={col.key}
						class="fx-th"
						role="columnheader"
						data-align={col.align}
						aria-sort={sortKey.value === col.sort
							? (sortDir.value === "asc" ? "ascending" : "descending")
							: "none"}
					>
						<button type="button" class="fx-th__btn" onClick={() => onSort(col.sort)}>
							<span class="fx-th__label">{col.label}</span>
							{sortIndicator(col)}
						</button>
						{col.resizable
							? (
								<span
									class="fx-th__resize"
									role="separator"
									aria-orientation="vertical"
									aria-label={`Resize ${col.label} column`}
									tabIndex={0}
									onPointerDown={onResizeDown(col.key)}
									onPointerMove={onResizeMove}
									onPointerUp={onResizeUp}
									onKeyDown={onResizeKey(col.key)}
								/>
							)
							: null}
					</div>
				))}
			</div>

			<div class="fx-table__body" ref={viewportRef} role="rowgroup">
				{
					/* The sizer is presentational so the virtualization spacer never severs the
				    rowgroup → row ownership chain in the accessibility tree. */
				}
				<div class="fx-table__sizer" role="presentation" style={`height:${totalSize}px`}>
					{rows.map((vi) => {
						const file = items[vi.index];
						if (!file) return null;
						const thumb = showThumb && file.thumbnailUrl &&
							(file.kind === "image" || file.kind === "video");
						return (
							<div
								key={file.id}
								class="fx-row"
								role="row"
								data-index={vi.index}
								style={`--v-start:${vi.start}px`}
								onClick={() => onOpen(file)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onOpen(file);
									}
								}}
								tabIndex={0}
								aria-label={`${file.name}, ${file.sizeLabel}`}
							>
								<div class="fx-cell fx-cell--name" role="cell">
									<span class="fx-row__thumb" data-kind={file.kind}>
										{thumb
											? (
												<img
													src={file.thumbnailUrl ?? file.url}
													alt=""
													loading="lazy"
													draggable={false}
												/>
											)
											: <FileKindIcon kind={file.kind} size={18} />}
									</span>
									<span class="fx-row__name" title={file.name}>{file.name}</span>
								</div>
								<div class="fx-cell fx-cell--sender" role="cell">
									{file.sender
										? (
											<>
												<Avatar
													image={file.sender.avatar ?? undefined}
													label={file.sender.name}
													size={20}
													alt=""
												/>
												<span class="fx-row__sender">{file.sender.name}</span>
											</>
										)
										: <span class="fx-row__sender">{sourceLabel(file.source)}</span>}
								</div>
								<div class="fx-cell fx-cell--date" role="cell">{file.dateLabel}</div>
								<div class="fx-cell fx-cell--size" role="cell">{file.sizeLabel}</div>
							</div>
						);
					})}
				</div>
				{loading
					? (
						<div class="fx-table__loader" role="status" aria-live="polite">
							<span class="fx-spinner" aria-hidden="true" />
							<span class="ui-visually-hidden">Loading more files…</span>
						</div>
					)
					: null}
			</div>
		</div>
	);
}
