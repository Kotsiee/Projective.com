import type { JSX } from "preact";
import type { WalletOverview } from "../types/wallet-types.ts";
import { isElsewhere } from "../core/wallet-model.ts";

/**
 * The verification gate, when one is open: one line saying what is withheld, led by a presence pip —
 * a solid `--warning` dot when the next step is the reader's, a hollow `--text-secondary` ring while
 * the check is in review (hue AND fill, so the two survive the colour-blind overlays) — and, where the
 * server names somewhere to take it, a text link to that step (Settings → Verification & payouts,
 * where both the identity check and the Stripe payout account live). Not an Alert: the lane and the
 * sheet are dense, the gate is a standing condition rather than an event, and §B.6 asks for status as
 * a glyph plus a few words. The pip is decorative; its meaning is spoken through visually hidden
 * text. A check in review has no step, so it gets no link. A payout account is never set up from here:
 * the wallet's Add payment method saves a card to pay IN with.
 *
 * Rendered by the lane on a wide screen and at the top of the sheet on a phone, where the shell removes
 * the lane — the duty moves, it is never drawn twice. Both read `.wlt-gate` (wallet-lane.css).
 */
export function VerificationGate(
	{ overview, class: className }: { overview: WalletOverview; class?: string },
): JSX.Element | null {
	const v = overview.verification;
	if (overview.ref.scope === "aggregate" || !v.prompt) return null;
	const pending = v.kycStatus === "pending";
	const href = !pending && isElsewhere(v.href) ? v.href : null;
	return (
		<p
			class={className ? `wlt-gate ${className}` : "wlt-gate"}
			data-tone={pending ? "review" : "action"}
		>
			<span class="wlt-gate__pip" aria-hidden="true" />
			<span class="wlt-gate__text">
				<span class="ui-visually-hidden">{pending ? "In review: " : "Action needed: "}</span>
				{v.prompt}
			</span>
			{href && (
				<a class="wlt-textlink wlt-gate__link" href={href}>
					{v.kycStatus === "verified" ? "Set up payouts" : "Finish verification"}
				</a>
			)}
		</p>
	);
}
