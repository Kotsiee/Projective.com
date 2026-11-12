import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, FormControl, Textarea } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import "@features/profile/styles/profile-hire.css";
import "../styles/service-booking.css";
import { CtaButton } from "../components/CtaButton.tsx";
import { OfferLedger } from "../components/OfferLedger.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { commitConfigure } from "../core/booking-commits.ts";
import { flatLedger, stageLedger } from "../core/conversion-ledger.ts";
import type { OfferSummary } from "../core/offer-summary.ts";
import {
	clearSimulationOutcome,
	SIMULATED_COMMIT_LABEL,
	SIMULATED_SETTLED_LABEL,
	simulating,
} from "../core/simulation.ts";
import { SimulationOutcome } from "../components/SimulationNotices.tsx";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import type {
	IntakeField,
	ServiceBookingOffer,
	StageFundingScope,
} from "@projective/types/services";
import type { ProjectStage } from "@projective/types/explore";
import { IntakeFields } from "@web/features/profile/components/hire/IntakeFields.tsx";
import { SplitModal } from "@web/features/profile/components/hire/SplitModal.tsx";
import { useIntakeAnswers } from "../hooks/useIntakeAnswers.ts";

/**
 * ScopeBriefModal — the **Continue** dialog for the two scoped formats, in the shared two-column
 * conversion frame (`SplitModal`, Decision #424).
 *
 * LEFT, in the fixed order every `/view` conversion dialog keeps: the commitment (a One-Off's funding
 * scope — stage 1, or the whole engagement), the buyer's specification (the required brief), the
 * seller's own intake questions, then reference files. RIGHT, the live offer ledger: the stages the
 * scope funds and their total, re-derived on every change. FOOTER, the state in words and the one
 * tier-1 commit.
 *
 * # Why the brief is required
 *
 * It is the specification the engagement is delivered against. A stage funded against a scope nobody
 * wrote down is a dispute waiting for a trigger, so Continue refuses until there is one, and says so
 * on the field rather than in a tooltip.
 *
 * # Attachments are staged by name
 *
 * The file list is real and nothing is uploaded until the asset pipeline lands (`FILES_BACKEND_LIVE`);
 * the dialog says so rather than implying it.
 */
export interface ScopeBriefModalProps {
	offer: ServiceBookingOffer;
	/** The listing's stages, for the One-Off funding selector. Empty for a Single Task. */
	stages?: readonly ProjectStage[];
	/** The listing's own currency, so every figure scales the way the body's stage ledger does. */
	currency?: string;
	/** The listing's own intake questions (`ServiceView.intake`), asked beside the brief. */
	intake?: readonly IntakeField[];
	/** The listing as the page names it — the offer column's cover, title, seller and price. */
	summary: OfferSummary;
}

const BRIEF_MAX = 8000;
const FILES_MAX = 10;

export default function ScopeBriefModal(
	{ offer: ssrOffer, stages = [], currency, intake = [], summary }: ScopeBriefModalProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "scope");
	const isOneOff = useComputed(() => offer.value.format === "one_off" && stages.length > 0);

	const requirements = useSignal("");
	const briefRefused = useSignal(false);
	const scope = useSignal<StageFundingScope>("first_stage");
	const files = useSignal<readonly File[]>([]);
	const fileNote = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();
	const bodyRef = useRef<HTMLDivElement>(null);
	const firstRef = useRef<HTMLDivElement>(null);
	const briefRef = useRef<HTMLDivElement>(null);
	const intakeState = useIntakeAnswers(intake, bodyRef);

	useEffect(() => {
		if (open.value) {
			clearSimulationOutcome();
			return;
		}
		requirements.value = "";
		briefRefused.value = false;
		scope.value = "first_stage";
		files.value = [];
		fileNote.value = null;
		error.value = null;
		intakeState.reset();
		cta.reset();
	}, [open.value]);

	const funded = useComputed<readonly ProjectStage[]>(() =>
		!isOneOff.value ? [] : scope.value === "whole_project" ? stages : stages.slice(0, 1)
	);

	const ledger = useComputed(() =>
		isOneOff.value
			? stageLedger(funded.value, currency ?? summary.price.amount?.currency ?? "USD")
			: flatLedger(summary.price, "One fixed-scope deliverable")
	);

	async function submit(): Promise<boolean> {
		const brief = requirements.value.trim();
		error.value = null;
		if (!brief) {
			briefRefused.value = true;
			briefRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
			return false;
		}
		if (!intakeState.check()) return false;

		const out = await commitConfigure({
			subjectId: offer.value.subjectId,
			format: offer.value.format,
			requirements: brief,
			fundingScope: scope.value,
			stageIds: funded.value.map((s) => s.id),
			attachments: files.value.map((f) => ({
				name: f.name,
				sizeBytes: f.size,
				mimeType: f.type || undefined,
				assetId: null,
			})),
			answers: intakeState.answers.value,
		});
		if (out.simulated) return true;
		const res = out.value;
		if (!res.ok || !res.data) {
			if (intakeState.fromServer(res.message, res.errors)) return false;
			error.value = res.message ?? "We couldn't stage that just now.";
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
		const next = [...files.value, ...Array.from(list)];
		fileNote.value = next.length > FILES_MAX
			? `Up to ${FILES_MAX} files. The extras were not added.`
			: null;
		files.value = next.slice(0, FILES_MAX);
	}

	const total = ledger.value.total;
	const stageCount = stages.length;

	const left = (
		<div class="sbk__form">
			{isOneOff.value && (
				<section
					class="sbk__section"
					aria-labelledby="sbk-scope-label"
					ref={firstRef}
					tabIndex={-1}
				>
					<h3 class="sbk__sectiontitle" id="sbk-scope-label">What to fund now</h3>
					<div class="sbk__scope" role="radiogroup" aria-labelledby="sbk-scope-label">
						<ScopeOption
							label="Stage 1 only"
							hint="Fund the first stage. The rest follow as the work does."
							checked={scope.value === "first_stage"}
							onSelect={() => (scope.value = "first_stage")}
						/>
						<ScopeOption
							label="The whole engagement"
							hint={`Fund all ${stageCount} stages up front.`}
							checked={scope.value === "whole_project"}
							onSelect={() => (scope.value = "whole_project")}
						/>
					</div>
				</section>
			)}

			<section class="sbk__section" ref={isOneOff.value ? undefined : firstRef} tabIndex={-1}>
				<div ref={briefRef}>
					<FormControl
						label="What do you need?"
						hint="This is the specification the work is delivered against — the clearer it is, the faster the first submission lands."
						error={briefRefused.value && !requirements.value.trim()
							? "Describe what you need — this is what the work is delivered against."
							: undefined}
						status={briefRefused.value && !requirements.value.trim() ? "invalid" : "default"}
						required
					>
						{(a) => (
							<Textarea
								id="sbk-scope-brief"
								aria-describedby={a.describedBy}
								status={a.status}
								required
								value={requirements}
								rows={5}
								maxRows={12}
								autoResize
								maxLength={BRIEF_MAX}
								fluid
							/>
						)}
					</FormControl>
				</div>
			</section>

			{intake.length > 0 && (
				<section class="sbk__section" aria-labelledby="sbk-scope-intake-label">
					<h3 class="sbk__sectiontitle" id="sbk-scope-intake-label">
						{offer.value.contact.sellerName} asks
					</h3>
					<IntakeFields
						fields={intake}
						answers={intakeState.answers}
						refusal={intakeState.refusal()}
						idPrefix="sbk-scope-intake"
					/>
				</section>
			)}

			<section class="sbk__section" aria-labelledby="sbk-scope-files-label">
				<h3 class="sbk__sectiontitle" id="sbk-scope-files-label">Reference files</h3>
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
									onClick={() => (files.value = files.value.filter((_, at) => at !== i))}
								>
									<Icon name="close" size="xs" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				)}
				<p class="sbk__filenote">
					{fileNote.value ?? "Files are attached to the brief when you check out."}
				</p>
			</section>

			{error.value && (
				<InlineNotice
					assertive
					align="start"
					class="sbk__notice"
					icon={<Icon name="error" size="xs" />}
					text={error.value}
					actionLabel="Try again"
					busy={cta.phase === "pending"}
					onAction={() => void cta.run(submit)}
				/>
			)}
			{simulating.value && <SimulationOutcome />}
		</div>
	);

	return (
		<SplitModal
			open={open}
			title={isOneOff.value
				? `Scope ${offer.value.subjectTitle}`
				: `Brief for ${offer.value.subjectTitle}`}
			subtitle={isOneOff.value ? "One-off engagement" : "Fixed-scope deliverable"}
			left={left}
			right={<OfferLedger summary={summary} ledger={ledger.value} escrows={offer.value.escrows} />}
			asideLabel="Your order"
			summary={
				<>
					<span class="sbk__summarymain">
						{isOneOff.value
							? `Funding ${funded.value.length} of ${stageCount} ${
								stageCount === 1 ? "stage" : "stages"
							}`
							: "One fixed-scope deliverable"}
						{total && (
							<span class="sbk__summarytotal">
								{" · "}
								<MoneyView minor={total.amount.minor} currency={total.amount.currency} hideOrigin />
							</span>
						)}
					</span>
					<span class="sbk__summarynote">You review everything at checkout before paying.</span>
				</>
			}
			actions={
				<>
					<Button variant="text" severity="secondary" label="Cancel" onClick={closeBookingPanel} />
					<CtaButton
						label={simulating.value ? SIMULATED_COMMIT_LABEL : "Continue to checkout"}
						settledLabel={simulating.value ? SIMULATED_SETTLED_LABEL : "Staged"}
						phase={cta.phase}
						tone="accent"
						icon={<Icon name="arrow-right" size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</>
			}
			initialFocusRef={firstRef}
			bodyRef={bodyRef}
			onClose={closeBookingPanel}
			class="sbk-split"
		/>
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
