import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { type CurrentPlan, formatMoney, type PlanOffer } from "@projective/types/finance";
import { SettingsBlock } from "../../SettingsParts.tsx";
import { longDate } from "../../../core/settings-dates.ts";

/** Props for {@link PlanBlock}. */
export interface PlanBlockProps {
	plan: CurrentPlan | null;
	locale: string;
}

const INTERVAL: Readonly<Record<PlanOffer["billingInterval"], string>> = {
	monthly: "a month",
	annual: "a year",
	custom: "",
};

/** `£12.99 a month`, `Free`, or `Priced for you`. */
function priceLine(offer: PlanOffer, locale: string): string {
	if (offer.isCustomPriced || offer.priceCents === null) return "Priced for you";
	if (offer.priceCents === 0) return "Free";
	const price = formatMoney(offer.priceCents, offer.currency, locale);
	const per = INTERVAL[offer.billingInterval];
	return per ? `${price} ${per}` : price;
}

/** What the held plan's state means for the person, or `null` when there is nothing to say. */
function stateLine(plan: CurrentPlan, locale: string): string | null {
	const on = plan.renewsAt ? longDate(plan.renewsAt, locale) : null;
	switch (plan.state) {
		case "past_due":
			return "The last payment failed. Update the card it's paid with to keep this plan.";
		case "paused":
			return "This plan is paused.";
		case "trialing":
			return on ? `Your trial ends on ${on}.` : "You're on a trial.";
		case "active":
			if (!on) return null;
			return plan.cancelAtPeriodEnd ? `This plan ends on ${on}.` : `Renews on ${on}.`;
		default:
			return null;
	}
}

/**
 * Plan — the subscription placeholder: the plan held (or the free plan every account has), its state
 * and renewal, and the individual plans side by side. Read-only until plan checkout exists, and it
 * says so rather than offering an upgrade button that could do nothing.
 */
export function PlanBlock(props: PlanBlockProps): JSX.Element {
	const { plan } = props;
	return (
		<SettingsBlock
			anchor="plan"
			title="Plan"
			description="Your plan raises what you can do on Projective. Your Standing is always earned, never bought."
		>
			{plan === null
				? <InlineNotice align="start" text="Your plan couldn't be read just now." />
				: (
					<>
						<dl class="stg-facts">
							<div class="stg-facts__row">
								<dt>Current plan</dt>
								<dd>
									{plan.current.label}
									{priceLine(plan.current, props.locale) !== plan.current.label
										? (
											<span class="stg-facts__note stg-tabular">
												{priceLine(plan.current, props.locale)}
											</span>
										)
										: null}
								</dd>
							</div>
						</dl>
						{stateLine(plan, props.locale)
							? <p class="stg-note">{stateLine(plan, props.locale)}</p>
							: null}
						<ul class="stg-plans" aria-label="Plans">
							{plan.offers.map((offer) => {
								const current = offer.code === plan.current.code;
								return (
									<li
										key={offer.code}
										class="stg-plans__item"
										aria-current={current ? "true" : undefined}
									>
										<div class="stg-plans__main">
											<span class="stg-plans__name">
												{offer.label}
												{current ? <span class="stg-pill stg-pill--primary">Current</span> : null}
											</span>
											{offer.pricingNote
												? <span class="stg-plans__note">{offer.pricingNote}</span>
												: null}
										</div>
										<span class="stg-plans__price stg-tabular">
											{priceLine(offer, props.locale)}
										</span>
									</li>
								);
							})}
						</ul>
						<p class="stg-note">
							Changing plans isn't available yet. When it is, you'll do it here.
						</p>
					</>
				)}
		</SettingsBlock>
	);
}
