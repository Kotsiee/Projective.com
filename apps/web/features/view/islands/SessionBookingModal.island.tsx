import type { JSX } from "preact";
import { useComputed } from "@preact/signals";
import {
	SessionBookingDialog,
	type SessionDialogFlow,
} from "../components/SessionBookingDialog.tsx";
import type { OfferSummary } from "../core/offer-summary.ts";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import type { SessionPlanItem } from "@projective/types/explore";
import type { IntakeField, ServiceBookingOffer } from "@projective/types/services";

/**
 * SessionBookingModal — the listing page's binding of {@link SessionBookingDialog}: the shared booking
 * panel signal says which flow is open (`scheduler` → the booking, `call` → the discovery call), the
 * live offer is the page's, and an outcome lands on the page's status line.
 */
export interface SessionBookingModalProps {
	/** The SSR-resolved offer. The live one comes from the shared signal once it hydrates. */
	offer: ServiceBookingOffer;
	/** The listing's own intake questions (`ServiceView.intake`), asked before a booking commits. */
	intake?: readonly IntakeField[];
	/** A block's sittings as the seller describes them (`ServiceView.sessionPlan`), naming each row. */
	sessionPlan?: readonly SessionPlanItem[];
	/** The listing as the page names it — the offer column's cover, title, seller and price. */
	summary: OfferSummary;
}

export default function SessionBookingModal(
	{ offer: ssrOffer, intake, sessionPlan, summary }: SessionBookingModalProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const flow = useComputed<SessionDialogFlow | null>(() =>
		openPanel.value === "scheduler" ? "booking" : openPanel.value === "call" ? "call" : null
	);
	return (
		<SessionBookingDialog
			offer={offer}
			flow={flow}
			intake={intake}
			sessionPlan={sessionPlan}
			summary={summary}
			onClose={closeBookingPanel}
			onAnnounce={announce}
		/>
	);
}
