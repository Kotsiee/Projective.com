import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Select, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import "../styles/project-apply.css";
import "@features/proposals/styles/proposals.css";
import type { ProjectStage } from "@projective/types/explore";
import { HIRE_MESSAGE_MAX, type SentApplication } from "@projective/types/projects";
import type { WorkspaceSummary } from "@projective/types/workspace";
import { WorkspaceService } from "@web/features/workspaces/core/WorkspaceService.ts";
import { AllowanceService } from "@features/proposals/core/AllowanceService.ts";
import {
	type AllowanceSnapshot,
	disclosureLine,
} from "@features/proposals/core/allowance-model.ts";
import {
	afterApplied,
	ensureAllowance,
	refreshSentProposals,
	sentProposals,
	simulated,
	withdrawProposal,
} from "@features/proposals/core/allowance-state.ts";
import { AllowanceNotice } from "@features/proposals/components/AllowanceNotice.tsx";
import { CtaButton } from "../components/CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { applyOpen, applyProjectSlug } from "../core/view-state.ts";

/** The applicant picker's value for "apply as yourself"; anything else is a team id. */
const SELF = "self";

export interface ProjectApplyModalProps {
	/** The listing's project slug (`prj-…`). */
	projectSlug: string;
	title: string;
	stages: readonly ProjectStage[];
	/** The acting team, when the viewer is acting as one — preselected as the applicant. */
	actingTeamId?: string | null;
}

/**
 * ProjectApplyModal — the listing's one application surface (`DESIGN_SYSTEM.md` §D.7): which stage
 * (and role), who applies (you, or a team you may bind), an optional cover note, and the proposal
 * allowance's **pre-flight gate**.
 *
 * Mounted ONCE per listing page by `EntityViewPage` (outside the lane and the bar, which hide each
 * other by `display`), and opened by the shared `ProjectCtaRig` / `ProjectActions` through `applyOpen`.
 *
 * # The gate
 *
 * On open, and whenever the applicant changes, it reads that applicant's allowance
 * (`GET /api/user/allowance?as=self | ?team=`). When the status says the application would be refused —
 * an enforced empty buffer or spent week, a one-member team, a team the viewer may not bind — the submit
 * stays disabled and an `AllowanceNotice` says why, with a live countdown to the next token. While
 * enforcement is off (Decision #58's switch) the same notice says it will still go through, and submit
 * stays enabled. The server's `422` is the backstop for everything this cannot know.
 *
 * # Already applied
 *
 * The viewer's pending proposals on this project are listed first, each with **Withdraw proposal
 * (refunds 1 proposal)**; a withdrawal re-reads the shared store, so the lane's "N ready", the header
 * popover and the CTA's "Applied" all move with no reload.
 */
export default function ProjectApplyModal(
	{ projectSlug, title, stages, actingTeamId = null }: ProjectApplyModalProps,
): JSX.Element {
	const open = applyOpen;
	const accepting = stages.filter((s) => s.acceptingApplications);

	const applicant = useSignal<string>(actingTeamId ?? SELF);
	const teams = useSignal<readonly WorkspaceSummary[] | null>(null);
	const stage = useSignal<string>(accepting[0]?.id ?? "");
	const role = useSignal<string>("");
	const note = useSignal("");
	const read = useSignal<AllowanceSnapshot | null>(null);
	const readError = useSignal<string | null>(null);
	const reading = useSignal(false);
	const error = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const withdrawing = useSignal<string | null>(null);
	const announcement = useSignal("");
	const cta = useCtaFeedback();

	// Seed the page's slug so "Applied" can be derived, and read the stores once (external fetches).
	useEffect(() => {
		applyProjectSlug.value = projectSlug;
		void refreshSentProposals();
		ensureAllowance();
	}, [projectSlug]);

	/** Read the selected applicant's allowance — the subject this application would be metered against. */
	async function readApplicant(): Promise<void> {
		const who = applicant.peek();
		reading.value = true;
		const res = await AllowanceService.status(who === SELF ? { personal: true } : { teamId: who });
		reading.value = false;
		if (applicant.peek() !== who) return; // the picker moved on while this was in flight
		read.value = res.status ? { status: res.status, receivedAt: Date.now() } : null;
		readError.value = res.status
			? null
			: res.code === 403
			? "You aren't an active member of that team."
			: null;
	}

	// On open: the applicant's allowance, and (once) the teams the viewer could apply for.
	useSignalEffect(() => {
		if (!open.value) return;
		void readApplicant();
		if (teams.peek() === null) {
			void WorkspaceService.roster("team").then((res) => {
				teams.value = res.ok && res.data
					? res.data.items.filter((t) => t.status !== "archived")
					: [];
			});
		}
	});

	// Reset the form (not the stores) whenever the dialog closes.
	useSignalEffect(() => {
		if (open.value) return;
		note.value = "";
		error.value = null;
		confirming.value = null;
		cta.reset();
	});

	const snapshot = useComputed(() => simulated(read.value));
	const status = snapshot.value?.status ?? null;
	const pending: readonly SentApplication[] = (sentProposals.value ?? []).filter((row) =>
		row.projectSlug === projectSlug && row.status === "pending"
	);
	const chosenStage = accepting.find((s) => s.id === stage.value);
	const roleOptions = (chosenStage?.roles ?? []).filter((r) => r.id);
	const blocked = status ? !status.canApply : !!readError.value;
	const canSubmit = !!chosenStage && !blocked && !reading.value;

	const applicantOptions = [
		{ label: "Yourself", value: SELF },
		...(teams.value ?? []).map((t) => ({ label: `${t.name} (team)`, value: t.id })),
	];

	async function submit(): Promise<boolean> {
		if (!chosenStage) return false;
		error.value = null;
		const res = await AllowanceService.apply({
			projectId: projectSlug,
			stageId: chosenStage.id,
			roleId: role.value || null,
			message: note.value,
			teamId: applicant.value === SELF ? null : applicant.value,
		});
		if (!res.ok) {
			error.value = res.message ?? "That application couldn't be sent.";
			// A refusal from the gate means the meter moved under us — show the current figures.
			if (res.errors?.allowance) void readApplicant();
			return false;
		}
		afterApplied();
		void readApplicant();
		announcement.value = `Proposal sent to ${title}.`;
		setTimeout(() => (open.value = false), 1200);
		return true;
	}

	async function withdraw(row: SentApplication): Promise<void> {
		withdrawing.value = row.id;
		const result = await withdrawProposal(row.id);
		withdrawing.value = null;
		confirming.value = null;
		announcement.value = result.ok
			? "Proposal withdrawn. One proposal returned to this week's allowance."
			: result.message;
		void readApplicant();
	}

	return (
		<>
			<Dialog
				visible={open}
				onVisibleChange={(next) => (open.value = next)}
				header={`Apply to ${title}`}
				width="min(36rem, 94vw)"
				class="pam"
				footer={
					<div class="pam__footer">
						<p class="pam__cost">
							{status ? `Uses ${disclosureLine(status)}` : "Applying uses 1 proposal token."}
						</p>
						<CtaButton
							label="Send proposal"
							settledLabel="Sent"
							phase={cta.phase}
							variant="filled"
							disabled={!canSubmit}
							icon={<Icon name="send" size="sm" aria-hidden />}
							fluid={false}
							onClick={() => void cta.run(submit)}
						/>
					</div>
				}
			>
				<div class="pam__body">
					{pending.length > 0
						? (
							<section class="pam__pending" aria-label="Your pending proposals here">
								<p class="pam__label">You've already applied</p>
								<ul class="pam__pendinglist">
									{pending.map((row) => (
										<li key={row.id} class="pam__pendingrow">
											<span class="pam__pendingname">
												{[
													row.stageName ?? row.stageSlug,
													row.roleTitle,
													row.teamName && `as ${row.teamName}`,
												]
													.filter(Boolean).join(" · ")}
											</span>
											<span class="prop-list__status" data-status="pending">
												<span class="prop-list__dot" aria-hidden="true" />
												Awaiting approval
											</span>
											{row.canWithdraw
												? confirming.value === row.id
													? (
														<span class="pam__pendingactions">
															<button
																type="button"
																class="prop-list__btn prop-list__btn--danger"
																disabled={withdrawing.value === row.id}
																onClick={() => void withdraw(row)}
															>
																{withdrawing.value === row.id ? "Withdrawing…" : "Confirm withdraw"}
															</button>
															<button
																type="button"
																class="prop-list__btn"
																onClick={() => (confirming.value = null)}
															>
																Keep
															</button>
														</span>
													)
													: (
														<button
															type="button"
															class="prop-list__btn"
															onClick={() => (confirming.value = row.id)}
														>
															Withdraw proposal (refunds 1 proposal)
														</button>
													)
												: null}
										</li>
									))}
								</ul>
							</section>
						)
						: null}

					{accepting.length === 0
						? <p class="pam__none">No stage on this project is taking applications right now.</p>
						: (
							<>
								<div class="pam__row">
									<label class="pam__field">
										<span class="pam__label">Stage</span>
										<Select
											value={stage}
											fluid
											aria-label="Stage"
											options={accepting.map((s) => ({
												label: `${s.index}. ${s.name}`,
												value: s.id,
											}))}
											onValueChange={(v) => {
												stage.value = v ?? "";
												role.value = "";
											}}
										/>
									</label>
									{roleOptions.length > 0
										? (
											<label class="pam__field">
												<span class="pam__label">Role</span>
												<Select
													value={role}
													fluid
													aria-label="Role"
													options={[
														{ label: "Any role on this stage", value: "" },
														...roleOptions.map((r) => ({ label: r.name, value: r.id ?? "" })),
													]}
													onValueChange={(v) => (role.value = v ?? "")}
												/>
											</label>
										)
										: null}
								</div>

								<label class="pam__field">
									<span class="pam__label">Apply as</span>
									<Select
										value={applicant}
										fluid
										aria-label="Apply as"
										loading={teams.value === null && open.value}
										options={applicantOptions}
										onValueChange={(v) => {
											applicant.value = v ?? SELF;
											void readApplicant();
										}}
									/>
								</label>

								<label class="pam__field">
									<span class="pam__label">
										Cover note <span class="pam__optional">(optional)</span>
									</span>
									<Textarea
										value={note}
										rows={4}
										autoResize
										maxRows={10}
										maxLength={HIRE_MESSAGE_MAX}
										fluid
										aria-label="Cover note"
										placeholder="A line on why you fit this stage. It opens your conversation with the client."
										onValueChange={(v) => (note.value = v)}
									/>
								</label>
							</>
						)}

					{snapshot.value ? <AllowanceNotice snapshot={snapshot.value} /> : null}
					{readError.value ? <p class="pam__error" role="alert">{readError.value}</p> : null}
					{error.value ? <p class="pam__error" role="alert">{error.value}</p> : null}
				</div>
			</Dialog>
			<p class="ui-visually-hidden" role="status" aria-live="polite">{announcement.value}</p>
		</>
	);
}
