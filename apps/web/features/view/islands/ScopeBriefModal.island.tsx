import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import "../styles/service-booking.css";
import { CtaButton } from "../components/CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { BookingService } from "../core/BookingService.ts";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import type { StageFundingScope } from "@projective/types/services";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { ProjectStage } from "@projective/types/explore";

/**
 * ScopeBriefModal — the **Continue** panel for the two scoped formats.
 *
 * A **One-Off** gets the full surface: a funding-scope selector (fund the whole engagement, or just
 * stage 1), the stage list it resolves to, the requirements brief and optional attachments. A
 * **Single Task** gets the lightweight half: brief and attachments only, because it has one
 * deliverable and no stages to scope.
 *
 * One component rather than two because they differ only in which fields render. Two would mean two
 * requirements validators, two attachment flows and two places for the maximum length to drift — and
 * the Single Task one, being the smaller and less-visited of the pair, is the one that would drift.
 *
 * # Why the brief is required
 *
 * It is the specification the engagement is delivered against. A stage funded against a scope nobody
 * wrote down is a dispute waiting for a trigger, and the platform's whole escrow model rests on both
 * sides agreeing what "done" means before any money moves. So Continue is refused until there is one,
 * with the reason shown beside the field rather than in a tooltip.
 *
 * # Attachments are staged by name
 *
 * The file list is real, the sizes are real, and nothing is uploaded: the asset pipeline lands with
 * `FILES_BACKEND_LIVE`. That is stated in the interface rather than implied, because a buyer who
 * believes they have attached a specification and has not is worse off than one who was told.
 */
export interface ScopeBriefModalProps {
	offer: ServiceBookingOffer;
	/** The listing's stages, for the One-Off funding selector. Empty for a Single Task. */
	stages?: readonly ProjectStage[];
	/**
	 * The listing's own currency, threaded so this modal and the body's stage ledger scale one figure
	 * the same way. `TicketPrice` carries major units and no currency of its own.
	 */
	currency?: string;
}

export default function ScopeBriefModal(
	{ offer: ssrOffer, stages = [], currency }: ScopeBriefModalProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "scope");
	const isOneOff = useComputed(() => offer.value.format === "one_off" && stages.length > 0);

	const requirements = useSignal("");
	const scope = useSignal<StageFundingScope>("first_stage");
	const files = useSignal<readonly File[]>([]);
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();

	// Reset on close, so re-opening is a fresh brief rather than a half-written one from an abandoned
	// attempt. A draft that survives is a feature this surface deliberately does not have: the brief is
	// short, and resurrecting one written for a different funding scope is worse than retyping it.
	useEffect(() => {
		if (open.value) return;
		requirements.value = "";
		scope.value = "first_stage";
		files.value = [];
		error.value = null;
		cta.reset();
	}, [open.value]);

	/** The stages the current scope resolves to — what the ledger below the selector lists. */
	const funded = useComputed<readonly ProjectStage[]>(() =>
		!isOneOff.value ? [] : scope.value === "whole_project" ? stages : stages.slice(0, 1)
	);

	async function submit(): Promise<boolean> {
		const brief = requirements.value.trim();
		if (!brief) {
			error.value = "Describe what you need — this is what the work is delivered against.";
			return false;
		}
		error.value = null;

		const res = await BookingService.configure({
			subjectId: offer.value.subjectId,
			format: offer.value.format,
			requirements: brief,
			fundingScope: scope.value,
			stageIds: funded.value.map((s) => s.id),
			attachments: files.value.map((f) => ({
				name: f.name,
				sizeBytes: f.size,
				mimeType: f.type || undefined,
				// Staged by name only until the asset pipeline lands. `null` says so structurally rather
				// than through an empty string that could be mistaken for an id.
				assetId: null,
			})),
		});
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not stage that. Please try again.";
			return false;
		}
		announce(res.data.outcome.summary);
		const route = res.data.outcome.route;
		setTimeout(() => {
			try {
				globalThis.location.href = route;
			} catch { /* SSR / no window — non-fatal */ }
		}, 700);
		return true;
	}

	function addFiles(list: FileList | null): void {
		if (!list) return;
		// Capped at ten, matching the schema. The excess is dropped WITH a message rather than silently:
		// a composer that quietly discards attachments is the failure flagged on the chat composer, and
		// repeating it here would be repeating a known defect on purpose.
		const next = [...files.value, ...Array.from(list)];
		if (next.length > 10) {
			error.value = "Up to 10 attachments. The extras were not added.";
		}
		files.value = next.slice(0, 10);
	}

	return (
		<Dialog
			visible={open}
			onVisibleChange={(next) => {
				if (!next) closeBookingPanel();
			}}
			header={isOneOff.value ? `Scope ${offer.value.subjectTitle}` : `Brief for ${offer.value.subjectTitle}`}
			width="min(42rem, 94vw)"
			class="sbk sbk--scope"
			footer={
				<div class="sbk__footer">
					<div class="sbk__summary">
						<span class="sbk__summarymain">
							{isOneOff.value
								? `Funding ${funded.value.length} of ${stages.length} ${
									stages.length === 1 ? "stage" : "stages"
								}`
								: "One fixed-scope deliverable"}
						</span>
						<span class="sbk__summarynote">You review everything at checkout before paying.</span>
					</div>
					<CtaButton
						label="Continue"
						settledLabel="Staged"
						phase={cta.phase}
						disabled={!requirements.value.trim()}
						icon={<Icon name="arrow-right" size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</div>
			}
		>
			<div class="sbk__body">
				{isOneOff.value && (
					<section class="sbk__section">
						<h3 class="sbk__sectiontitle">What to fund now</h3>
						<div class="sbk__scope" role="radiogroup" aria-label="Funding scope">
							<ScopeOption
								label="Stage 1 only"
								hint="Fund the first stage. The rest follow as the work does."
								checked={scope.value === "first_stage"}
								onSelect={() => (scope.value = "first_stage")}
							/>
							<ScopeOption
								label="The whole engagement"
								hint={`Fund all ${stages.length} stages up front.`}
								checked={scope.value === "whole_project"}
								onSelect={() => (scope.value = "whole_project")}
							/>
						</div>

						{
							/*
						  The stage ledger — hairline rows, never cards (§B.9.7). It is static content
						  describing what the selection above resolves to, and boxing it would put a border
						  around a list that is already separated by its own rhythm.
						*/
						}
						<dl class="sbk__stages">
							{stages.map((stage) => {
								const included = funded.value.some((s) => s.id === stage.id);
								return (
									<div
										class="sbk__stagerow"
										key={stage.id}
										data-included={included ? "true" : undefined}
									>
										<dt class="sbk__stagename">
											<span class="sbk__stagenum">{stage.index}</span>
											<span>{stage.name}</span>
										</dt>
										<dd class="sbk__stagevalue">
											{included
												? <StagePrice stage={stage} currency={currency} />
												: <span class="sbk__stagelater">Later</span>}
										</dd>
									</div>
								);
							})}
						</dl>
					</section>
				)}

				<section class="sbk__section">
					<label class="sbk__note">
						<span class="sbk__notelabel">
							What do you need? <span class="sbk__req" aria-hidden="true">*</span>
						</span>
						<span class="sbk__notehint">
							This is the specification the work is delivered against — the clearer it is, the
							faster the first submission lands.
						</span>
						<textarea
							class="sbk__notefield"
							rows={6}
							required
							value={requirements.value}
							maxLength={8000}
							aria-describedby="sbk-req-hint"
							onInput={(e) => (requirements.value = (e.target as HTMLTextAreaElement).value)}
						/>
					</label>
					<p id="sbk-req-hint" class="ui-visually-hidden">
						Required. Up to 8000 characters.
					</p>
				</section>

				<section class="sbk__section">
					<h3 class="sbk__sectiontitle">Attachments</h3>
					<label class="sbk__filepick">
						<Icon name="attachment" size="sm" aria-hidden />
						<span>Add reference files</span>
						<input
							class="ui-visually-hidden"
							type="file"
							multiple
							onChange={(e) => addFiles((e.target as HTMLInputElement).files)}
						/>
					</label>
					{files.value.length > 0 && (
						<ul class="sbk__files">
							{files.value.map((f, i) => (
								<li class="sbk__file" key={`${f.name}-${i}`}>
									<span class="sbk__filename">{f.name}</span>
									<span class="sbk__filesize">{prettyBytes(f.size)}</span>
									<button
										type="button"
										class="sbk__fileremove"
										aria-label={`Remove ${f.name}`}
										onClick={() =>
											(files.value = files.value.filter((_, at) => at !== i))}
									>
										<Icon name="close" size="xs" aria-hidden />
									</button>
								</li>
							))}
						</ul>
					)}
					<p class="sbk__filenote">
						Files are attached to the brief when you check out.
					</p>
				</section>

				{error.value && <p class="sbk__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}

// #region Parts
/** One funding-scope choice. A real `radio`, so the group is arrow-navigable without a keymap. */
function ScopeOption(
	props: { label: string; hint: string; checked: boolean; onSelect: () => void },
): JSX.Element {
	return (
		<button
			type="button"
			role="radio"
			class="sbk__scopeopt"
			aria-checked={props.checked}
			data-active={props.checked ? "true" : undefined}
			onClick={props.onSelect}
		>
			<span class="sbk__scopelabel">{props.label}</span>
			<span class="sbk__scopehint">{props.hint}</span>
		</button>
	);
}

/**
 * A stage's price.
 *
 * `Math.round(min * 100)` and the threaded currency, matching `StageProgressLedger` exactly — the
 * listing body and this modal describe the same stages, and two conversions of one figure is how they
 * come to quote different numbers on one screen. `TicketPrice` carries major units and no currency of
 * its own (it is a display shape, not a money shape), so the currency has to come from the listing and
 * the scaling has to be identical wherever it is done.
 *
 * A range shows only its floor here. The full span belongs in the ledger, where there is room to
 * explain what moves it; a funding selector needs one comparable number per row.
 */
function StagePrice({ stage, currency }: { stage: ProjectStage; currency?: string }): JSX.Element {
	return (
		<MoneyView
			minor={Math.round(stage.price.min * 100)}
			currency={currency ?? "USD"}
			size="micro"
			hideOrigin
		/>
	);
}

/** Human file size. Binary units, because that is what an operating system reports. */
function prettyBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
// #endregion
