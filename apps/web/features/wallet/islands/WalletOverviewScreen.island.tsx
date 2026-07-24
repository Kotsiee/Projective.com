import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { BalanceHero } from "../components/BalanceHero.tsx";
import { FlowSparkline } from "../components/FlowSparkline.tsx";
import { PersonalExtras } from "../components/PersonalExtras.tsx";
import { TeamSplitCard } from "../components/TeamSplitCard.tsx";
import { BusinessOverview } from "../components/BusinessOverview.tsx";
import { Money, SectionCard } from "../components/wallet-bits.tsx";
import { ChevronIcon, WalletIcon } from "../components/wallet-glyphs.tsx";
import { WalletService } from "../core/WalletService.ts";
import { actionMeta } from "../core/wallet-model.ts";
import { currentWalletContext, flowBuckets, openWalletAction } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type {
	IncomingItem,
	LedgerLine,
	WalletAction,
	WalletOverview,
} from "../types/wallet-types.ts";

/**
 * WalletOverviewScreen — the calm Overview hub body (`/wallet`). The shared spine (BalanceHero
 * three-state + verification gate + money on the way + a 30/60/90 in-out sparkline + 5 recent lines +
 * capability-gated quick actions) plus the active wallet's variant extras (personal · team · business).
 * THIN: first paint from SSR; it refetches only when a dev axis (currency / role / KYC / fund mix)
 * changes (Decision #48 pattern). Everything analytical is one click deeper — no wall of graphs here.
 */
export interface WalletOverviewScreenProps {
	initial: WalletOverview;
	wallet: string;
	display: string;
}

export default function WalletOverviewScreen(props: WalletOverviewScreenProps): JSX.Element {
	const overview = useSignal<WalletOverview>(props.initial);

	const refetch = async () => {
		const res = await WalletService.overview(currentWalletContext());
		if (res.ok && res.data) overview.value = res.data.overview;
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const o = overview.value;
	const v = o.verification;

	return (
		<div class="wallet-overview">
			<BalanceHero
				available={o.available}
				locked={o.locked}
				pending={o.pending}
				onHold={o.onHold}
				lifetime={o.lifetime}
				caption={o.ref.name}
			/>

			{v.prompt && (
				<div class="wallet-verify" role="status" data-locked="true">
					<span class="wallet-verify__glyph" aria-hidden="true">
						<WalletIcon name="access" size={20} />
					</span>
					<p class="wallet-verify__text">{v.prompt}</p>
					{v.href && (
						<a class="wallet-btn wallet-btn--primary wallet-verify__cta" href={v.href}>
							Finish verification
						</a>
					)}
				</div>
			)}

			<QuickActions actions={o.quickActions} />

			<div class="wallet-overview__grid">
				<div class="wallet-overview__col">
					{o.incoming.length > 0 && (
						<SectionCard title="On the way" class="wallet-incoming">
							<ul class="wallet-incoming__list">
								{o.incoming.map((it) => <IncomingRow key={it.id} item={it} />)}
							</ul>
						</SectionCard>
					)}

					<SectionCard
						title="In & out"
						class="wallet-flowcard"
						action={<FlowLegend />}
					>
						<FlowSparkline points={o.flow} take={flowBuckets.value} />
					</SectionCard>

					<SectionCard
						title="Recent activity"
						class="wallet-recent"
						action={
							<a class="wallet-link" href="/wallet/transactions">
								All transactions <ChevronIcon size={14} />
							</a>
						}
					>
						{o.recent.length === 0
							? <p class="wallet-empty-note">No transactions yet.</p>
							: (
								<ul class="wallet-recent__list">
									{o.recent.map((l) => <RecentRow key={l.id} line={l} />)}
								</ul>
							)}
					</SectionCard>
				</div>

				<div class="wallet-overview__col wallet-overview__col--extras">
					{o.variant === "personal" && o.personal && (
						<PersonalExtras
							data={o.personal}
							onEnrolSmoother={() => openWalletAction("enrol_smoother")}
						/>
					)}
					{o.variant === "team" && o.team && <TeamSplitCard data={o.team} />}
					{o.variant === "business" && o.business && <BusinessOverview data={o.business} />}
				</div>
			</div>
		</div>
	);
}

// #region Quick actions
function QuickActions({ actions }: { actions: WalletAction[] }): JSX.Element {
	if (actions.length === 0) return <div />;
	return (
		<div class="wallet-actions" role="group" aria-label="Quick actions">
			{actions.map((a) => {
				const m = actionMeta(a);
				return (
					<button
						key={a}
						type="button"
						class="wallet-actions__btn"
						onClick={() => openWalletAction(a)}
					>
						<span class="wallet-actions__icon" aria-hidden="true">
							<WalletIcon name={m.icon} size={18} />
						</span>
						<span class="wallet-actions__label">{m.label}</span>
					</button>
				);
			})}
		</div>
	);
}
// #endregion

// #region Rows
function IncomingRow({ item }: { item: IncomingItem }): JSX.Element {
	const body = (
		<>
			<span class="wallet-incoming__glyph" data-state={item.state} aria-hidden="true">
				<WalletIcon
					name={item.kind === "payout" ? "payout" : item.kind === "deposit" ? "funding" : "escrow"}
					size={16}
				/>
			</span>
			<span class="wallet-incoming__meta">
				<span class="wallet-incoming__label">{item.label}</span>
				<span class="wallet-incoming__clearing">{item.clearingLabel}</span>
			</span>
			<Money value={item.amount} class="wallet-incoming__amt" />
		</>
	);
	return (
		<li class="wallet-incoming__row">
			{item.href
				? <a class="wallet-incoming__link" href={item.href}>{body}</a>
				: <div class="wallet-incoming__link">{body}</div>}
		</li>
	);
}

function RecentRow({ line }: { line: LedgerLine }): JSX.Element {
	const sign = line.direction === "credit" ? "+" : "−";
	const body = (
		<>
			<span class="wallet-recent__glyph" data-dir={line.direction} aria-hidden="true">
				<WalletIcon name={line.direction === "credit" ? "funding" : "payout"} size={15} />
			</span>
			<span class="wallet-recent__meta">
				<span class="wallet-recent__title">{line.title}</span>
				<span class="wallet-recent__date">{line.dateLabel}</span>
			</span>
			<span class="wallet-recent__amt" data-dir={line.direction}>
				{sign}
				<Money value={line.amount} />
			</span>
		</>
	);
	return (
		<li class="wallet-recent__row">
			{line.href
				? <a class="wallet-recent__link" href={line.href}>{body}</a>
				: <div class="wallet-recent__link">{body}</div>}
		</li>
	);
}

function FlowLegend(): JSX.Element {
	return (
		<span class="wallet-flowlegend" aria-hidden="true">
			<span class="wallet-flowlegend__item" data-k="in">In</span>
			<span class="wallet-flowlegend__item" data-k="out">Out</span>
		</span>
	);
}
// #endregion
