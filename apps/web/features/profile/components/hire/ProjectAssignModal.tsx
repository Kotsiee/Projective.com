import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { MoneyView } from "@projective/ui/display/money";
import { Button, Checkbox, Textarea } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { formatMoney } from "@projective/types/finance";
import type { HireBrief, HireInvitation, HireRefusal } from "@projective/types/projects";
import {
	HIRE_MESSAGE_MAX,
	hireInvitationRefusal,
	resolveHireOffer,
} from "@projective/types/projects";
import type { IntakeAnswers, IntakeField, IntakeRefusal } from "@projective/types/services";
import { emptyIntakeAnswers, intakeRefusal } from "@projective/types/services";
import { HireService } from "@features/projects/core/HireService.ts";
import { type HireProject, hireProjectHref } from "../../core/profile-model.ts";
import { focusFirstRefused, focusSuccessAction, IntakeFields } from "./IntakeFields.tsx";
import { ProjectBriefPreview } from "./ProjectBriefPreview.tsx";
import { SplitModal } from "./SplitModal.tsx";

/**
 * ProjectAssignModal — the split modal a project opens from the Add-to-project popover: the
 * assignment of THIS seller to THAT project.
 *
 * LEFT, the client's inputs: an optional message, the seller's own intake fields
 * (`ProfileView.hireIntake` — what they ask before joining anybody's project), and for a staged
 * engagement which stage(s) the seller joins, each with its configured rate printed read-only.
 * RIGHT, the project in the `/view` page's vocabulary ({@link ProjectBriefPreview}). FOOTER: the
 * resolved terms and the primary.
 *
 * # The terms are the project's, resolved — never typed
 *
 * There is no compensation field. An assignment offers what the project already states for each
 * selected stage (`resolveHireOffer`, the SSOT's one implementation), so the figure the seller
 * reads is the figure the project's own setup form shows. An UNPUBLISHED project may state nothing
 * yet: its assignment is a **placeholder** — the seller is attached to the stages now and the terms
 * are settled when the client prices and publishes — and the footer says so in place of a total.
 * A PUBLISHED project with an unpriced stage is refused with the stage named, by the same rule the
 * fat service applies.
 *
 * # One rule, called twice — twice
 *
 * `hireInvitationRefusal` gates the primary and explains a refusal in place, and the service runs
 * it again on the way in; `intakeRefusal` does the same for the seller's questions. Nothing this
 * form lets through is refused for a rule it did not know.
 */
export interface ProjectAssignModalProps {
	/** The project picked in the Add-to-project popover, or `null` while closed. */
	project: Signal<HireProject | null>;
	/** The seller being assigned. */
	seller: { name: string; handle: string };
	/** The seller's own intake — what they ask before joining a project. */
	intake: readonly IntakeField[];
	/** Fired once the assignment has been recorded. */
	onAssigned: (project: HireProject, placeholder: boolean) => void;
}

export default function ProjectAssignModal(
	{ project, seller, intake, onAssigned }: ProjectAssignModalProps,
): JSX.Element {
	const open = useSignal(false);
	const brief = useSignal<HireBrief | null>(null);
	const loadError = useSignal<string | null>(null);
	const loading = useSignal(false);
	const message = useSignal("");
	const answers = useSignal<IntakeAnswers>({});
	const intakeBlock = useSignal<IntakeRefusal | null>(null);
	/** Which stages are selected, by id. */
	const selected = useSignal<Record<string, boolean>>({});
	const sending = useSignal(false);
	const refusal = useSignal<HireRefusal | null>(null);
	const attempted = useSignal(false);
	/** The recorded assignment, once sent — the success state renders from it. */
	const sent = useSignal<
		{ placeholder: boolean; stageCount: number; totalCents: number | null } | null
	>(
		null,
	);
	const firstFieldRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	/** Counts refused attempts; the focus move is keyed on it so it runs AFTER the marks render. */
	const refusedAttempts = useSignal(0);

	const picked = project.value;

	/**
	 * Once an attempt has been refused, the rule re-runs on every answer so a field that has since
	 * been filled stops saying it is required — an error left standing beside a satisfied control is
	 * a stale claim, and the same rule runs again on Send anyway. Before the first attempt nothing
	 * paints (§A.7.5: fields paint on touch, never at rest).
	 */
	useEffect(() => {
		if (!attempted.value) return;
		intakeBlock.value = intakeRefusal(intake, answers.value);
	}, [answers.value]);

	useEffect(() => {
		if (refusedAttempts.value === 0) return;
		focusFirstRefused(bodyRef.current);
	}, [refusedAttempts.value]);

	useEffect(() => {
		if (sent.value) focusSuccessAction(bodyRef.current);
	}, [sent.value]);

	async function load(slug: string): Promise<void> {
		loading.value = true;
		loadError.value = null;
		brief.value = null;
		const res = await HireService.brief(slug);
		if (project.value?.slug !== slug) return; // another project was picked meanwhile
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ?? "Couldn't load this project.";
			return;
		}
		brief.value = res.data.brief;
		// Every stage selected by default: the common case is "join the whole engagement".
		const sel: Record<string, boolean> = {};
		for (const stage of res.data.brief.stages) sel[stage.id] = true;
		selected.value = sel;
	}

	useEffect(() => {
		if (!picked) {
			open.value = false;
			return;
		}
		open.value = true;
		message.value = "";
		answers.value = emptyIntakeAnswers(intake);
		intakeBlock.value = null;
		refusal.value = null;
		attempted.value = false;
		sent.value = null;
		sending.value = false;
		void load(picked.slug);
	}, [picked?.slug]);

	function close(): void {
		project.value = null;
	}

	/** The invitation as the SSOT shapes it — at the project's own terms (`priceCents: null`). */
	function draft(): HireInvitation | null {
		const b = brief.value;
		if (!b) return null;
		return {
			projectId: b.projectId,
			handle: seller.handle,
			message: message.value.trim(),
			stages: b.pricingModel === "task"
				? []
				: b.stages.filter((s) => selected.value[s.id]).map((s) => ({
					stageId: s.id,
					priceCents: null,
				})),
			taskPriceCents: null,
			answers: answers.value,
		};
	}

	async function send(): Promise<void> {
		const b = brief.value;
		const input = draft();
		if (!b || !input || !picked || sending.value) return;
		attempted.value = true;
		const intakeProblem = intakeRefusal(intake, answers.value);
		intakeBlock.value = intakeProblem;
		const blocked = hireInvitationRefusal(b, input);
		refusal.value = blocked;
		if (intakeProblem || blocked) {
			refusedAttempts.value++;
			return;
		}

		sending.value = true;
		const res = await HireService.invite(input);
		sending.value = false;
		if (!res.ok || !res.data) {
			refusal.value = {
				message: res.message ?? "The assignment could not be recorded.",
				errors: res.errors ?? {},
			};
			return;
		}
		const offer = resolveHireOffer(b, input);
		sent.value = {
			placeholder: res.data.placeholder,
			stageCount: res.data.invites.length,
			totalCents: offer.totalCents,
		};
		onAssigned(picked, res.data.placeholder);
	}

	// ---- Derived presentation ----
	const b = brief.value;
	const input = b ? draft() : null;
	const offer = b && input ? resolveHireOffer(b, input) : null;
	const selectedCount = b ? b.stages.filter((s) => selected.value[s.id]).length : 0;
	const staged = !!b && b.pricingModel !== "task";
	/**
	 * A staged engagement with NO stages yet — a fresh draft. There is nothing to attach the seller
	 * to, so the primary stays withheld and the stage section says where the stages are made; a
	 * footer that printed "£0.00 · 0 stages" over an empty list would be a figure for nothing.
	 */
	const noStages = staged && b.stages.length === 0;
	const stagesRefused = attempted.value && refusal.value?.errors.stages !== undefined;

	const summary = b && offer && !sent.value
		? (
			<>
				<span class="pf-split__summarymain">
					{noStages
						? <span class="pf-split__pending">No stages yet</span>
						: offer.totalCents !== null
						? <MoneyView minor={offer.totalCents} currency={b.currency} hideOrigin />
						: <span class="pf-split__pending">Priced at publish</span>}
				</span>
				<span class="pf-split__summarymeta">
					{b.pricingModel === "per_ticket_stage"
						? `Per ticket · ${selectedCount} ${selectedCount === 1 ? "stage" : "stages"}`
						: b.pricingModel === "per_stage"
						? `${selectedCount} ${selectedCount === 1 ? "stage" : "stages"}`
						: "Whole engagement"}
					{!picked?.published && (
						<>
							<span class="pf-split__dot" aria-hidden="true">·</span>
							<span>Staged until published</span>
						</>
					)}
				</span>
			</>
		)
		: null;

	const actions = sent.value
		? <Button variant="filled" severity="primary" label="Done" onClick={close} />
		: (
			<>
				<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
				<Button
					variant="filled"
					severity="primary"
					label={sending.value ? "Assigning…" : "Assign to project"}
					loading={sending.value}
					disabled={!b || loading.value || sending.value || (staged && selectedCount === 0)}
					onClick={() => void send()}
				/>
			</>
		);

	const left = sent.value && picked
		? (
			<div class="pf-split__sent" role="status">
				<span class="pf-split__sent-mark" aria-hidden="true">
					<Icon name="check" size="md" />
				</span>
				<h3 class="pf-split__sent-title">
					{sent.value.placeholder
						? `${seller.name} is staged on ${picked.title}`
						: `Invitation sent to ${seller.name}`}
				</h3>
				<p class="pf-split__sent-body">
					{sent.value.placeholder
						? "They are attached to the project now. The terms are settled when you price and publish it, and they will be invited then."
						: `${
							sent.value.stageCount > 1 ? `${sent.value.stageCount} stages` : "One stage"
						} offered${
							sent.value.totalCents !== null && b
								? ` — ${formatMoney(sent.value.totalCents, b.currency)}`
								: ""
						}. They will see the invitation and your message; you can manage it from the project's roster.`}
				</p>
				<a class="pf-split__sent-link" href={hireProjectHref(picked)}>Open the project roster</a>
			</div>
		)
		: (
			<div class="pf-split__form">
				<section class="pf-split__section" aria-labelledby="pf-asg-message-label">
					<div ref={firstFieldRef} tabIndex={-1} class="pf-split__field">
						<label class="pf-split__label" id="pf-asg-message-label" for="pf-asg-message">
							Message to {seller.name}
							<span class="pf-split__optional">Optional</span>
						</label>
						<Textarea
							id="pf-asg-message"
							fluid
							autoResize
							rows={3}
							maxRows={8}
							maxLength={HIRE_MESSAGE_MAX}
							placeholder={`Tell ${seller.name} what you need and why you thought of them…`}
							value={message}
							disabled={loading.value}
						/>
					</div>
				</section>

				{intake.length > 0 && (
					<section class="pf-split__section" aria-labelledby="pf-asg-intake">
						<h3 class="pf-split__label" id="pf-asg-intake">{seller.name} asks</h3>
						<IntakeFields
							fields={intake}
							answers={answers}
							refusal={attempted.value ? intakeBlock.value : null}
							disabled={loading.value || sending.value}
							idPrefix="pf-asg"
						/>
					</section>
				)}

				{noStages && b && picked && (
					<section class="pf-split__section" aria-labelledby="pf-asg-stages">
						<h3 class="pf-split__label" id="pf-asg-stages">Which stages</h3>
						<p class="pf-split__hint">
							This project has no stages yet, so there is nothing to attach {seller.name}{" "}
							to. Add at least one on the project page, then come back.
						</p>
						<a class="pf-split__sent-link" href={`/projects/${picked.slug}`}>
							Open the project setup
						</a>
					</section>
				)}

				{staged && !noStages && b && (
					<section class="pf-split__section" aria-labelledby="pf-asg-stages">
						<h3 class="pf-split__label" id="pf-asg-stages">Which stages</h3>
						<ul
							class="pf-split__stages"
							role="list"
							data-refused={stagesRefused ? "true" : undefined}
						>
							{b.stages.map((stage) => {
								const on = !!selected.value[stage.id];
								return (
									<li
										key={`${b.projectId}:${stage.id}`}
										class="pf-split__stage"
										data-selected={on ? "true" : undefined}
									>
										<Checkbox
											label={stage.name}
											value={on}
											onValueChange={(next: boolean) => {
												selected.value = { ...selected.value, [stage.id]: next };
											}}
											disabled={sending.value}
										/>
										<span class="pf-split__stagemeta">
											{stage.unitPriceCents !== null
												? (
													<MoneyView
														minor={stage.unitPriceCents}
														currency={b.currency}
														size="micro"
														hideOrigin
													/>
												)
												: <span class="pf-split__pending">Priced at publish</span>}
											{stage.memberNames.length > 0 && (
												<>
													<span class="pf-split__dot" aria-hidden="true">·</span>
													<span>{stage.memberNames.join(", ")}</span>
												</>
											)}
										</span>
									</li>
								);
							})}
						</ul>
					</section>
				)}

				{refusal.value && (
					<div class="pf-split__error">
						<Message
							severity="danger"
							variant="subtle"
							size="sm"
							closable
							onClose={() => (refusal.value = null)}
						>
							{refusal.value.message}
						</Message>
					</div>
				)}

				<p class="pf-split__disclosure">
					<Icon name="info" size="xs" aria-hidden />
					<span>
						{picked?.published
							? `Nothing is charged now. ${seller.name} sees the project's stated terms; escrow is funded when work is claimed.`
							: `Nothing is charged now. ${seller.name} is attached as a placeholder until you price and publish the project.`}
					</span>
				</p>
			</div>
		);

	const right = b
		? <ProjectBriefPreview brief={b} />
		: loading.value
		? <p class="pf-split__hint" role="status">Loading the project…</p>
		: null;

	const notice = loadError.value
		? (
			<div class="pf-split__failed" role="alert">
				<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
				<Button
					variant="outlined"
					severity="secondary"
					size="sm"
					label="Try again"
					onClick={() => picked && void load(picked.slug)}
				/>
			</div>
		)
		: null;

	return (
		<SplitModal
			open={open}
			title={picked?.title ?? "Project"}
			subtitle={picked
				? `${picked.scopeLabel}${picked.published ? "" : " · Not published yet"}`
				: undefined}
			left={left}
			right={right}
			summary={summary}
			actions={actions}
			notice={notice}
			loading={loading.value}
			initialFocusRef={firstFieldRef}
			bodyRef={bodyRef}
			onClose={close}
			class="pf-split--project"
		/>
	);
}
