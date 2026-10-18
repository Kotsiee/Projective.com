import type { JSX } from "preact";
import { AvatarStack, MetaLine, Tag } from "@projective/ui/display";
import { ProgressBar } from "@projective/ui/feedback";
import type { AssigneeReadout, EngagementRowModel } from "../core/projects-model.ts";

/**
 * EngagementRow — one of a team's live stage assignments on the console's Projects → Active view
 * (Teams work order C5): the project and the stage (each a link — `prj-` / `stg-` slugs, Decision #88),
 * the seat's lifecycle status as a `Tag`, the people holding live tickets on it as an `AvatarStack`,
 * and each one's Wᵢ on the stage — `3 / 10`, tabular, over a ui `ProgressBar` sized to the stage's
 * per-person cap.
 *
 * A row is never boxed: rows sit on the band's ground and are divided by one `--hairline` (§B.4). The
 * stage's facts are a `MetaLine`, not chips (§B.11); the status is the one container, because it is a
 * lifecycle state. A member at or over their global workload cap is told so in a Meta sentence — the
 * bar keeps its colour, so the words are the whole signal. Every figure and word comes from
 * `engagementRow` (`projects-model.ts`); this component only lays it out.
 */

export interface EngagementRowProps {
	row: EngagementRowModel;
}

/** One engagement. */
export function EngagementRow({ row }: EngagementRowProps): JSX.Element {
	const titleId = `wsp-engagement-${row.key.replace(/[^a-z0-9-]/gi, "-")}`;
	return (
		<li class="wsp-engagement" aria-labelledby={titleId}>
			{/* #region What and where */}
			<div class="wsp-engagement__main">
				<div class="wsp-engagement__titles">
					<a class="wsp-engagement__project" id={titleId} href={row.projectHref}>
						{row.projectTitle}
					</a>
					<a class="wsp-engagement__stage" href={row.stageHref}>{row.stageTitle}</a>
					<MetaLine
						as="p"
						size="xs"
						class="wsp-engagement__meta"
						items={row.meta.map((text) => ({ text, tabular: true }))}
					/>
				</div>
				<Tag
					class="wsp-engagement__status"
					value={row.status.label}
					severity={row.status.severity}
					variant="subtle"
					rounded
				/>
			</div>
			{/* #endregion */}

			{/* #region Who, and how loaded */}
			<div class="wsp-engagement__people">
				{row.faces.length > 0 && (
					<AvatarStack
						class="wsp-engagement__faces"
						people={row.faces}
						max={4}
						size="sm"
						aria-label={`Working this stage: ${row.faces.map((f) => f.name).join(", ")}`}
					/>
				)}
				{row.idle
					? <p class="wsp-engagement__idle">{row.idle}</p>
					: (
						<ul class="wsp-engagement__load" aria-label={`Workload on ${row.stageTitle}`}>
							{row.assignees.map((assignee) => (
								<AssigneeLine key={assignee.handle} assignee={assignee} />
							))}
						</ul>
					)}
			</div>
			{/* #endregion */}
		</li>
	);
}

// #region One assignee
/**
 * One person's line: the name, the readout and — when the stage sets a cap — the bar. The readout is
 * hidden from assistive tech, which hears the bar's name (or, with no bar, the same sentence as hidden
 * text), so the figure is announced once, in words.
 */
function AssigneeLine({ assignee }: { assignee: AssigneeReadout }): JSX.Element {
	return (
		<li class="wsp-engagement__assignee">
			<span class="wsp-engagement__who">{assignee.name}</span>
			<span class="wsp-engagement__wi" aria-hidden="true">{assignee.readout}</span>
			{assignee.percent !== null
				? (
					<ProgressBar
						class="wsp-engagement__bar"
						value={assignee.percent}
						aria-label={assignee.barLabel}
					/>
				)
				: <span class="ui-visually-hidden">{assignee.barLabel}</span>}
			{assignee.softCap && (
				<MetaLine
					as="p"
					size="xs"
					class="wsp-engagement__warn"
					items={[{ text: assignee.softCap, tabular: true }]}
				/>
			)}
		</li>
	);
}
// #endregion
