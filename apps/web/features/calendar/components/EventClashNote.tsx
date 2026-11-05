import type { JSX } from "preact";
import { calendarTime } from "@projective/ui/calendar";
import { Tooltip } from "@projective/ui/feedback";
import type { EventClash } from "@projective/types/scheduling";
import { uuid } from "@projective/types/scheduling";
import { useClashCheck } from "../hooks/useClashCheck.ts";

/** The personal agenda prints a 12-hour clock, as its grid and its modal do. */
const HOUR12 = true;

/** The stretch of `span` this clash actually takes, which is what the reader has to give up. */
function overlapLabel(clash: EventClash, span: Span, tz: string): string {
	const start = Math.max(clash.start, span.start);
	const end = Math.min(clash.end, span.end);
	return calendarTime.fmtRange(start, end, tz, HOUR12);
}

type Span = { start: number; end: number };

/** Props for {@link EventClashNote}. */
export interface EventClashNoteProps {
	clashes: readonly EventClash[];
	/** The entry the clashes are with, for the time they share. */
	span: Span;
	tz: string;
	/** Print the shared time beside the title, where the row has room for it. */
	withSpan?: boolean;
	/** Take keyboard focus for the tooltip. Off inside a row's own button, which reads the note out. */
	focusable?: boolean;
}

/**
 * EventClashNote — "Clashes with: [Title]", an unboxed warning in the Meta register (§B.11): a pip and
 * the words, so it is never colour alone. The first clash is named; the tooltip names them all, each
 * with the time it shares with this entry. Draws nothing when there is no clash.
 */
export function EventClashNote(props: EventClashNoteProps): JSX.Element | null {
	const { clashes, span, tz } = props;
	const first = clashes[0];
	if (!first) return null;
	const more = clashes.length - 1;
	return (
		<Tooltip
			content={
				<ul class="cal-clash__list">
					{clashes.map((c) => (
						<li key={`${c.kind}-${c.id}`}>{c.title} · {overlapLabel(c, span, tz)}</li>
					))}
				</ul>
			}
		>
			<span class="cal-clash" tabIndex={props.focusable ? 0 : undefined}>
				<span class="cal-clash__pip" aria-hidden="true" />
				<span class="cal-clash__text">
					Clashes with: {first.title}
					{more > 0 ? ` +${more} more` : ""}
					{props.withSpan ? ` · ${overlapLabel(first, span, tz)}` : ""}
				</span>
			</span>
		</Tooltip>
	);
}

/**
 * The event modal's live check: what the times now in its fields would collide with, asked of the
 * server because the fields can reach a date the page never loaded.
 */
export function EventClashWarning(
	{ start, end, id, tz }: Span & { id: string; tz: string },
): JSX.Element | null {
	const clashes = useClashCheck({
		start,
		end,
		// A draft's id is client-minted, and only a stored entry can clash with itself.
		excludeEventId: uuid.safeParse(id).success ? id : undefined,
	});
	return (
		<p class="cal-clash__line" role="status">
			<EventClashNote clashes={clashes.value} span={{ start, end }} tz={tz} withSpan focusable />
		</p>
	);
}
