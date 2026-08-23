import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Icon, type IconName } from "@projective/ui/icons";
import type { EventHistoryEntry, EventHistoryKind } from "@projective/types/scheduling";

/**
 * EventHistoryRow — one entry in an event's audit log, wherever it is read.
 *
 * The History tab and the attendee panel's recent-activity glance are the same log at two lengths, so
 * they are the same row: a second renderer is how the archive and the summary come to disagree about
 * what happened.
 *
 * Every entry leads with the FACE of whoever acted, because a log is a record of people doing things
 * and a reader scanning for "who moved the time" finds a face far faster than a name inside a
 * sentence. A SYSTEM transition — a vote resolving on its own deadline — has no face by definition
 * and gets the platform's mark, so the absence reads as "nobody did this" rather than as missing data.
 *
 * An entry that POINTS somewhere is a button; one with nowhere to go stays inert rather than becoming
 * a button that does nothing when pressed.
 */
export interface EventHistoryRowProps {
	entry: EventHistoryEntry;
	/** Follow the entry to what it refers to; omitted where following is not offered. */
	onFollow?: (entry: EventHistoryEntry) => void;
	/** Drop the supporting detail line — the dense glance shows headlines only. */
	compact?: boolean;
}

/** The kind's glyph, shown as a small badge on the actor's avatar so both channels survive. */
export const EVENT_HISTORY_ICON: Record<EventHistoryKind, IconName> = {
	created: "plus",
	edited: "edit",
	rescheduled: "switch",
	proposal: "clock",
	vote: "check",
	rsvp: "user",
	attachment: "attachment",
	meeting_link: "video-camera",
	cancelled: "close",
};

export function EventHistoryRow(props: EventHistoryRowProps): JSX.Element {
	const { entry, compact } = props;
	const actorName = entry.actor ? entry.actor.name : "Projective";
	const followable = !!entry.targetId && !!props.onFollow;

	const body = (
		<>
			<span class="evm-log__who">
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
						<span class="evm-log__system" aria-hidden="true">
							<Icon name="settings" size="2xs" />
						</span>
					)}
				<span class="evm-log__mark" aria-hidden="true">
					<Icon name={EVENT_HISTORY_ICON[entry.kind]} size="2xs" />
				</span>
			</span>
			<span class="evm-log__body">
				<span class="evm-log__summary">
					<strong class="evm-log__actor">{actorName}</strong> {entry.summary}
				</span>
				{entry.detail && !compact ? <span class="evm-log__detail">{entry.detail}</span> : null}
			</span>
			<time class="evm-log__at" dateTime={entry.at}>{entry.dateLabel}</time>
			{followable ? <Icon name="chevron-right" size="2xs" class="evm-log__go" /> : null}
		</>
	);

	return (
		<li class="evm-log__row" data-unread={entry.unread ? "true" : undefined}>
			{followable
				? (
					<button
						type="button"
						class="evm-log__entry evm-log__entry--go"
						aria-label={`${actorName} ${entry.summary}. Open it.`}
						onClick={() => props.onFollow?.(entry)}
					>
						{body}
					</button>
				)
				: <div class="evm-log__entry">{body}</div>}
		</li>
	);
}
