import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	NumberInput,
	SelectButton,
	Slider,
	type SliderValue,
	ToggleSwitch,
} from "@projective/ui/fields";
import { listingSubPageHref, SessionMinutes } from "@projective/types/catalogue";
import type {
	CohortListingOffer,
	ListingDetail,
	SessionOffer as SessionOfferValue,
} from "../../../types/catalogue-types.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { hasPlan, planSummary } from "../../../core/plan-model.ts";
import { draft, edit } from "../../../core/workspace-store.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { OfferGroup } from "./OfferGroup.tsx";
import { ConferencingSelect } from "./ConferencingSelect.tsx";
import { FieldHead } from "../FieldHead.tsx";
import { SubPageLink } from "../SubPageLink.tsx";

type TimedOffer = SessionOfferValue | CohortListingOffer;

const MODE_OPTIONS = [
	{ label: "Fixed number", value: "fixed" },
	{ label: "Ongoing", value: "rolling" },
];

const LENGTH_ID = "cat-offer-length";
const MODE_HINT_ID = "cat-offer-session-mode-hint";
const PLAN_SUMMARY_ID = "cat-offer-plan-summary";
const SEATS_ID = "cat-offer-seats";
const COHORT_ID = "cat-offer-cohort-cap";

const MINUTES_MIN = SessionMinutes.minValue ?? 5;
const MINUTES_MAX = SessionMinutes.maxValue ?? 600;
const SLIDER_MIN = 15;
const SLIDER_MAX = 240;
const MINUTES_STEP = 5;

function onTrack(minutes: number): number {
	return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, minutes));
}

/**
 * SessionOffer — a Session's or Group Session's offer: the session length (a slider for the common
 * range beside the exact minutes), whether a one-to-one listing is a fixed number of sessions or
 * ongoing (Decision #411), the session plan as a summary that opens its own page (Decision #525), a
 * cohort's seats and enrolment, and the meeting tool that mints each room. One-to-one or group is the
 * delivery model, chosen in Basics, so it is not asked again here.
 */
export function SessionOffer(
	props: { listing: ListingDetail; offer: TimedOffer; team?: string },
): JSX.Element {
	const { listing } = props;
	const gated = useGatedDraft<TimedOffer, ReturnType<typeof checkOffer>>(
		props.offer,
		checkOffer,
		commitOffer,
	);
	const offer = gated.value.value;
	const update = (patch: Partial<Pick<TimedOffer, "minutes" | "meetingProvider">>) =>
		gated.set({ ...offer, ...patch });
	const rolling = offer.archetype === "session" && offer.rolling;
	const setRolling = (next: boolean) => {
		if (offer.archetype === "session" && next !== offer.rolling) {
			gated.set({ ...offer, rolling: next, count: 1 });
		}
	};
	const updateCohort = (
		patch: Partial<Pick<CohortListingOffer, "maxSeatsPerCohort" | "continuousEnrollment">>,
	) => {
		if (offer.archetype === "cohort") gated.set({ ...offer, ...patch });
	};
	const minutesField = useSignal<number | null>(offer.minutes);
	const sliderField = useSignal<SliderValue>(onTrack(offer.minutes));
	const setMinutes = (raw: number | null) => {
		if (raw === null) {
			minutesField.value = offer.minutes;
			return;
		}
		const snapped = Math.round(raw / MINUTES_STEP) * MINUTES_STEP;
		const minutes = Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, snapped));
		minutesField.value = minutes;
		sliderField.value = onTrack(minutes);
		if (minutes !== offer.minutes) update({ minutes });
	};
	const pricing = listing.pricing;

	return (
		<>
			<OfferGroup title="Sessions">
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={LENGTH_ID}>Length</label>
					<div class="cat-offer__duration">
						<Slider
							class="cat-offer__duration-track"
							value={sliderField}
							onValueChange={(v) => {
								if (typeof v === "number") setMinutes(v);
							}}
							min={SLIDER_MIN}
							max={SLIDER_MAX}
							step={MINUTES_STEP}
							formatValue={(v) => `${v} minutes`}
							aria-label="Session length"
						/>
						<NumberInput
							id={LENGTH_ID}
							class="cat-offer__duration-value"
							value={minutesField}
							onValueChange={setMinutes}
							min={MINUTES_MIN}
							max={MINUTES_MAX}
							step={MINUTES_STEP}
							maxFractionDigits={0}
							icon="clock"
							enableIconScrub
							suffix="min"
						/>
					</div>
				</div>
				{offer.archetype === "session" && (
					<div class="cat-sec__field">
						<FieldHead
							label="How buyers book"
							hint="Fixed number: a buyer books a set number of sessions as one purchase, and you can say what each one covers. Ongoing: each booking is one session, and the buyer books again whenever they need another."
							hintId={MODE_HINT_ID}
						/>
						<SelectButton
							options={MODE_OPTIONS}
							value={rolling ? "rolling" : "fixed"}
							onValueChange={(v) => setRolling(v === "rolling")}
							aria-label="How buyers book"
							aria-describedby={MODE_HINT_ID}
						/>
					</div>
				)}
			</OfferGroup>

			{hasPlan(offer) && (
				<OfferGroup
					title="Session plan"
					hint="How many sessions one booking holds, in order, with what each one covers. Buyers see the breakdown on your listing and when they book."
				>
					<div class="cat-offer__summary">
						<p class="cat-sec__value cat-offer__summary-line" id={PLAN_SUMMARY_ID}>
							{planSummary(offer).join(" · ")}
						</p>
						<SubPageLink
							href={listingSubPageHref(listing.id, "plan", props.team)}
							label="Edit session plan"
							icon="list-numbers"
							describedBy={PLAN_SUMMARY_ID}
						/>
					</div>
				</OfferGroup>
			)}

			{offer.archetype === "cohort" && (
				<OfferGroup title="Seats and enrolment">
					<div class="cat-offer__row">
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={SEATS_ID}>Seats per sitting</label>
							<NumberInput
								id={SEATS_ID}
								class="cat-offer__count"
								value={pricing.seatsPerSession}
								onValueChange={(seats) =>
									edit("pricing", {
										...(draft.peek()?.pricing ?? pricing),
										seatsPerSession: seats,
									})}
								min={1}
								max={500}
								maxFractionDigits={0}
								icon="members"
								enableIconScrub
								suffix="seats"
								placeholder="Seats"
							/>
						</div>
						<div class="cat-sec__field">
							<label class="cat-sec__label" for={COHORT_ID}>Cohort size</label>
							<NumberInput
								id={COHORT_ID}
								class="cat-offer__count"
								value={offer.maxSeatsPerCohort}
								onValueChange={(n) => updateCohort({ maxSeatsPerCohort: n ?? 1 })}
								min={1}
								max={500}
								maxFractionDigits={0}
								icon="user"
								enableIconScrub
								suffix="people"
							/>
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
