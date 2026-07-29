import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import { FundStateDot, fundStateLabel } from "../components/FundStateMark.tsx";
import { Money } from "../components/Money.tsx";
import {
	categoryLabel,
	groupByDay,
	isDisputeReason,
	LEDGER_COLUMNS,
	reasonLabel,
} from "../core/ledger-model.ts";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, drawerLine } from "../core/wallet-state.ts";
import { listRowHeight, zoom } from "../core/view-state.ts";
import type { LedgerLine, TransactionPage, TxnSort } from "../types/wallet-types.ts";

/**
 * LedgerTable — the full ledger at 100% of the content region.
 *
 * A ledger is the one artefact on this surface a user reads ACROSS: date, who, what kind, what
 * state, how much. Cropping it into a centred column is what the redesign removes, so there is no
 * `max-inline-size` anywhere in this component or its stylesheet.
 *
 * Sorting is three-state on a single column — asc → desc → **none**. "None" clears the key so the
 * backend's own default order returns, which is a real state a user wants back and which a
 * two-state toggle can never reach. Multi-sort is deliberately off: on a financial table it produces
 * orderings nobody can explain from the header row alone.
 *
 * Paging is an `IntersectionObserver` sentinel rather than a virtualizer callback, because an
 * observer fires from layout while a scroll-position callback does not fire at all in a backgrounded
 * tab.
 */
export interface LedgerTableProps {
	page: TransactionPage;
	scope: string;
	display: string;
}

export default function LedgerTable(props: LedgerTableProps): JSX.Element {
	const lines = useSignal<LedgerLine[]>(props.page.items);
	const cursor = useSignal<string | null>(props.page.nextCursor);
	const hasMore = useSignal<boolean>(props.page.hasMore);
	const loading = useSignal<boolean>(false);
	const sortKey = useSignal<TxnSort | "">("");
	const sortDir = useSignal<"asc" | "desc">("desc");
	const sentinel = useRef<HTMLDivElement>(null);

	// A fresh SSR page (a wallet or currency switch) replaces the accumulated list wholesale.
	useEffect(() => {
		lines.value = props.page.items;
		cursor.value = props.page.nextCursor;
		hasMore.value = props.page.hasMore;
	}, [props.page]);

	const loadMore = async () => {
		if (loading.value || !hasMore.value) return;
		loading.value = true;
		const res = await WalletService.transactions(currentWalletContext(), {
			limit: 40,
			cursor: cursor.value,
			...(sortKey.value ? { sort: sortKey.value, dir: sortDir.value } : {}),
		});
		if (res.ok && res.data) {
			lines.value = [...lines.value, ...res.data.page.items];
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
		loading.value = false;
	};

	useEffect(() => {
		const el = sentinel.current;
		if (!el || typeof IntersectionObserver === "undefined") return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) void loadMore();
			},
			{ rootMargin: "800px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	/** asc → desc → none. The third state is the point; see the class doc. */
	const cycleSort = async (key: TxnSort) => {
		if (sortKey.value !== key) {
			sortKey.value = key;
			sortDir.value = "asc";
		} else if (sortDir.value === "asc") {
			sortDir.value = "desc";
		} else {
			sortKey.value = "";
		}
		loading.value = true;
		const res = await WalletService.transactions(currentWalletContext(), {
			limit: 40,
			...(sortKey.value ? { sort: sortKey.value, dir: sortDir.value } : {}),
		});
		if (res.ok && res.data) {
			lines.value = res.data.page.items;
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
		loading.value = false;
	};

	const groups = groupByDay(lines.value);
	const rowh = listRowHeight(zoom.value);
	const cols = LEDGER_COLUMNS.map((c) => `${c.width}px`).join(" ");

	return (
		<div
			class="wlt-ledger"
			style={styleVars({ "--wlt-ledger-cols": cols, "--wlt-rowh-cur": `${rowh}px` })}
		>
			<div class="wlt-ledger__head" role="row">
				{LEDGER_COLUMNS.map((c) => (
					<div class="wlt-ledger__headcell" key={c.key} data-align={c.align} role="columnheader">
						{c.sortable
							? (
								<button
									type="button"
									class="wlt-ledger__sortbtn"
									data-sorted={sortKey.value === c.key ? sortDir.value : "none"}
									aria-sort={sortKey.value === c.key
										? (sortDir.value === "asc" ? "ascending" : "descending")
										: "none"}
									onClick={() => void cycleSort(c.key as TxnSort)}
								>
									{c.label}
									<span class="wlt-ledger__sortmark" aria-hidden="true" />
								</button>
							)
							: <span>{c.label}</span>}
					</div>
				))}
			</div>

			<div class="wlt-ledger__body">
				{groups.map((group) => (
					<div class="wlt-ledger__group" key={group.key}>
						<div class="wlt-ledger__grouphead">{group.label}</div>
						{group.lines.map((line) => {
							const dispute = isDisputeReason(line.reason);
							return (
								<div
									class="wlt-ledger__row"
									key={line.id}
									role="row"
									tabIndex={0}
									onClick={() => {
										drawerLine.value = line;
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											drawerLine.value = line;
										}
									}}
								>
									<div class="wlt-ledger__cell wlt-ledger__cell--date">{line.dateLabel}</div>
									<div class="wlt-ledger__cell wlt-ledger__cell--title">
										<span class="wlt-ledger__linetitle">{line.title}</span>
										<span class="wlt-ledger__counterparty">
											{line.counterpartyHandle
												? `@${line.counterpartyHandle}`
												: line.counterparty ?? reasonLabel(line.reason)}
										</span>
									</div>
									<div class="wlt-ledger__cell wlt-ledger__cell--category">
										<span class="wlt-ledger__chip" data-dispute={dispute ? "true" : "false"}>
											{dispute ? reasonLabel(line.reason) : categoryLabel(line.category)}
										</span>
									</div>
									<div class="wlt-ledger__cell wlt-ledger__cell--state">
										<Tooltip content={fundStateLabel(line.fundState)} placement="top">
											<span role="img" aria-label={fundStateLabel(line.fundState)}>
												<FundStateDot state={line.fundState} />
											</span>
										</Tooltip>
									</div>
									<div class="wlt-ledger__cell wlt-ledger__cell--amount">
										<Money
											value={line.amount}
											size="body"
											tone={line.direction === "credit" ? "credit" : "debit"}
											sign={line.direction === "credit" ? "+" : "−"}
										/>
									</div>
								</div>
							);
						})}
					</div>
				))}
			</div>

			<div class="wlt-ledger__sentinel" ref={sentinel} aria-hidden="true" />
			{loading.value && <p class="wlt-ledger__tail" role="status">Loading more…</p>}
		</div>
	);
}
