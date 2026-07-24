import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { useVirtualScroll } from "@projective/ui/hooks";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { FundStateChip, Money } from "./wallet-bits.tsx";
import { WalletIcon } from "./wallet-glyphs.tsx";
import { listRowHeight, zoom } from "../core/view-state.ts";
import type { LedgerLine, TxnSort } from "../types/wallet-types.ts";

/**
 * TransactionTable — the dense, window-virtualized ledger (only in-view rows mount), cloned from the File
 * Explorer's `FileTable`. Columns: Description · Counterparty · Date · Amount; headers are drag-RESIZABLE
 * (counterparty/date/amount; description flexes) and click-SORTABLE, driving the SAME shared sort signals
 * as the toolbar (one source of truth). Row zoom follows the shared ledger `zoom` (footer rig). Amounts
 * are the server-formatted {@link Money} (with fund-state chip); the row deep-links to its Stage/Session.
 * Logical properties only (RtL-safe).
 */
export interface TransactionTableProps {
	items: LedgerLine[];
	sortKey: Signal<string>;
	sortDir: Signal<"asc" | "desc">;
	onSort: (key: TxnSort) => void;
	onReachEnd?: () => void;
	loading?: boolean;
}

interface ColumnDef {
	key: string;
	label: string;
	sort: TxnSort;
	resizable: boolean;
	align?: "end";
}

const COLUMNS: ColumnDef[] = [
	{ key: "desc", label: "Description", sort: "date", resizable: false },
	{ key: "counterparty", label: "Counterparty", sort: "counterparty", resizable: true },
	{ key: "date", label: "Date", sort: "date", resizable: true },
	{ key: "amount", label: "Amount", sort: "amount", resizable: true, align: "end" },
];

function loadWidths(): Record<string, number> {
	const raw = readStored("local", LocalKeys.WALLET_COLUMNS);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, number>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function TransactionTable(props: TransactionTableProps): JSX.Element {
	const { items, sortKey, sortDir, onSort, onReachEnd, loading } = props;
	const widths = useSignal<Record<string, number>>({
		counterparty: 200,
		date: 150,
		amount: 150,
		...loadWidths(),
	});
	const viewportRef = useRef<HTMLDivElement>(null);
	const resizeState = useRef<{ key: string; startX: number; startW: number } | null>(null);

	const rowH = listRowHeight(zoom.value);
	const vs = useVirtualScroll({
		count: items.length,
		itemSize: rowH,
		useWindow: true,
		parentRef: viewportRef,
		overscan: 8,
		onReachEnd,
		getItemKey: (i) => items[i]?.id ?? i,
	});

	const gridTemplate =
		`minmax(220px, 1fr) ${widths.value.counterparty}px ${widths.value.date}px ${widths.value.amount}px`;

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
		const next = Math.max(96, Math.min(360, r.startW + (e.clientX - r.startX)));
		widths.value = { ...widths.value, [r.key]: next };
	};
	const onResizeUp = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
		if (!resizeState.current) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		resizeState.current = null;
		writeStored("local", LocalKeys.WALLET_COLUMNS, JSON.stringify(widths.value));
	};
	// #endregion

	function sortIndicator(col: ColumnDef): JSX.Element {
		const active = sortKey.value === col.sort;
		return (
			<span class="wallet-th__sort" data-active={active ? "true" : undefined} aria-hidden="true">
				{active ? (sortDir.value === "asc" ? "▲" : "▼") : "⇅"}
			</span>
		);
	}

	return (
		<div
			class="wallet-table"
			style={`--wt-cols:${gridTemplate};--wt-rowh:${rowH}px`}
			role="table"
			aria-label="Transactions"
			aria-rowcount={items.length + 1}
			aria-colcount={COLUMNS.length}
		>
			<div class="wallet-table__head" role="row">
				{COLUMNS.map((col) => (
					<div
						key={col.key}
						class="wallet-th"
						role="columnheader"
						data-align={col.align}
						aria-sort={sortKey.value === col.sort
							? (sortDir.value === "asc" ? "ascending" : "descending")
							: "none"}
					>
						<button type="button" class="wallet-th__btn" onClick={() => onSort(col.sort)}>
							<span class="wallet-th__label">{col.label}</span>
							{sortIndicator(col)}
						</button>
						{col.resizable && (
							<span
								class="wallet-th__resize"
								role="separator"
								aria-orientation="vertical"
								aria-label={`Resize ${col.label} column`}
								tabIndex={0}
								onPointerDown={onResizeDown(col.key)}
								onPointerMove={onResizeMove}
								onPointerUp={onResizeUp}
							/>
						)}
					</div>
				))}
			</div>

			<div class="wallet-table__body" ref={viewportRef} role="rowgroup">
				<div class="wallet-table__sizer" role="presentation" style={`height:${vs.totalSize}px`}>
					{vs.virtualItems.map((vi) => {
						const line = items[vi.index];
						if (!line) return null;
						const sign = line.direction === "credit" ? "+" : "−";
						const row = (
							<>
								<div class="wallet-cell wallet-cell--desc" role="cell">
									<span class="wallet-row__glyph" data-dir={line.direction} aria-hidden="true">
										<WalletIcon
											name={line.direction === "credit" ? "funding" : "payout"}
											size={15}
										/>
									</span>
									<span class="wallet-row__title" title={line.title}>{line.title}</span>
									<FundStateChip state={line.fundState} class="wallet-row__chip" />
								</div>
								<div class="wallet-cell wallet-cell--cp" role="cell">
									{line.counterpartyHandle
										? (
											<a class="wallet-row__cp" href={`/@${line.counterpartyHandle}`}>
												{line.counterparty}
											</a>
										)
										: <span class="wallet-row__cp">{line.counterparty ?? "—"}</span>}
								</div>
								<div class="wallet-cell wallet-cell--date" role="cell">{line.dateLabel}</div>
								<div class="wallet-cell wallet-cell--amt" role="cell" data-dir={line.direction}>
									{sign}
									<Money value={line.amount} />
								</div>
							</>
						);
						return (
							<div
								key={line.id}
								class="wallet-row"
								role="row"
								data-index={vi.index}
								style={`--v-start:${vi.start}px`}
							>
								{line.href
									? <a class="wallet-row__link" href={line.href} aria-label={line.title}>{row}</a>
									: <div class="wallet-row__link">{row}</div>}
							</div>
						);
					})}
				</div>
				{loading && (
					<div class="wallet-table__loader" role="status" aria-live="polite">
						<span class="wallet-spinner" aria-hidden="true" />
						<span class="ui-visually-hidden">Loading more…</span>
					</div>
				)}
			</div>
		</div>
	);
}
