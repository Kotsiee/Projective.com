import type { JSX } from "preact";
import { Alert } from "@projective/ui/feedback";
import type { WalletOverview } from "../types/wallet-types.ts";
import { isElsewhere } from "../core/wallet-model.ts";

const SUBJECT_TITLE: Readonly<Record<WalletOverview["verification"]["subject"], string>> = {
	freelancer: "Identity check · Level 2",
	client: "Identity check",
	business: "Business check · Level 3",
};

/**
 * The verification gate, when one is open: what is withheld and the next step. The step is a real
 * control only where there is somewhere to take it — the destination the server names (Settings →
 * Verification & payouts, where both the identity check and the Stripe payout account live). A check
 * that is in review has no step: the gate says so rather than offering a button that could only wait.
 * A payout account is never set up from here: the wallet's Add card saves a card to pay IN with, and
 * sending someone there to "add a payout method" would save the wrong thing.
 *
 * Rendered by the lane on a wide screen and at the top of the sheet on a phone, where the shell removes
 * the lane — the duty moves, it is never drawn twice.
 */
export function VerificationGate(
	{ overview, class: className }: { overview: WalletOverview; class?: string },
): JSX.Element | null {
	const v = overview.verification;
	if (overview.ref.scope === "aggregate" || !v.prompt) return null;
	const pending = v.kycStatus === "pending";
	const actions = isElsewhere(v.href)
		? (
			<a class="wlt-textlink" href={v.href}>
				{v.kycStatus === "verified" ? "Set up payouts" : "Finish verification"}
			</a>
		)
		: undefined;
	return (
		<Alert
			severity={pending ? "info" : "warning"}
			title={pending ? `${SUBJECT_TITLE[v.subject]} — in review` : SUBJECT_TITLE[v.subject]}
			description={v.prompt}
			actions={actions}
			class={className}
		/>
	);
}
