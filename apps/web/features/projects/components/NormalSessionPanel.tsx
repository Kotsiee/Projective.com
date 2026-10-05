import type { JSX } from "preact";
import { CalendarPlusIcon, FolderIcon, UploadIcon, VideoIcon } from "./session-glyphs.tsx";
import { bookingBadge, type NormalSessionData } from "../core/session-model.ts";

/**
 * NormalSessionPanel — the Project Details sidebar body for a **Normal (1-1) Session** service
 * (task §3.A). A 1-1 session has no stage tree, tickets, or nested PMs, so the sidebar's empty
 * real-estate is reclaimed with the engagement's live cadence instead:
 *
 *   - an **upcoming-session** card — the next slot's time, duration, a booking-proposal badge
 *     (`Confirmed` / `Pending Proposal` / `Rescheduled`), and a quick **Propose Time** CTA;
 *   - a **session counter** (`Session 3 of 10` or `Pay-per-session`);
 *   - quick links to the **Shared files & resources** area (`/projects/{slug}/files`) where the
 *     freelancer shares sheets/docs and the client uploads recorded assignments.
 *
 * Its one conversation is not listed here: it is the engagement's Discussion, the first link of the
 * lane's top tier (`/projects/{slug}/discussion`).
 *
 * Presentation-only + THIN: every value is the SSR-derived {@link NormalSessionData}; the Propose-Time
 * and day-jump actions route to the existing project calendar (real booking persistence is deferred to
 * the live backend).
 */

export interface NormalSessionPanelProps {
	/** The SSR/seam-derived 1-1 session projection (upcoming slot · counter · counterpart). */
	data: NormalSessionData;
	/** Where the Propose-Time CTA navigates (the project calendar). */
	calendarHref: string;
	/** The Shared files & resources destination. */
	filesHref: string;
}

export function NormalSessionPanel(props: NormalSessionPanelProps): JSX.Element {
	const { data, calendarHref, filesHref } = props;
	const badge = bookingBadge(data.upcoming.bookingStatus);

	return (
		<div class="proj-sess proj-sess--normal">
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
		</div>
	);
}
