import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Band, BandHead, EmptyBand, PageHead, WalletErrorBand } from "../components/band-parts.tsx";
import { FlowBand } from "../components/FlowBand.tsx";
import { BurnDownPanel } from "../components/BurnDownPanel.tsx";
import { Money } from "../components/Money.tsx";
import { buildCategoryBars, buildProjectBars } from "../core/category-chart.ts";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, flowPeriod, walletError } from "../core/wallet-state.ts";
import { applyRead, useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import { styleVars } from "@ui/core/style.ts";
import type { ActivityView } from "../types/wallet-types.ts";

/**
 * WalletActivityScreen — where the analysis lives (`/wallet/activity`).
 *
 * Three full-bleed bands, no cards. The two breakdowns are HORIZONTAL BAR LISTS rather than donuts:
 * a marketplace answers "how much" before "what shape", and a donut here is the neobank tell (§6.2).
 * Every chart carries a `role="img"` summary and a visually-hidden data table — a chart no screen
 * reader can read is not accessible, and this is a financial surface.
 */
export interface WalletActivityScreenProps {
	initial: ActivityView;
	wallet: string;
	display: string;
}

export default function WalletActivityScreen(props: WalletActivityScreenProps): JSX.Element {
	const activity = useSignal<ActivityView>(props.initial);

	const refetch = async () => {
		const range = flowPeriod.value === "30d" ? "30d" : "90d";
		const res = await WalletService.activity(currentWalletContext(), range);
		applyRead(res, (d) => {
			activity.value = d.activity;
		});
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const a = activity.value;
	// The bar lists are laid out in a 100×N coordinate space so `--wlt-fill` can be a percentage.
	const categories = buildCategoryBars(a.byCategory, 100, a.byCategory.length * 100);
	const projects = buildProjectBars(a.byProject, 100, a.byProject.length * 100);

	return (
		<main class="wlt" aria-label="Activity">
			<div class="wlt__stack">
				<WalletErrorBand message={walletError.value} />
				<Band tone="head" index={0} label="Activity">
					<PageHead
						title="Activity"
						meta={
							<>
								<span>
									In <Money value={a.totalIn} size="body" tone="credit" showFx={false} />
								</span>
								<span>
									Out <Money value={a.totalOut} size="body" tone="debit" showFx={false} />
								</span>
								<span>
									Net <Money value={a.net} size="body" showFx={false} />
								</span>
							</>
						}
					/>
				</Band>

				{
					/*
					 * `FlowBand` renders its OWN `Band` and `BandHead`. Wrapping it in a second pair put a
					 * `<section class="wlt-band">` inside a `<section class="wlt-band">` and printed the
					 * heading twice — "Money in vs out" directly above "Money in vs out · last 90 days".
					 */
				}
				<FlowBand
					flow={a.flow}
					range={a.range === "12m" ? "90d" : a.range}
					id="wlt-act-chart"
					index={1}
				/>

				<Band tone="intel" index={2} titleId="wlt-act-cat">
					<BandHead id="wlt-act-cat" title="Spend by category" />
					{categories.length === 0
						? <EmptyBand text="Nothing categorised in this window yet." />
						: (
							<ul class="wlt-barlist" role="list">
								{categories.map((row) => (
									<li class="wlt-barlist__row" key={row.key}>
										<span class="wlt-barlist__label">{row.label}</span>
										<span class="wlt-barlist__amount wlt-num">{row.amount.display}</span>
										<span class="wlt-barlist__share wlt-num">{row.sharePct}</span>
										<span
											class="wlt-barlist__bar"
											style={styleVars({ "--wlt-fill": row.sharePct })}
											aria-hidden="true"
										/>
									</li>
								))}
							</ul>
						)}
				</Band>

				<Band tone="ledger" index={3} titleId="wlt-act-proj">
					<BandHead id="wlt-act-proj" title="Spend by project" />
					{projects.length === 0
						? <EmptyBand text="No project-attributed movement in this window." />
						: (
							<ul class="wlt-barlist" role="list">
								{projects.map((row) => (
									<li class="wlt-barlist__row" key={row.key}>
										<a class="wlt-barlist__label wlt-link" href={row.href ?? "#"}>{row.label}</a>
										<span class="wlt-barlist__amount wlt-num">{row.amount.display}</span>
										<span class="wlt-barlist__share wlt-num">{row.sharePct}</span>
										<span
											class="wlt-barlist__bar"
											style={styleVars({ "--wlt-fill": row.sharePct })}
											aria-hidden="true"
										/>
									</li>
								))}
							</ul>
						)}
				</Band>

				{a.burnDown && (
					<Band tone="intel" index={4} titleId="wlt-act-burn">
						<BandHead id="wlt-act-burn" title="Budget burn-down" />
						<BurnDownPanel burn={a.burnDown} />
					</Band>
				)}
			</div>
		</main>
	);
}
