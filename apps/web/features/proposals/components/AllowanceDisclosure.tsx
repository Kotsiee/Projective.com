import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/proposals.css";
import { disclosureLine } from "../core/allowance-model.ts";
import { effectiveAllowance, ensureAllowance } from "../core/allowance-state.ts";

/**
 * AllowanceDisclosure — the conversion lane's cost line beneath **Apply to project**:
 * `1 proposal token · 12 ready`. A required disclosure of what the primary spends, in the meta register
 * as inline middot text (§B.11 — metadata is never a chip), and shared by the lane and the mobile
 * apply bar through `ProjectCtaRig`, so the two can never quote different costs (§D.7.4).
 *
 * Reads the page's one allowance store, so an application made in the modal moves "N ready" here with
 * no reload. Renders nothing for a guest, or until the read lands — a cost line with a guessed figure
 * would be worse than none.
 */
export function AllowanceDisclosure({ authed }: { authed: boolean }): JSX.Element | null {
	// The read is an external fetch made once per page; the store coalesces every mount onto it.
	useEffect(() => {
		if (authed) ensureAllowance();
	}, [authed]);
	const snapshot = effectiveAllowance.value;
	if (!authed || !snapshot) return null;
	return <p class="prop-disclosure">{disclosureLine(snapshot.status)}</p>;
}
