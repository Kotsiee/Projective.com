import type { JSX } from "preact";
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";
import PricingCalculator from "@features/landing/islands/PricingCalculator.island.tsx";
import { type PricingFee, PricingSection } from "@features/landing/components/PricingView.tsx";

// #region Component
/** Props for {@link Pricing}. */
export interface PricingProps {
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`), or
	 * `null` when it is unavailable — then every fee clause drops and the calculator hides
	 * (`flows/LANDING.md` §4). Never hard-coded.
	 */
	feeBp: number | null;
}

/**
 * Pricing — the landing's `#pricing` section (`flows/LANDING.md` §2.1 notes 21–22, §2.2 note 21,
 * §2.3 note 20, §4.9; work order L4): {@link PricingSection} with the {@link PricingCalculator}
 * island in its panel. The fee's label is formatted here, on the server, from the basis points
 * (500 → "5%", the same formatter `/about` prints the fee with), so the island never carries the
 * formatting module. Without a fee the island is still mounted — it draws nothing, and carries
 * this section's stylesheet and that of "The numbers so far" (`LiveNumbers`).
 */
export function Pricing({ feeBp }: PricingProps): JSX.Element {
	const fee: PricingFee | null = feeBp === null
		? null
		: { bp: feeBp, label: formatFeePercent(feeBp) };
	return (
		<PricingSection
			fee={fee}
			calculator={<PricingCalculator feeBp={feeBp} feeLabel={fee?.label ?? ""} />}
		/>
	);
}

export default Pricing;
// #endregion
