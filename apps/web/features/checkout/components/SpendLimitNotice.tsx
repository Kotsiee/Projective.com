import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import type { SpendLimitBlock } from "../types/checkout-types.ts";

/**
 * SpendLimitNotice — where the acting member stands against their spending limit on this purchase.
 *
 * It states the envelope only — spent, the cap and what is left — whatever the verdict. A refusal or a
 * route forward is said once elsewhere: the session's `spend_limit` blocker in the step's pay notice,
 * or a business's gate (`BusinessSpendGate`, Decision #243), so one refusal never reads two ways.
 *
 * An allowed purchase under a cap still shows the position: a member spending an entity's money is
 * entitled to know how much of the window this purchase uses, and only telling them once they have
 * run out is how a budget becomes a surprise.
 *
 * Three figures are printed and none is computed: cap, spent and remaining all arrive as
 * server-formatted `MoneyView`s.
 */

// #region Props
/** Props for {@link SpendLimitNotice}. */
export interface SpendLimitNoticeProps {
	/** The server's projection. `applies: false` renders nothing. */
	limit: SpendLimitBlock;
}
// #endregion

/** Render the spending-limit position, or nothing when no limit applies. */
export function SpendLimitNotice(props: SpendLimitNoticeProps): JSX.Element | null {
	const { limit } = props;
	if (!limit.applies) return null;

	return (
		<section class="cko-limit" data-verdict={limit.verdict} aria-labelledby="cko-limit-head">
			<h3 class="cko-limit__head" id="cko-limit-head">
				<Icon name="shield" />
				Spending limit
			</h3>
			<dl class="cko-limit__facts">
				<div class="cko-limit__fact">
					<dt class="cko-limit__key">
						Spent{limit.periodLabel ? ` ${limit.periodLabel}` : ""}
					</dt>
					<dd class="cko-limit__val">
						<Amount value={limit.spent} size="body" />
					</dd>
				</div>
				<div class="cko-limit__fact">
					<dt class="cko-limit__key">Your limit</dt>
					<dd class="cko-limit__val">
						{limit.cap ? <Amount value={limit.cap} size="body" /> : "No cap"}
					</dd>
				</div>
				{limit.remaining && (
					<div class="cko-limit__fact">
						<dt class="cko-limit__key">Left to spend</dt>
						<dd class="cko-limit__val">
							<Amount
								value={limit.remaining}
								size="body"
								tone={limit.remaining.minor > 0 ? "default" : "muted"}
							/>
						</dd>
					</div>
				)}
			</dl>
		</section>
	);
}
