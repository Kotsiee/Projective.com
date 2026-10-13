import type { JSX } from "preact";
import { Link } from "@projective/ui/navigation";
import { PAYOUT_SETUP_ACTION, readPayoutGateDetails } from "@projective/types/finance";
import { openSettings } from "@features/settings/core/settings-bridge.ts";

/** Props for {@link PayoutGateLink}. */
export interface PayoutGateLinkProps {
	/** A refusal's `details`; anything but the earning gate's renders nothing. */
	details: unknown;
	class?: string;
}

/**
 * The fix beside an earning-gate refusal (Decision #196): a link to Settings → Verification when the
 * refused person is the viewer, and the handles still to verify when a team lead is told about their
 * team. Opens the contextual Settings modal on a plain click; stays a real link otherwise.
 */
export function PayoutGateLink(
	{ details, class: className }: PayoutGateLinkProps,
): JSX.Element | null {
	const gate = readPayoutGateDetails(details);
	if (!gate || (!gate.href && !gate.members)) return null;
	return (
		<span class={className}>
			{gate.members ? <span>Still to verify: {gate.members}</span> : null}
			{gate.href
				? (
					<Link
						href={gate.href}
						onClick={(event) => {
							if (
								event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
								event.button !== 0
							) return;
							event.preventDefault();
							openSettings("verification");
						}}
					>
						{PAYOUT_SETUP_ACTION}
					</Link>
				)
				: null}
		</span>
	);
}
