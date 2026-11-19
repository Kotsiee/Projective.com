import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, FormControl, Textarea } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "@features/profile/styles/profile-hire.css";
import "../styles/service-booking.css";
import { CtaButton } from "../components/CtaButton.tsx";
import { OfferLedger } from "../components/OfferLedger.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { commitPipeline } from "../core/booking-commits.ts";
import { BookingService } from "../core/BookingService.ts";
import { pipelineLedger } from "../core/conversion-ledger.ts";
import type { OfferSummary } from "../core/offer-summary.ts";
import {
	clearSimulationOutcome,
	SIMULATED_SETTLED_LABEL,
	simulating,
} from "../core/simulation.ts";
import { SimulationOutcome } from "../components/SimulationNotices.tsx";
import {
	announce,
	applyOffer,
	closeBookingPanel,
	currentOffer,
	openPanel,
} from "../core/booking-state.ts";
import type { IntakeField, ServiceBookingOffer } from "@projective/types/services";
import type { ProjectStage } from "@projective/types/explore";
import { IntakeFields } from "@web/features/profile/components/hire/IntakeFields.tsx";
import { SplitModal } from "@web/features/profile/components/hire/SplitModal.tsx";
import { useIntakeAnswers } from "../hooks/useIntakeAnswers.ts";

/** Props for {@link PipelineBriefModal}. */
export interface PipelineBriefModalProps {
	offer: ServiceBookingOffer;
	/** The pipeline's stages, listed at their own prices in the offer column. */
	stages?: readonly ProjectStage[];
	/** The listing's own currency. */
	currency?: string;
	/** The seller's intake questions, asked beside the requirements. */
	intake?: readonly IntakeField[];
	/** The listing as the page names it — the offer column's cover, title, seller. */
	summary: OfferSummary;
}

const BRIEF_MAX = 8000;
const NAVIGATE_DELAY_MS = 700;

/**
 * PipelineBriefModal — the **Add to projects** dialog for a Pipeline listing, in the shared two-column
 * conversion frame (`SplitModal`). Left: the buyer's requirements and the seller's own questions.
 * Right: the stages at their own prices, with nothing due. The footer's one primary creates the draft
 * (`POST /api/services/instantiate-pipeline`, brief and answers kept on the request record) and opens
 * it in Projects.
 */
export default function PipelineBriefModal(
	{ offer: ssrOffer, stages = [], currency, intake = [], summary }: PipelineBriefModalProps,
): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "pipeline");
	const requirements = useSignal("");
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();
	const bodyRef = useRef<HTMLDivElement>(null);
	const firstRef = useRef<HTMLDivElement>(null);
	const intakeState = useIntakeAnswers(intake, bodyRef);

	useEffect(() => {
		if (open.value) {
			clearSimulationOutcome();
			return;
		}
		requirements.value = "";
		error.value = null;
		intakeState.reset();
		cta.reset();
	}, [open.value]);

	const ledger = useComputed(() =>
		pipelineLedger(stages, currency ?? summary.price.amount?.currency ?? "USD")
	);

	async function submit(): Promise<boolean> {
		error.value = null;
		if (!intakeState.check()) return false;
		const subjectId = offer.value.subjectId;
		const out = await commitPipeline({
			serviceId: subjectId,
			workspaceId: null,
			idempotencyKey: `${subjectId}-${loadNonce()}`,
			answers: intakeState.answers.value,
			brief: requirements.value.trim() || undefined,
		});
		if (out.simulated) return true;
		const res = out.value;
		if (!res.ok || !res.data) {
			if (intakeState.fromServer(res.message, res.errors)) return false;
			error.value = res.message ?? "Could not add that to your projects.";
			return false;
		}
		announce(
			res.data.created
				? "Added to your projects as a draft. Opening it now."
				: "This service is already in your projects. Opening it now.",
		);
		const fresh = await BookingService.offer(subjectId);
		if (fresh.ok && fresh.data) applyOffer(fresh.data.offer);
		const route = res.data.draft.boardHref;
		setTimeout(() => globalThis.location.assign(route), NAVIGATE_DELAY_MS);
		return true;
	}

	const stageCount = stages.length;

	const left = (
		<div class="sbk__form">
			<section class="sbk__section" ref={firstRef} tabIndex={-1}>
				<FormControl
					label="What do you need?"
					hint="Describe your requirements: goals, constraints, links. It goes to the seller with the project, and you can refine it on the board."
				>
					{(a) => (
						<Textarea
							id="sbk-pipeline-brief"
							aria-describedby={a.describedBy}
							value={requirements}
							rows={5}
							maxRows={12}
							autoResize
							maxLength={BRIEF_MAX}
							placeholder="The goal, who it's for, what's out of scope, and links to anything you like"
							fluid
						/>
					)}
				</FormControl>
			</section>

			{intake.length > 0 && (
				<section class="sbk__section" aria-labelledby="sbk-pipeline-intake-label">
					<h3 class="sbk__sectiontitle" id="sbk-pipeline-intake-label">
						{offer.value.contact.sellerName} asks
					</h3>
					<IntakeFields
						fields={intake}
						answers={intakeState.answers}
						refusal={intakeState.refusal()}
						idPrefix="sbk-pipeline-intake"
					/>
				</section>
			)}

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
			title={`Add ${offer.value.subjectTitle} to your projects`}
			subtitle="Pipeline service · saved as a draft project"
			left={left}
			right={<OfferLedger summary={summary} ledger={ledger.value} escrows={false} />}
			asideLabel="The stages"
			summary={
				<>
					<span class="sbk__summarymain">
						{stageCount === 1 ? "1 stage" : `${stageCount} stages`} · nothing due now
					</span>
					<span class="sbk__summarynote">You fund each stage per ticket, from the board.</span>
				</>
			}
			actions={
				<>
					<Button variant="text" severity="secondary" label="Cancel" onClick={closeBookingPanel} />
					<CtaButton
						label="Open Projects"
						ariaLabel={`Add ${offer.value.subjectTitle} to your projects and open it`}
						settledLabel={simulating.value ? SIMULATED_SETTLED_LABEL : "Opening…"}
						phase={cta.phase}
						tone="accent"
						icon={<Icon name="arrow-right" size="sm" aria-hidden />}
						fluid={false}
						spark
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

let nonce: string | null = null;

/** A per-page-load nonce, so a double-press or a retry within one load resolves to the same draft. */
function loadNonce(): string {
	if (nonce) return nonce;
	try {
		nonce = crypto.randomUUID();
	} catch {
		nonce = `${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
	}
	return nonce;
}
