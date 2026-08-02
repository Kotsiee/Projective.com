import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Icon, type IconName } from "@projective/ui/icons";
import type { TicketHistoryEntry, TicketHistoryKind } from "../../types/projects-types.ts";

/**
 * TicketHistoryRow — one event in the ticket's audit log, wherever it is read.
 *
 * The History tab and the Details panel's recent-activity feed are the same log at two lengths, so
 * they are the same row: a second renderer is how the archive and the summary come to disagree about
 * what happened.
 *
 * Every entry leads with the FACE of whoever acted. A log is a record of people doing things, and a
 * reader scanning for "who changed the price" finds a face far faster than a name inside a sentence.
 * A system transition — an escrow release, an automatic status change — has no face by definition and
 * gets the platform's own mark, so the absence reads as "nobody did this" rather than as missing data.
 *
 * An entry that POINTS somewhere is a button rather than a line of prose: a submission event is the
 * shortest route to the submission it announces, and making the reader read the event, remember the
 * name and go hunting for it in another tab is a navigation the log can simply perform. Entries with
 * nowhere to go stay inert rather than becoming buttons that do nothing when pressed.
 */
export interface TicketHistoryRowProps {
	entry: TicketHistoryEntry;
	/** Follow the entry to what it refers to; omitted where following is not offered. */
	onFollow?: (entry: TicketHistoryEntry) => void;
	/** Drop the supporting detail line — the dense recent-activity panel shows headlines only. */
	compact?: boolean;
}

/** The kind's glyph, shown as a small badge on the actor's avatar so both channels survive. */
export const HISTORY_ICON: Record<TicketHistoryKind, IconName> = {
	created: "plus",
	status: "switch",
	stage: "stages",
	assigned: "user",
	edited: "edit",
	attachment: "attachment",
	submission: "submission",
	intensity: "analytics",
	priority: "flag",
	due: "calendar",
};

export function TicketHistoryRow(props: TicketHistoryRowProps): JSX.Element {
	const { entry, compact } = props;
	const actorName = entry.actor ? entry.actor.name : "Projective";
	const followable = entry.targetPath.length > 0 && !!props.onFollow;

	const body = (
		<>
			<span class="tkv-log__who">
				{entry.actor
					? (
						<Avatar
							image={entry.actor.avatar ?? undefined}
							label={entry.actor.name}
							size={compact ? 22 : 26}
							alt=""
						/>
					)
					: (
						<span class="tkv-log__system" aria-hidden="true">
							<Icon name="settings" size="2xs" />
						</span>
					)}
				<span class="tkv-log__mark" aria-hidden="true">
					<Icon name={HISTORY_ICON[entry.kind]} size="2xs" />
				</span>
			</span>
			<span class="tkv-log__body">
				<span class="tkv-log__summary">
					<strong class="tkv-log__actor">{actorName}</strong> {entry.summary}
				</span>
				{entry.detail && !compact ? <span class="tkv-log__detail">{entry.detail}</span> : null}
			</span>
			<time class="tkv-log__at" dateTime={entry.at}>{entry.dateLabel}</time>
			{followable ? <Icon name="chevron-right" size="2xs" class="tkv-log__go" /> : null}
		</>
	);

	return (
		<li class="tkv-log__row" data-unread={entry.unread ? "true" : undefined}>
			{followable
				? (
					<button
						type="button"
						class="tkv-log__entry tkv-log__entry--go"
						aria-label={`${actorName} ${entry.summary}. Open it.`}
						onClick={() => props.onFollow?.(entry)}
					>
						{body}
					</button>
				)
				: <div class="tkv-log__entry">{body}</div>}
		</li>
	);
}
