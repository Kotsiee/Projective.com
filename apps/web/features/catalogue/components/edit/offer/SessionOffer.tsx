import type { JSX } from "preact";
import { DurationPicker, NumberStepper, SelectButton, ToggleSwitch } from "@projective/ui/fields";
import { SESSION_DURATIONS } from "@projective/types/catalogue";
import type {
	CohortListingOffer,
	ListingDetail,
	SessionOffer as SessionOfferValue,
} from "../../../types/catalogue-types.ts";
import { switchSessionFormat } from "../../../core/offer-model.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { draft, edit } from "../../../core/workspace-store.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { OfferGroup } from "./OfferGroup.tsx";
import { ConferencingSelect } from "./ConferencingSelect.tsx";
import { FieldHead } from "../FieldHead.tsx";

type TimedOffer = SessionOfferValue | CohortListingOffer;

const FORMAT_OPTIONS = [
	{ label: "One-to-one", value: "session" },
	{ label: "Cohort", value: "cohort" },
];

const FORMAT_HINT_ID = "cat-offer-session-format-hint";
const DURATION_ID = "cat-offer-duration";
const COUNT_ID = "cat-offer-count";
const COUNT_HINT_ID = "cat-offer-count-hint";
const SEATS_ID = "cat-offer-seats";
const COHORT_ID = "cat-offer-cohort-cap";

/**
 * SessionOffer — a Session's or Group Session's offer: the format (one-to-one or cohort, switchable
 * only while a draft, since bookings depend on it), the session length, the sittings in one
 * booking, a cohort's seats and enrolment, and the meeting tool that mints each room.
 */
export function SessionOffer(props: { listing: ListingDetail; offer: TimedOffer }): JSX.Element {
	const { listing } = props;
	const gated = useGatedDraft<TimedOffer, ReturnType<typeof checkOffer>>(
		props.offer,
		checkOffer,
		commitOffer,
	);
	const offer = gated.value.value;
	const update = (patch: Partial<Pick<TimedOffer, "minutes" | "count" | "meetingProvider">>) =>
		gated.set({ ...offer, ...patch });
	const updateCohort = (
		patch: Partial<Pick<CohortListingOffer, "maxSeatsPerCohort" | "continuousEnrollment">>,
	) => {
		if (offer.archetype === "cohort") gated.set({ ...offer, ...patch });
	};
	const isDraft = listing.status === "draft";
	const pricing = listing.pricing;

	const switchFormat = (to: "session" | "cohort") => {
		if (to === offer.archetype) return;
		edit("serviceType", to === "cohort" ? "Group Session" : "Session");
		gated.set(switchSessionFormat(offer, to));
	};

	return (
		<>
			<OfferGroup
				title="Format"
				hintId={FORMAT_HINT_ID}
				hint={isDraft
					? "One buyer per sitting, or a group who book seats in the same sitting."
					: "Fixed once published, because bookings depend on it."}
			>
				<div class="cat-sec__field">
					{isDraft
						? (
							<SelectButton
								options={FORMAT_OPTIONS}
								value={offer.archetype}
								onValueChange={(v) => {
									if (v === "session" || v === "cohort") switchFormat(v);
								}}
								aria-label="Session format"
								aria-describedby={FORMAT_HINT_ID}
							/>
						)
						: (
							<p class="cat-sec__value">
								{offer.archetype === "cohort" ? "Cohort" : "One-to-one"}
							</p>
						)}
				</div>
			</OfferGroup>

			<OfferGroup title="Sessions">
				<div class="cat-sec__field">
					<span class="cat-sec__label" aria-hidden="true">Length</span>
					<DurationPicker
						id={DURATION_ID}
						value={offer.minutes}
						onValueChange={(minutes) => {
							if (minutes !== null) update({ minutes });
						}}
						presets={SESSION_DURATIONS}
						aria-label="Session length"
					/>
				</div>
				<div class="cat-sec__field">
					<FieldHead
						label="Sessions per booking"
						htmlFor={COUNT_ID}
						hint="More than one, and a buyer books them all at once, as a series."
						hintId={COUNT_HINT_ID}
					/>
					<div class="cat-offer__compact">
						<NumberStepper
							id={COUNT_ID}
							value={offer.count}
							onValueChange={(count) => update({ count: count ?? 1 })}
							min={1}
							max={52}
							unit={offer.count === 1 ? "session" : "sessions"}
							aria-describedby={COUNT_HINT_ID}
						/>
					</div>
				</div>
			</OfferGroup>

			{offer.archetype === "cohort" && (
				<OfferGroup title="Seats and enrolment">
					<div class="cat-offer__row">
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={SEATS_ID}>Seats per sitting</label>
							<div class="cat-offer__compact">
								<NumberStepper
									id={SEATS_ID}
									value={pricing.seatsPerSession}
									onValueChange={(seats) =>
										edit("pricing", {
											...(draft.peek()?.pricing ?? pricing),
											seatsPerSession: seats,
										})}
									min={1}
									max={500}
									unit="seats"
								/>
							</div>
						</div>
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={COHORT_ID}>Cohort size</label>
							<div class="cat-offer__compact">
								<NumberStepper
									id={COHORT_ID}
									value={offer.maxSeatsPerCohort}
									onValueChange={(n) => updateCohort({ maxSeatsPerCohort: n ?? 1 })}
									min={1}
									max={500}
									unit="people"
								/>
							</div>
						</div>
					</div>
					<ToggleSwitch
						value={offer.continuousEnrollment}
						onValueChange={(continuousEnrollment) => updateCohort({ continuousEnrollment })}
						label="Let people join a cohort that has started"
					/>
				</OfferGroup>
			)}

			<OfferGroup title="Where it happens">
				<ConferencingSelect
					value={offer.meetingProvider}
					onChange={(meetingProvider) => update({ meetingProvider })}
				/>
			</OfferGroup>
		</>
	);
}
