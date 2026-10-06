import type { JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import {
	type NextAction,
	type NextActionKind,
	type ProjectStatus,
	WORKSPACE_STAGE_STATE_LABEL,
	type WorkspacePeople,
	type WorkspaceStage,
	type WorkspaceViewer,
} from "@projective/types/projects";
import { Block, Empty } from "../dashboard/DashboardBlocks.tsx";
import { projectDetailsHref, projectHref } from "../../core/project-access.ts";

/**
 * The blocks only the Overview draws (Decision #144) — beside the dashboard's existing Recent updates,
 * Messages, Your work and Your earnings, which it reuses unchanged.
 *
 * The same rules as every `pjd-*` block: a section-register heading over its content, spacing as the
 * boundary, one hairline between rows and none around a block (DESIGN_SYSTEM §B.4, §B.9). Every row is
 * an `<a>` to the place the work is done, so the surface needs no buttons of its own — its two
 * commands live in the footer band.
 */

// #region Needs you
const ACTION_ICON: Record<NextActionKind, IconName> = {
	review_submissions: "submission",
	decide_applications: "user-plus",
	set_pricing: "wallet",
	revise_work: "refresh",
	deliver_work: "ticket",
};

/**
 * "Needs you" — what the viewer could do next, most pressing first.
 *
 * An empty list is a fact worth stating ("nothing needs you"), not a blank: on an engagement that is
 * running smoothly it is the most useful thing the page can say.
 */
export function NextActionsBlock(
	{ actions, closed }: { actions: readonly NextAction[]; closed: boolean },
): JSX.Element {
	return (
		<Block title="Needs you">
			{actions.length === 0
				? (
					<Empty>
						{closed
							? "Nothing is waiting on you. This project has closed."
							: "Nothing needs you right now."}
					</Empty>
				)
				: (
					<ul class="pjd-list pjd-next">
						{actions.map((action) => (
							<li key={action.kind}>
								<a class="pjd-row pjd-next__row" href={action.href}>
									<span class="pjd-row__icon" aria-hidden="true">
										<Icon name={ACTION_ICON[action.kind]} size="sm" />
									</span>
									<span class="pjd-row__body">
										<span class="pjd-row__title">{action.label}</span>
										{action.context && <span class="pjd-row__sub">{action.context}</span>}
									</span>
									<span class="pjd-row__end pjd-next__go" aria-hidden="true">
										<Icon name="chevron-right" size="sm" />
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
		</Block>
	);
}
// #endregion

// #region Stage run
/** The facts beneath a stage's name, in reading order. */
function stageFacts(stage: WorkspaceStage, showState: boolean): string[] {
	const out: string[] = [];
	if (showState) out.push(WORKSPACE_STAGE_STATE_LABEL[stage.state]);
	if (stage.tickets && stage.tickets.total > 0) {
		out.push(`${stage.tickets.done} of ${stage.tickets.total} tickets delivered`);
	} else if (stage.tickets) {
		out.push("No tickets yet");
	}
	if (stage.mine) out.push("Your stage");
	return out;
}

/**
 * The run: one hairline track with each stage's ordinal on it, the stage's name over its facts, and —
 * for the owner — its price at the row's end.
 *
 * The state reads as words only when the run holds more than one state: a column of identical labels
 * distinguishes nothing, so on a run where every stage is "In progress" the word is left out and the
 * ring's colour alone carries it. A participant may open only the rooms of the stages they are seated
 * on; any other stage is named, not linked, because its room would refuse them.
 */
export function StageRunBlock(
	{ stages, viewer }: { stages: readonly WorkspaceStage[]; viewer: WorkspaceViewer },
): JSX.Element {
	const delivered = stages.filter((s) => s.state === "delivered").length;
	const showState = new Set(stages.map((s) => s.state)).size > 1;
	return (
		<Block title="Stages" region="stages">
			<p class="pjd-run__summary">
				{delivered} of {stages.length} {stages.length === 1 ? "stage" : "stages"} delivered
			</p>
			<ol class="pjd-track">
				{stages.map((stage) => {
					const linked = viewer === "owner" || stage.mine;
					const facts = stageFacts(stage, showState);
					return (
						<li
							key={stage.id}
							class="pjd-track__stage"
							data-state={stage.state}
							data-mine={stage.mine ? "true" : undefined}
						>
							<span class="pjd-track__ring" aria-hidden="true">{stage.ordinal}</span>
							<span class="pjd-track__body">
								{linked
									? <a class="pjd-track__name" href={stage.href}>{stage.name}</a>
									: <span class="pjd-track__name">{stage.name}</span>}
								{(facts.length > 0 || stage.needsPrice) && (
									<span class="pjd-track__facts">
										{facts.map((fact, i) => (
											<span class="pjd-meta__item" key={`${i}:${fact}`}>
												{i > 0 && <span class="pjd-meta__sep" aria-hidden="true">·</span>}
												<span>{fact}</span>
											</span>
										))}
										{stage.needsPrice && (
											<span class="pjd-meta__item">
												{facts.length > 0 && (
													<span class="pjd-meta__sep" aria-hidden="true">·</span>
												)}
												<span class="pjd-track__flag">Needs a price</span>
											</span>
										)}
									</span>
								)}
							</span>
							{stage.price && (
								<span class="pjd-track__price">
									<MoneyView value={stage.price} size="body" />
									{stage.perTicket && <span class="pjd-track__unit">/ ticket</span>}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</Block>
	);
}
// #endregion

// #region People
/**
 * Who is on the engagement. The count is the whole team — the roster's own unfiltered total — so it is
 * truthful even where this viewer's role lists fewer rows. The owner also sees invitations still
 * waiting for an answer; applications are already in Needs you, and are not repeated here.
 */
export function PeopleBlock(
	{ people, slug, viewer }: { people: WorkspacePeople; slug: string; viewer: WorkspaceViewer },
): JSX.Element {
	const members = projectHref(slug, "members");
	return (
		<Block title="People">
			<ul class="pjd-list">
				<li>
					<a class="pjd-row" href={members}>
						<span class="pjd-row__icon" aria-hidden="true">
							<Icon name="members" size="sm" />
						</span>
						<span class="pjd-row__body">
							<span class="pjd-row__title">
								{people.count} {people.count === 1 ? "person" : "people"} on this project
							</span>
						</span>
					</a>
				</li>
				{viewer === "owner" && people.pendingInvitations > 0 && (
					<li>
						<a class="pjd-row" href={`${members}?view=invitations`}>
							<span class="pjd-row__icon" aria-hidden="true">
								<Icon name="mail" size="sm" />
							</span>
							<span class="pjd-row__body">
								<span class="pjd-row__title">
									{people.pendingInvitations === 1
										? "1 invitation awaiting a reply"
										: `${people.pendingInvitations} invitations awaiting a reply`}
								</span>
							</span>
						</a>
					</li>
				)}
			</ul>
		</Block>
	);
}
// #endregion

// #region Lifecycle notice
/**
 * One line saying what the engagement's lifecycle means for the page, or nothing while it is simply
 * running. Body register, unboxed — a fact about the page, not a card on it.
 */
export function OverviewNotice(
	{ status, viewer, slug }: { status: ProjectStatus; viewer: WorkspaceViewer; slug: string },
): JSX.Element | null {
	const text = noticeText(status, viewer);
	if (!text) return null;
	return (
		<p class="pjd-notice" data-status={status}>
			<span class="pjd-notice__icon" aria-hidden="true">
				<Icon name={status === "on_hold" ? "pause" : "info"} size="sm" />
			</span>
			<span>
				{text}
				{viewer === "owner" && status === "draft" && (
					<>
						{" "}
						<a class="pjd-notice__link" href={projectDetailsHref(slug)}>Open Details</a>
					</>
				)}
			</span>
		</p>
	);
}

function noticeText(status: ProjectStatus, viewer: WorkspaceViewer): string | null {
	switch (status) {
		case "draft":
			return viewer === "owner"
				? "This project is a draft. Finish setting it up and publish it from Details."
				: "This project isn’t published yet. Your seat is staged and takes effect when the client publishes it.";
		case "on_hold":
			return "This project is on hold.";
		case "completed":
			return "This project is completed. Its rooms, files and history stay here.";
		case "cancelled":
			return "This project was cancelled. Its rooms, files and history stay here.";
		case "active":
			return null;
	}
}
// #endregion
