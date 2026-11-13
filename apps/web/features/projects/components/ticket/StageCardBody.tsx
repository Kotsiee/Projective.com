import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type BoardStageRef,
	formatTicketMoney,
	LOCKED_INTENSITY_HINT,
	stageIntensityLocked,
	TICKET_INTENSITY_LABEL,
	type TicketIntensity,
} from "../../types/projects-types.ts";
import type { TicketStageView } from "../../core/ticket-view.ts";
import { formatDueDate, isOverdue } from "../../core/ticket-model.ts";
import { UserAvatarStack } from "@web/components/UserAvatar.tsx";

/**
 * StageCardBody — what a stage card says, laid out like `TicketCard`: the name on top, then one Meta
 * line (step · intensity · due, middot-separated, never pills) with the price at its end. It is the
 * card's non-interactive content and the drag ghost's, so nothing here takes focus: each tooltip
 * trigger carries its sentence as an `aria-label` and reaches assistive tech through the card's
 * description.
 *
 * @module
 */

const RUNNING_NOTE = "This stage is already running — work added here starts immediately.";
const REMOVED_NOTE =
	"This stage has been removed from the engagement. The ticket keeps the price it was agreed at.";

const dot = <span class="tkc-stage__dot" aria-hidden="true">·</span>;

function Intensity(
	props: { stage: BoardStageRef | null; intensity: TicketIntensity },
): JSX.Element {
	const label = `${TICKET_INTENSITY_LABEL[props.intensity]} intensity`;
	if (!stageIntensityLocked(props.stage)) return <span>{label}</span>;
	return (
		<Tooltip content={LOCKED_INTENSITY_HINT}>
			<span class="tkc-stage__fixed" aria-label={`${label}, fixed by the service provider`}>
				<Icon name="lock" size="2xs" />
				{label}
			</span>
		</Tooltip>
	);
}

function Cost(props: { cents: number | null; currency: string }): JSX.Element {
	return props.cents === null
		? <span class="tkc-stage__cost tkc-stage__cost--none">No rate</span>
		: <span class="tkc-stage__cost">{formatTicketMoney(props.cents, props.currency)}</span>;
}

function Lock(props: { reason: string }): JSX.Element {
	return (
		<Tooltip content={props.reason}>
			<span class="tkc-stage__lock" role="img" aria-label={props.reason}>
				<Icon name="lock" size="2xs" />
			</span>
		</Tooltip>
	);
}

export interface IncludedStageBodyProps {
	item: TicketStageView;
	/** Whether the Meta line names the step — off inside a parallel step, whose label names it. */
	showStep: boolean;
	currency: string;
	/** Why the stage is locked, or `null`. */
	lock: string | null;
}

/** A stage the ticket runs through. */
export function IncludedStageBody(props: IncludedStageBodyProps): JSX.Element {
	const { ref, stage, costCents, workload, band } = props.item;
	const dueLabel = formatDueDate(ref.dueAt ?? null);
	const note = props.lock ?? (stage?.locked ? RUNNING_NOTE : null);
	const capacity = `${TICKET_INTENSITY_LABEL[ref.intensity]} intensity · ${
		workload.toFixed(2).replace(/\.00$/, "")
	} units of a freelancer's capacity`;

	return (
		<>
			<div class="tkc-stage__head">
				<h4 class="tkc-stage__name">{ref.name}</h4>
				{note ? <Lock reason={note} /> : null}
			</div>
			<div class="tkc-stage__foot">
				<p class="tkc-stage__meta">
					{props.showStep
						? (
							<>
								<span>Step {band + 1}</span>
								{dot}
							</>
						)
						: null}
					<Intensity stage={stage} intensity={ref.intensity} />
					{dueLabel
						? (
							<>
								{dot}
								<span data-overdue={isOverdue(ref.dueAt ?? null) ? "true" : undefined}>
									Due {dueLabel}
								</span>
							</>
						)
						: null}
					{stage ? null : (
						<>
							{dot}
							<Tooltip content={REMOVED_NOTE}>
								<span class="tkc-stage__gone" aria-label={REMOVED_NOTE}>
									Removed from the project
								</span>
							</Tooltip>
						</>
					)}
				</p>
				<div class="tkc-stage__end">
					{stage
						? (
							<UserAvatarStack
								people={stage.members}
								max={3}
								size={20}
								aria-label={stage.members.length === 0
									? "No one assigned"
									: `${stage.members.length} assigned: ${
										stage.members.map((m) => m.name).join(", ")
									}`}
							/>
						)
						: null}
					<Tooltip content={capacity}>
						<Cost cents={costCents} currency={props.currency} />
					</Tooltip>
				</div>
			</div>
		</>
	);
}

export interface AvailableStageBodyProps {
	stage: BoardStageRef;
	/** The intensity it would join the ticket at, and what it would add at it. */
	intensity: TicketIntensity;
	costCents: number | null;
	currency: string;
}

/** A project stage the ticket does not run through yet. */
export function AvailableStageBody(props: AvailableStageBodyProps): JSX.Element {
	return (
		<>
			<div class="tkc-stage__head">
				<h4 class="tkc-stage__name">{props.stage.name}</h4>
			</div>
			<div class="tkc-stage__foot">
				<p class="tkc-stage__meta">
					<span>Not in this ticket</span>
					{dot}
					<Intensity stage={props.stage} intensity={props.intensity} />
				</p>
				<div class="tkc-stage__end">
					<Cost cents={props.costCents} currency={props.currency} />
				</div>
			</div>
		</>
	);
}
