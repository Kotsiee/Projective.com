import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Meter, Money, SectionCard } from "./wallet-bits.tsx";
import { BurnDownChart } from "./BurnDownChart.tsx";
import { WalletIcon } from "./wallet-glyphs.tsx";
import type { BusinessExtras } from "../types/wallet-types.ts";

/**
 * BusinessOverview — the business-wallet Overview's variant block: the budget burn-down as the primary
 * chart, per-PM/department spending caps with utilization bars, and an invoices-due summary. Figures are
 * server-derived; the block only renders them + the cap meters.
 */
export interface BusinessOverviewProps {
	data: BusinessExtras;
}

export function BusinessOverview({ data }: BusinessOverviewProps): JSX.Element {
	const { burnDown, caps } = data;
	return (
		<div class="wallet-extras">
			<SectionCard
				title={burnDown.label}
				class="wallet-burncard"
				action={
					<span
						class="wallet-badge"
						data-tone={burnDown.utilizationBp >= 10000 ? "danger" : "info"}
					>
						{Math.round(burnDown.utilizationBp / 100)}% used
					</span>
				}
			>
				<div class="wallet-burncard__figures">
					<span class="wallet-figure">
						<span class="wallet-figure__label">Spent</span>
						<Money value={burnDown.spent} class="wallet-figure__value" />
					</span>
					<span class="wallet-figure">
						<span class="wallet-figure__label">Remaining</span>
						<Money value={burnDown.remaining} class="wallet-figure__value" />
					</span>
					<span class="wallet-figure">
						<span class="wallet-figure__label">Budget</span>
						<Money value={burnDown.budget} muted class="wallet-figure__value" />
					</span>
				</div>
				<BurnDownChart data={burnDown} compact />
			</SectionCard>

			{caps.length > 0 && (
				<SectionCard title="Spending caps" class="wallet-caps">
					<ul class="wallet-caps__list">
						{caps.map((c) => (
							<li key={c.id} class="wallet-caps__row">
								<a
									class="wallet-caps__who"
									href={c.memberHandle ? `/@${c.memberHandle}` : undefined}
								>
									<Avatar image={c.avatar ?? undefined} label={c.memberName} size={26} alt="" />
									<span class="wallet-caps__name">{c.memberName}</span>
								</a>
								<Meter
									ratioBp={c.utilizationBp}
									label={`${c.memberName} cap`}
									class="wallet-caps__meter"
								/>
								<span class="wallet-caps__amt">
									<Money value={c.spent} />{" "}
									<span class="wallet-caps__of">
										/ <Money value={c.cap} muted />
									</span>
								</span>
							</li>
						))}
					</ul>
				</SectionCard>
			)}

			{data.invoicesDue > 0 && (
				<SectionCard class="wallet-invdue">
					<a class="wallet-invdue__row" href="/wallet/invoices">
						<span class="wallet-invdue__glyph" aria-hidden="true">
							<WalletIcon name="invoice" size={18} />
						</span>
						<span class="wallet-invdue__text">
							{data.invoicesDue} invoices due{data.invoicesDueAmount && (
								<>
									· <Money value={data.invoicesDueAmount} />
								</>
							)}
						</span>
						<span class="wallet-invdue__cta">Review →</span>
					</a>
				</SectionCard>
			)}
		</div>
	);
}
