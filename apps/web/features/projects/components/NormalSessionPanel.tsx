import type { JSX } from "preact";
import { ChannelRow } from "./ChannelTree.tsx";
import { SessionMiniCalendar } from "./SessionMiniCalendar.tsx";
import { CalendarPlusIcon, FolderIcon, UploadIcon, VideoIcon } from "./session-glyphs.tsx";
import { bookingBadge, type NormalSessionData } from "../core/session-model.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * NormalSessionPanel — the Project Details sidebar body for a **Normal (1-1) Session** service
 * (task §3.A). A 1-1 session has no stage tree, tickets, or nested PMs, so the sidebar's empty
 * real-estate is reclaimed with the engagement's live cadence instead:
 *
 *   - a compact interactive **mini-calendar** ({@link SessionMiniCalendar}) that highlights the next
 *     booked session and jumps to the full project calendar on a day click;
 *   - an **upcoming-session** card — the next slot's time, duration, a booking-proposal badge
 *     (`Confirmed` / `Pending Proposal` / `Rescheduled`), and a quick **Propose Time** CTA;
 *   - a **session counter** (`Session 3 of 10` or `Pay-per-session`);
 *   - quick links to the **Shared files & resources** area (`/projects/{slug}/files`) where the
 *     freelancer shares sheets/docs and the client uploads recorded assignments;
 *   - the minimal **General** channel list (a 1-1 session's only channels).
 *
 * Presentation-only + THIN: every value is the SSR-derived {@link NormalSessionData}; the Propose-Time
 * and day-jump actions route to the existing project calendar (real booking persistence is deferred to
 * the live backend).
 */

export interface NormalSessionPanelProps {
	detail: ProjectDetail;
	/** The SSR/seam-derived 1-1 session projection (upcoming slot · counter · counterpart). */
	data: NormalSessionData;
	/** Current instant — the mini-calendar's default month + today marker. */
	nowMs: number;
	/** The next session's day (a UTC day-key) — highlighted in the mini-calendar. */
	sessionDayMs: number;
	/** Whether the island has mounted (gates the mini-calendar's today marker). */
	mounted: boolean;
	/** Where the Propose-Time CTA + a mini-calendar day pick navigate (the project calendar). */
	calendarHref: string;
	/** The Shared files & resources destination. */
	filesHref: string;
	/** Jump to the project calendar for a picked day. */
	onPickDay: (dayMs: number) => void;
}

export function NormalSessionPanel(props: NormalSessionPanelProps): JSX.Element {
	const { detail, data, calendarHref, filesHref } = props;
	const badge = bookingBadge(data.upcoming.bookingStatus);
	const general = detail.channels.general;

	return (
		<div class="proj-sess proj-sess--normal">
			<SessionMiniCalendar
				nowMs={props.nowMs}
				sessionDayMs={props.sessionDayMs}
				mounted={props.mounted}
				onPickDay={props.onPickDay}
			/>

			{/* Upcoming session — next slot + booking proposal state */}
			<section class="sess-next" aria-label="Upcoming session">
				<div class="sess-next__head">
					<span class="sess-next__icon" aria-hidden="true">{VideoIcon}</span>
					<span class="sess-next__eyebrow">Next session</span>
					<span class="sess-badge" data-tone={badge.tone}>{badge.label}</span>
				</div>
				<div class="sess-next__when">
					<span class="sess-next__time">{data.upcoming.label}</span>
					<span class="sess-next__rel">
						{data.upcoming.relativeLabel} · {data.upcoming.durationLabel}
					</span>
				</div>
				<p class="sess-next__note">{badge.note}</p>
				<a class="sess-next__cta" href={calendarHref}>
					<span class="sess-next__cta-icon" aria-hidden="true">{CalendarPlusIcon}</span>
					<span>Propose time</span>
				</a>
			</section>

			{/* Session counter — a package position or a pay-per-session arrangement */}
			<div class="sess-counter" role="status">
				<span class="sess-counter__label">Package</span>
				<span
					class="sess-counter__value"
					data-open={data.counter.payPerSession ? "true" : undefined}
				>
					{data.counter.label}
				</span>
			</div>

			{/* Shared resources / files */}
			<section class="sess-links" aria-label="Shared resources">
				<span class="sess-links__label">Shared resources</span>
				<a class="sess-link" href={filesHref}>
					<span class="sess-link__icon" aria-hidden="true">{FolderIcon}</span>
					<span class="sess-link__body">
						<span class="sess-link__name">Files &amp; documents</span>
						<span class="sess-link__sub">Sheets, briefs &amp; recorded assignments</span>
					</span>
				</a>
				<a class="sess-link" href={filesHref}>
					<span class="sess-link__icon" aria-hidden="true">{UploadIcon}</span>
					<span class="sess-link__body">
						<span class="sess-link__name">Upload an asset</span>
						<span class="sess-link__sub">Share a recording or reference</span>
					</span>
				</a>
			</section>

			{/* General channels — a 1-1 session's only channels */}
			{general.length > 0 && (
				<section class="sess-channels" aria-label="Channels">
					<span class="sess-channels__label">Channels</span>
					<div class="sess-channels__list">
						{general.map((c) => <ChannelRow key={c.id} channel={c} slug={detail.slug} />)}
					</div>
				</section>
			)}
		</div>
	);
}
