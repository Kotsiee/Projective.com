import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { CashflowChart } from "../components/CashflowChart.tsx";
import { BurnDownChart } from "../components/BurnDownChart.tsx";
import { Money, SectionCard } from "../components/wallet-bits.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import { categoryLabel } from "../core/wallet-model.ts";
import type { ActivityRange, ActivityView, CategorySlice } from "../types/wallet-types.ts";

/**
 * WalletActivityScreen — where the charts live (`/wallet/activity`), kept off the calm overview: totals,
 * in-vs-out (a `d3-scale` cashflow chart, Decision #1), a by-category breakdown, a by-project list, and
 * the role-specific series (a freelancer's locked capital + projected income, a business's budget
 * burn-down). THIN: first paint from SSR; the range selector + dev axes refetch. Charts are token-only so
 * they read correctly in light and dark.
 */
export interface WalletActivityScreenProps {
	initial: ActivityView;
	wallet: string;
	display: string;
}

const RANGES: { value: ActivityRange; label: string }[] = [
	{ value: "30d", label: "30 days" },
	{ value: "90d", label: "90 days" },
	{ value: "12m", label: "12 months" },
];

export default function WalletActivityScreen(props: WalletActivityScreenProps): JSX.Element {
	const activity = useSignal<ActivityView>(props.initial);
	const range = useSignal<ActivityRange>(props.initial.range);

	async function reload(): Promise<void> {
		const res = await WalletService.activity(currentWalletContext(), range.value);
		if (res.ok && res.data) activity.value = res.data.activity;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	function setRange(r: ActivityRange): void {
		range.value = r;
		void reload();
	}

	const a = activity.value;
	return (
		<div class="wallet-page wallet-activity">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Activity</h1>
				<div class="wallet-range" role="group" aria-label="Activity range">
					{RANGES.map((r) => (
						<button
							key={r.value}
							type="button"
							class="wallet-range__btn"
							data-on={range.value === r.value ? "true" : undefined}
							aria-pressed={range.value === r.value}
							onClick={() => setRange(r.value)}
						>
							{r.label}
						</button>
					))}
				</div>
			</header>

			<div class="wallet-activity__tiles">
				<Tile label="Money in" value={a.totalIn.display} tone="in" />
				<Tile label="Money out" value={a.totalOut.display} tone="out" />
				<Tile label="Net" value={a.net.display} tone={a.net.minor >= 0 ? "in" : "out"} />
				{a.lockedCapital && (
					<Tile label="Locked capital" value={a.lockedCapital.display} tone="neutral" />
				)}
				{a.projectedIncome && (
					<Tile label="Projected income" value={a.projectedIncome.display} tone="neutral" />
				)}
			</div>

			<SectionCard title="In & out" class="wallet-activity__chart">
				<div class="wallet-chartwrap">
					<CashflowChart points={a.flow} />
				</div>
				<div class="wallet-chartlegend" aria-hidden="true">
					<span data-k="in">Money in</span>
					<span data-k="out">Money out</span>
				</div>
			</SectionCard>

			{a.burnDown && (
				<SectionCard
					title={a.burnDown.label}
					class="wallet-activity__chart"
					action={
						<span
							class="wallet-badge"
							data-tone={a.burnDown.utilizationBp >= 10000 ? "danger" : "info"}
						>
							{Math.round(a.burnDown.utilizationBp / 100)}% used
						</span>
					}
				>
					<div class="wallet-chartwrap">
						<BurnDownChart data={a.burnDown} />
					</div>
				</SectionCard>
			)}

			<div class="wallet-activity__split">
				{a.byCategory.length > 0 && (
					<SectionCard title="By category" class="wallet-activity__cats">
						<ul class="wallet-cats__list">
							{a.byCategory.map((c) => <CategoryRow key={c.category} slice={c} />)}
						</ul>
					</SectionCard>
				)}
				{a.byProject.length > 0 && (
					<SectionCard title="By project" class="wallet-activity__projects">
						<ul class="wallet-projflow">
							{a.byProject.map((p) => (
								<li key={p.id} class="wallet-projflow__row">
									<a class="wallet-projflow__name" href={`/projects/${p.id}`}>{p.name}</a>
									<Money value={p.amount} class="wallet-projflow__amt" />
								</li>
							))}
						</ul>
					</SectionCard>
				)}
			</div>
		</div>
	);
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }): JSX.Element {
	return (
		<div class="wallet-tile" data-tone={tone}>
			<span class="wallet-tile__label">{label}</span>
			<span class="wallet-tile__value">{value}</span>
		</div>
	);
}

function CategoryRow({ slice }: { slice: CategorySlice }): JSX.Element {
	const pct = Math.round(slice.shareBp / 100);
	return (
		<li class="wallet-cats__row">
			<span class="wallet-cats__label">{categoryLabel(slice.category)}</span>
			<span class="wallet-cats__bar" aria-hidden="true">
				<span class="wallet-cats__fill" style={`inline-size:${pct}%`} data-cat={slice.category} />
			</span>
			<span class="wallet-cats__amt">
				<Money value={slice.amount} />
			</span>
		</li>
	);
}
