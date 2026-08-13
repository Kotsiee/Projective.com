import type { JSX } from "preact";
import { Alert } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import type { SpendLimitBlock } from "../types/checkout-types.ts";

/**
 * SpendLimitNotice — how the acting member's spending limit bears on this purchase.
 *
 * **`needs_approval` is a route forward, not a wall.** That is the whole reason the SSOT carries a
 * verdict rather than an over/under boolean: a member who has passed their ceiling is not refused,
 * they are routed to whoever can approve it, and a surface that rendered the same red refusal for
 * both outcomes would teach them their purchase is impossible. So the deferred case is `warning`
 * with the request link as its action, and only `blocked` is a refusal.
 *
 * `warning` here means what §A.1 says it means — caution, a state that needs attention before the
 * thing can proceed — not a decoration and not an action colour.
 *
 * Three figures are printed and none is computed: cap, spent and remaining all arrive as
 * server-formatted `MoneyView`s. `remaining` in particular is the server's, because a client that
 * subtracted `spent` from `cap` would disagree with it the moment a pending purchase in another tab
 * counted against the window.
 */

// #region Props
/** Props for {@link SpendLimitNotice}. */
export interface SpendLimitNoticeProps {
	/** The server's projection. `applies: false` renders nothing. */
	limit: SpendLimitBlock;
}
// #endregion

/** The meter of what remains against the cap — a count of money, never a computation. */
function LimitFacts(props: { limit: SpendLimitBlock }): JSX.Element {
	const { limit } = props;
	return (
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
					<Amount value={limit.cap} size="body" />
				</dd>
			</div>
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
		</dl>
	);
}

/** Render the spending-limit position, or nothing when no limit applies. */
export function SpendLimitNotice(props: SpendLimitNoticeProps): JSX.Element | null {
	const { limit } = props;
	if (!limit.applies) return null;

	// An allowed purchase under a cap still shows the position: a member spending an entity's money
	// is entitled to know how much of the window this purchase uses, and only telling them once they
	// have run out is how a budget becomes a surprise.
	if (limit.verdict === "allowed") {
		return (
			<section class="cko-limit" data-verdict="allowed" aria-labelledby="cko-limit-head">
				<h3 class="cko-limit__head" id="cko-limit-head">
					<Icon name="shield" />
					Spending limit
				</h3>
				<LimitFacts limit={limit} />
			</section>
		);
	}

	const deferred = limit.verdict === "needs_approval";

	return (
		<Alert
			class="cko-limit cko-limit--gate"
			severity={deferred ? "warning" : "danger"}
			title={deferred ? "This purchase needs approval" : "This purchase is over your limit"}
			actions={deferred && limit.requestHref
				? (
					<a class="cko-limit__request" href={limit.requestHref}>
						<Icon name="send" />
						Request approval
					</a>
				)
				: undefined}
		>
			{
				/*
				 * The verdict's own sentence, verbatim. Two wordings of one refusal is how a buyer comes
				 * to believe they have two different problems — the same rule the provider refusals keep.
				 */
			}
			<p class="cko-limit__reason">
				{limit.reason ??
					(deferred
						? "Someone with a higher limit will need to approve this before it can be paid."
						: "This account's spending limit does not cover this purchase.")}
			</p>
			<LimitFacts limit={limit} />
		</Alert>
	);
}
