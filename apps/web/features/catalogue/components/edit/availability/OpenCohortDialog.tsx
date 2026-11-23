import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import {
	Button,
	DateTimePicker,
	FormControl,
	NumberInput,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import { useIsMobile } from "@projective/ui/hooks";
import type { CohortCadence, ListingCohorts } from "@projective/types/projects";
import {
	type CohortDraft,
	draftStarts,
	draftToInput,
	freshDraft,
} from "../../../core/cohort-model.ts";
import { cohortBusy, openCohort, setCohortDialog } from "../../../core/cohort-store.ts";
import { workspaceUrl } from "../../../core/workspace-store.ts";

const CADENCE_OPTIONS: { label: string; value: CohortCadence }[] = [
	{ label: "Weekly", value: "weekly" },
	{ label: "Every two weeks", value: "fortnightly" },
	{ label: "Dates I choose", value: "fixed" },
];

const SITTING = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
});

/**
 * OpenCohortDialog — the seller opens a group-session listing's next cohort (Decision #498), at
 * `?cohort=open`. The listing fixes how many sessions a cohort has and how long each runs; the seller
 * sets the first session, how the rest repeat (weekly, every two weeks, or dates of their own), the
 * seats, an optional minimum it runs with, and when enrolment closes — at or before the first session,
 * and before it with a minimum, so there is time to decide. The preview shows every session before the
 * press. The server re-checks all of it against the seller's calendar; its refusal is shown in place.
 * A bottom sheet on a phone.
 */
export function OpenCohortDialog(props: { listing: string; data: ListingCohorts }): JSX.Element {
	const mobile = useIsMobile();
	const visible = useSignal(false);
	const draft = useSignal<CohortDraft>(freshDraft(props.data, Date.now()));
	const errors = useSignal<Record<string, string>>({});
	const failure = useSignal<string | null>(null);

	useSignalEffect(() => {
		const want = workspaceUrl.value.cohort === "open";
		if (want && !visible.peek()) {
			draft.value = freshDraft(props.data, Date.now());
			errors.value = {};
			failure.value = null;
		}
		visible.value = want;
	});

	const count = props.data.sessionCount;
	const d = draft.value;
	const starts = draftStarts(d, count);
	const minutes = props.data.sessionMinutes;

	function patch(next: Partial<CohortDraft>): void {
		draft.value = { ...draft.peek(), ...next };
		errors.value = {};
		failure.value = null;
	}

	async function submit(): Promise<void> {
		const built = draftToInput(props.listing, draft.peek(), count);
		if (!built.ok) {
			errors.value = built.errors;
			return;
		}
		const out = await openCohort(built.input);
		if (!out.ok) {
			failure.value = out.message;
			if (out.errors) errors.value = out.errors;
		}
	}

	return (
		<Dialog
			visible={visible}
			position={mobile ? "bottom" : "center"}
			header="Open a cohort"
			width="min(36rem, calc(100vw - 2rem))"
			onVisibleChange={(v) => {
				if (!v && workspaceUrl.peek().cohort === "open") setCohortDialog(undefined);
			}}
			footer={
				<div class="cat-ws__dialog-actions">
					<Button
						label="Cancel"
						severity="neutral"
						variant="outlined"
						disabled={cohortBusy.value}
						onClick={() => setCohortDialog(undefined)}
					/>
					<Button
						label="Open cohort"
						loading={cohortBusy.value}
						disabled={cohortBusy.value}
						onClick={() => void submit()}
					/>
				</div>
			}
		>
			<div class="cat-coh__form">
				{failure.value && <InlineNotice assertive align="start" text={failure.value} />}

				<FormControl
					label={count > 1 ? "First session" : "Session"}
					error={errors.value.firstStartsAt}
					status={errors.value.firstStartsAt ? "invalid" : "default"}
					hint={`${count} ${
						count === 1 ? "session" : "sessions"
					} of ${minutes} minutes, as this listing sets them.`}
				>
					{({ id, describedBy, status }) => (
						<DateTimePicker
							id={id}
							aria-describedby={describedBy}
							status={status}
							value={d.firstStart}
							min={new Date()}
							showIcon
							onValueChange={(firstStart) => patch({ firstStart })}
						/>
					)}
				</FormControl>

				{count > 1 && (
					<FormControl label="The other sessions" error={errors.value.cadence}>
						{({ describedBy }) => (
							<SelectButton
								options={CADENCE_OPTIONS}
								value={d.cadence}
								aria-label="How the sessions repeat"
								aria-describedby={describedBy}
								onValueChange={(v) => {
									if (v === "weekly" || v === "fortnightly" || v === "fixed") patch({ cadence: v });
								}}
							/>
						)}
					</FormControl>
				)}

				{count > 1 && d.cadence === "fixed" && d.laterStarts.slice(0, count - 1).map((value, i) => {
					const key = `laterStartsAt.${i}`;
					return (
						<FormControl
							key={key}
							label={`Session ${i + 2}`}
							error={errors.value[key]}
							status={errors.value[key] ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<DateTimePicker
									id={id}
									aria-describedby={describedBy}
									status={status}
									value={value}
									min={d.firstStart ?? new Date()}
									showIcon
									onValueChange={(next) => {
										const later = [...draft.peek().laterStarts];
										later[i] = next;
										patch({ laterStarts: later });
									}}
								/>
							)}
						</FormControl>
					);
				})}

				{starts.length > 1 && (
					<ol class="cat-coh__preview" aria-label="The cohort's sessions">
						{starts.map((iso, i) => (
							<li key={i} class="cat-coh__sitting">
								<span class="cat-coh__sitting-num">{i + 1}</span>
								<span>{iso ? SITTING.format(new Date(iso)) : "Not chosen yet"}</span>
							</li>
						))}
					</ol>
				)}

				<FormControl label="Seats" error={errors.value.maxSeats}>
					{({ id, describedBy }) => (
						<NumberInput
							id={id}
							class="cat-offer__count"
							aria-describedby={describedBy}
							value={d.maxSeats}
							min={1}
							max={500}
							maxFractionDigits={0}
							icon="members"
							enableIconScrub
							suffix="seats"
							onValueChange={(n) => patch({ maxSeats: Math.round(n ?? 1) })}
						/>
					)}
				</FormControl>

				<FormControl
					label="Minimum to run"
					error={errors.value.minSeats}
					hint="Optional. If fewer seats are booked by the time enrolment closes, you can cancel the cohort and every seat is refunded in full."
				>
					{({ id, describedBy }) => (
						<div class="cat-coh__min">
							<ToggleSwitch
								value={d.minSeats !== null}
								label="Only run with a minimum"
								onValueChange={(on) =>
									patch({
										minSeats: on
											? Math.min(Math.max(2, Math.ceil(d.maxSeats / 3)), d.maxSeats)
											: null,
									})}
							/>
							{d.minSeats !== null && (
								<NumberInput
									id={id}
									class="cat-offer__count"
									aria-describedby={describedBy}
									value={d.minSeats}
									min={1}
									max={d.maxSeats}
									maxFractionDigits={0}
									icon="members"
									enableIconScrub
									suffix="seats"
									onValueChange={(n) => patch({ minSeats: Math.round(n ?? 1) })}
								/>
							)}
						</div>
					)}
				</FormControl>

				<FormControl
					label="Enrolment closes"
					error={errors.value.enrolmentClosesAt}
					status={errors.value.enrolmentClosesAt ? "invalid" : "default"}
					hint={d.minSeats !== null
						? "Before the first session, so there is time to decide whether it runs."
						: "No later than the first session."}
				>
					{({ id, describedBy, status }) => (
						<DateTimePicker
							id={id}
							aria-describedby={describedBy}
							status={status}
							value={d.closesAt}
							min={new Date()}
							max={d.firstStart ?? undefined}
							showIcon
							onValueChange={(closesAt) => patch({ closesAt })}
						/>
					)}
				</FormControl>

				<p class="cat-coh__disclosure">
					Buyers see when it starts, how it repeats, the minimum and when enrolment closes before
					they pay. People on the waitlist are invited first, in order, each with a seat held for
					them.
				</p>
			</div>
		</Dialog>
	);
}
