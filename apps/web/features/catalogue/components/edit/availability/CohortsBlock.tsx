import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../../../styles/offer.css";
import "../../../styles/cohorts.css";
import { Tag } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { ListingCohort } from "@projective/types/projects";
import {
	cancelAddress,
	cancelledLine,
	COHORT_PHASE_LABEL,
	cohortCloseLine,
	cohortSeatsLine,
	cohortWhenLine,
	enrollingCohort,
	type InstantFormatter,
} from "../../../core/cohort-model.ts";
import {
	cohortNotice,
	cohorts,
	cohortsError,
	loadCohorts,
	setCohortDialog,
} from "../../../core/cohort-store.ts";
import { OfferGroup } from "../offer/OfferGroup.tsx";
import { OpenCohortDialog } from "./OpenCohortDialog.tsx";
import { CancelCohortDialog } from "./CancelCohortDialog.tsx";

const HINT_ID = "cat-coh-hint";

/** "Tue 1 Dec, 18:00" in the seller's own zone. */
const AT = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});
const at: InstantFormatter = (iso) => AT.format(new Date(iso));

function phaseSeverity(cohort: ListingCohort): "info" | "warning" | "success" | "secondary" {
	if (cohort.underFilled) return "warning";
	switch (cohort.phase) {
		case "enrolling":
			return "info";
		case "running":
		case "completed":
			return "success";
		default:
			return "secondary";
	}
}

/**
 * CohortsBlock — a group-session listing's cohorts, in its Availability section (Decision #498). A
 * group listing sells seats only on a cohort that is taking bookings, so with none it says the
 * listing is waitlist-only and offers **Open a cohort**. Each cohort reads as one row: its lifecycle
 * status, when it starts and how it repeats, its seats against its minimum, and when enrolment closes.
 * A cohort that closed under its minimum says so and offers the cancel; any cohort before its first
 * session may be cancelled, and every seat is refunded in full. Both dialogs are addressed by the URL
 * (`?cohort=open`, `?cohort=cancel:<first sitting's ssn- slug>`), so a reload lands on the same one.
 */
export function CohortsBlock(props: { listing: string }): JSX.Element {
	const attempt = useSignal(0);
	const slug = useSignal(props.listing);
	if (slug.peek() !== props.listing) slug.value = props.listing;

	useEffect(() => subscribeDevSeam(() => attempt.value++), []);

	useSignalEffect(() => {
		void attempt.value;
		void loadCohorts(slug.value);
	});

	const data = cohorts.value;
	const open = enrollingCohort(data);
	const loading = !data && !cohortsError.value;

	return (
		<OfferGroup
			title="Cohorts"
			hintId={HINT_ID}
			hint="A cohort is one run of this group session: its seats, its sessions and when enrolment closes. Buyers can reserve a seat only while a cohort is taking bookings; otherwise they join the waitlist, and opening a cohort invites them first."
		>
			{cohortsError.value && (
				<InlineNotice
					align="start"
					text={cohortsError.value}
					actionLabel="Try again"
					onAction={() => attempt.value++}
				/>
			)}
			{loading && <p class="cat-sec__hint" role="status">Loading this listing's cohorts…</p>}

			{data && (
				<>
					{!open && (
						<p class="cat-sec__value">
							{data.cohorts.length === 0
								? "No cohort is open, so buyers can only join the waitlist."
								: "No cohort is taking bookings now, so buyers can only join the waitlist."}
						</p>
					)}

					{data.cohorts.length > 0 && (
						<ul class="cat-coh__list" aria-label="This listing's cohorts">
							{data.cohorts.map((c) => {
								const close = cohortCloseLine(c, at);
								const address = cancelAddress(c);
								return (
									<li key={c.cohortId} class="cat-coh__item">
										<div class="cat-coh__head">
											<p class="cat-coh__name">{c.name}</p>
											<Tag
												value={c.underFilled ? "Under its minimum" : COHORT_PHASE_LABEL[c.phase]}
												severity={phaseSeverity(c)}
												variant="subtle"
											/>
										</div>
										<p class="cat-coh__meta">{cohortWhenLine(c, at)}</p>
										{c.phase === "cancelled"
											? <p class="cat-coh__meta">{cancelledLine(c)}</p>
											: (
												<p class="cat-coh__meta">
													{cohortSeatsLine(c)}
													{close ? ` · ${close}` : ""}
												</p>
											)}
										{c.underFilled && (
											<InlineNotice
												align="start"
												text={`Enrolment closed with ${c.seatsPaid} of the ${c.minSeats} seats it needs. You can cancel it before its first session, and every seat is refunded in full, or run it as it is.`}
											/>
										)}
										{c.canCancel && address && (
											<div class="cat-coh__actions">
												<Button
													label="Cancel cohort"
													severity="neutral"
													variant="outlined"
													size="sm"
													onClick={() => setCohortDialog(address)}
												/>
											</div>
										)}
									</li>
								);
							})}
						</ul>
					)}

					{cohortNotice.value && <p class="cat-sec__hint" role="status">{cohortNotice.value}</p>}

					{!open && (
						<div>
							<Button
								label={data.cohorts.length === 0 ? "Open a cohort" : "Open the next cohort"}
								icon={<Icon name="plus" size="xs" />}
								severity="neutral"
								variant="outlined"
								size="sm"
								onClick={() => setCohortDialog("open")}
							/>
						</div>
					)}

					<OpenCohortDialog listing={props.listing} data={data} />
					<CancelCohortDialog listing={props.listing} data={data} />
				</>
			)}
		</OfferGroup>
	);
}
