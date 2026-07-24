import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/wallet.css";
import { InputText, Select } from "@projective/ui/fields";
import { TransactionTable } from "../components/TransactionTable.tsx";
import { ExportIcon, WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import { categoryLabel } from "../core/wallet-model.ts";
import type {
	LedgerLine,
	TransactionListParams,
	TransactionPage,
	TxnCategory,
	TxnSort,
} from "../types/wallet-types.ts";

/**
 * WalletTransactionsScreen — the full ledger (`/wallet/transactions`): a filter header (search · type ·
 * category · fund state · project) + a CSV export + the virtualized {@link TransactionTable}. THIN: first
 * paint from SSR; filters/sort/paging refine through the API. Row zoom is the shared footer rig. Refetches
 * when a dev axis or a money mutation changes. The CSV export is a user-initiated client download of the
 * loaded rows (no server round-trip).
 */
export interface WalletTransactionsScreenProps {
	initial: TransactionPage;
	wallet: string;
	display: string;
}

const CATEGORIES: TxnCategory[] = [
	"earning",
	"payout",
	"deposit",
	"withdrawal",
	"fee",
	"refund",
	"escrow",
	"transfer",
	"spend",
];

export default function WalletTransactionsScreen(
	props: WalletTransactionsScreenProps,
): JSX.Element {
	const items = useSignal<LedgerLine[]>(props.initial.items);
	const cursor = useSignal<string | null>(props.initial.nextCursor);
	const hasMore = useSignal<boolean>(props.initial.hasMore);
	const total = useSignal<number>(props.initial.total);
	const projects = useSignal(props.initial.projects);
	const loading = useSignal(false);
	const loadingMore = useSignal(false);

	const q = useSignal("");
	const direction = useSignal<string>("");
	const category = useSignal<string>("");
	const fundState = useSignal<string>("");
	const project = useSignal<string>("");
	const sortKey = useSignal<string>("date");
	const sortDir = useSignal<"asc" | "desc">("desc");

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);

	function params(cur: string | null): TransactionListParams {
		return {
			search: q.value || undefined,
			direction: (direction.value || undefined) as TransactionListParams["direction"],
			category: (category.value || undefined) as TransactionListParams["category"],
			fundState: (fundState.value || undefined) as TransactionListParams["fundState"],
			project: project.value || undefined,
			sort: sortKey.value as TxnSort,
			dir: sortDir.value,
			cursor: cur,
			limit: 40,
		};
	}

	async function reload(): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		const res = await WalletService.transactions(currentWalletContext(), params(null));
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			items.value = res.data.page.items;
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
			total.value = res.data.page.total;
			projects.value = res.data.page.projects;
		}
	}

	async function loadMore(): Promise<void> {
		if (loadingMore.value || loading.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await WalletService.transactions(currentWalletContext(), params(cursor.value));
		loadingMore.value = false;
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			items.value = [...items.value, ...res.data.page.items];
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
	}

	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	function onSearch(v: string): void {
		q.value = v;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void reload(), 260) as unknown as number;
	}

	function onColumnSort(key: TxnSort): void {
		if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
		else {
			sortKey.value = key;
			sortDir.value = key === "amount" || key === "date" ? "desc" : "asc";
		}
		void reload();
	}

	function exportCsv(): void {
		const rows = [
			["Date", "Description", "Counterparty", "Direction", "Amount", "Currency", "State"],
			...items.value.map((l) => [
				l.dateLabel,
				l.title,
				l.counterparty ?? "",
				l.direction,
				String(l.amount.minor / 100),
				l.amount.currency,
				l.fundState,
			]),
		];
		const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join(
			"\n",
		);
		try {
			const blob = new Blob([csv], { type: "text/csv" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "transactions.csv";
			a.click();
			URL.revokeObjectURL(url);
		} catch { /* no window */ }
	}

	return (
		<div class="wallet-page wallet-txns">
			<header class="wallet-page__head">
				<div class="wallet-txns__filters">
					<InputText
						value={q}
						onValueChange={onSearch}
						placeholder="Search transactions"
						type="search"
						start={<WalletIcon name="ledger" size={16} />}
						variant="bare"
						block
						aria-label="Search transactions"
					/>
					<Select
						value={direction}
						options={[{ label: "All", value: "" }, { label: "In", value: "credit" }, {
							label: "Out",
							value: "debit",
						}]}
						onValueChange={() => void reload()}
						size="sm"
						aria-label="Direction"
					/>
					<Select
						value={category}
						options={[
							{ label: "All types", value: "" },
							...CATEGORIES.map((c) => ({ label: categoryLabel(c), value: c })),
						]}
						onValueChange={() => void reload()}
						size="sm"
						aria-label="Category"
					/>
					<Select
						value={fundState}
						options={[
							{ label: "Any state", value: "" },
							{ label: "Available", value: "available" },
							{ label: "In escrow", value: "locked" },
							{ label: "Clearing", value: "pending" },
							{ label: "On hold", value: "on_hold" },
						]}
						onValueChange={() => void reload()}
						size="sm"
						aria-label="Fund state"
					/>
					<Select
						value={project}
						options={[
							{ label: "All projects", value: "" },
							...projects.value.map((p) => ({ label: p.name, value: p.id })),
						]}
						onValueChange={() => void reload()}
						size="sm"
						aria-label="Project"
					/>
				</div>
				<div class="wallet-txns__tools">
					<span class="wallet-txns__count" aria-live="polite">{total.value} transactions</span>
					<button type="button" class="wallet-btn wallet-btn--ghost" onClick={exportCsv}>
						<ExportIcon size={16} /> Export
					</button>
				</div>
			</header>

			<div class="wallet-txns__workspace" aria-busy={loading.value ? "true" : undefined}>
				{items.value.length === 0
					? <p class="wallet-empty-note" role="status">No transactions match your filters.</p>
					: (
						<TransactionTable
							items={items.value}
							sortKey={sortKey}
							sortDir={sortDir}
							onSort={onColumnSort}
							onReachEnd={loadMore}
							loading={loadingMore.value}
						/>
					)}
			</div>
		</div>
	);
}
