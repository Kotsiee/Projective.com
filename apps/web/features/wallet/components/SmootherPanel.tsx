import type { JSX } from "preact";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { PersonalExtras } from "../types/wallet-types.ts";

/**
 * SmootherPanel — the Income Smoother's state, as a target-vs-projected meter.
 *
 * Freelance income is lumpy; the Smoother buffers it into a steadier monthly figure for a ~0.5%
 * fee. The panel shows where the projected month lands against the target the user set, with the
 * target as a notch rather than a second bar — one bar and one mark reads as "here versus there",
 * two bars read as two unrelated numbers.
 *
 * **There is no enrol button here.** The affordance lives in the footer action rig, because the body
 * of this surface owns viewing and selecting only (§4.6). A panel that offers its own CTA is how a
 * calm surface turns into a dashboard of competing buttons.
 */
export interface SmootherPanelProps {
	smoother: NonNullable<PersonalExtras["incomeSmoother"]>;
}

export function SmootherPanel(props: SmootherPanelProps): JSX.Element {
	const s = props.smoother;
	const enrolled = s.status === "enrolled";

	// The meter fills to the projected figure against the target. Not enrolled → an empty track,
	// so the instrument's shape is legible before it carries a value.
	const fill = enrolled && s.targetMonthly && s.projected && s.targetMonthly.minor > 0
		? Math.min(100, (s.projected.minor / s.targetMonthly.minor) * 100)
		: 0;

	// Eligibility is a months-of-history gate, so an ineligible subject sees progress toward it.
	const progress = s.monthsRequired > 0
		? Math.min(100, (s.monthsElapsed / s.monthsRequired) * 100)
		: 0;

	return (
		<section class="wlt-smoother" aria-labelledby="wlt-smoother-title">
			<header class="wlt-smoother__head">
				<h3 class="wlt-smoother__title wlt-label" id="wlt-smoother-title">Income Smoother</h3>
				<span class="wlt-smoother__state" data-status={s.status}>
					{enrolled ? "Active" : s.status === "eligible" ? "Available" : "Building history"}
				</span>
			</header>

			{enrolled
				? (
					<>
						<div
							class="wlt-smoother__meter"
							style={styleVars({ "--wlt-fill": `${fill}%` })}
							role="meter"
							aria-valuenow={s.projected?.minor ?? 0}
							aria-valuemin={0}
							aria-valuemax={s.targetMonthly?.minor ?? 0}
							aria-label="Projected income against your monthly target"
						>
							<span class="wlt-smoother__track">
								<span class="wlt-smoother__fill" />
								<span class="wlt-smoother__notch" aria-hidden="true" />
							</span>
						</div>
						<dl class="wlt-smoother__figures">
							{s.targetMonthly && (
								<div class="wlt-smoother__figure">
									<dt class="wlt-smoother__figure-label">Target</dt>
									<dd class="wlt-smoother__figure-value">
										<Money value={s.targetMonthly} size="figure" showFx={false} />
									</dd>
								</div>
							)}
							{s.projected && (
								<div class="wlt-smoother__figure">
									<dt class="wlt-smoother__figure-label">Projected</dt>
									<dd class="wlt-smoother__figure-value">
										<Money value={s.projected} size="figure" showFx={false} />
									</dd>
								</div>
							)}
						</dl>
					</>
				)
				: (
					<>
						<div
							class="wlt-smoother__meter wlt-smoother__meter--empty"
							style={styleVars({ "--wlt-fill": `${progress}%` })}
							role="meter"
							aria-valuenow={s.monthsElapsed}
							aria-valuemin={0}
							aria-valuemax={s.monthsRequired}
							aria-label="Earning history toward Income Smoother eligibility"
						>
							<span class="wlt-smoother__track">
								<span class="wlt-smoother__fill" />
							</span>
						</div>
						<p class="wlt-prose wlt-smoother__note">
							{s.status === "eligible"
								? "You can smooth your income into a steadier monthly figure."
								: `${s.monthsElapsed} of ${s.monthsRequired} months of earning history.` +
									(s.weeksToGo > 0 ? ` About ${s.weeksToGo} weeks to go.` : "")}
						</p>
					</>
				)}

			<p class="wlt-smoother__fee">
				Smoothing fee {(s.feeBp / 100).toFixed(1)}% of buffered income.
			</p>
		</section>
	);
}
