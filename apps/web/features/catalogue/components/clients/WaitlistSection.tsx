import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Tag } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { relativeAge } from "@web/features/explore/core/card-signals.ts";
import { subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { ListingWaitlist } from "@projective/types/projects";
import { pipelineRevision, readWaitlist } from "../../core/client-store.ts";
import {
	liveCount,
	WAITLIST_STATUS_TAG,
	type WaitlistClock,
	waitlistMeta,
	waitlistSummary,
} from "../../core/waitlist-model.ts";

/** Props for {@link WaitlistSection}. */
export interface WaitlistSectionProps {
	/** The group-session listing's slug. */
	listing: string;
	/** The instant relative times are measured from. */
	now: number;
}

const HEADING_ID = "cat-wl-head";

const HELD_UNTIL = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "numeric",
	minute: "2-digit",
});

/**
 * WaitlistSection — a group-session listing's waitlist in the workspace's Clients tab (Decision #455):
 * the live queue's count in the heading, a one-line summary of every state, and the places — whoever
 * holds an invited seat and until when, then the queue in order, then those who bought or let their
 * invite lapse. Read-only: the queue is served by the platform, first in, first out.
 */
export function WaitlistSection(props: WaitlistSectionProps): JSX.Element {
	const waitlist = useSignal<ListingWaitlist | null>(null);
	const error = useSignal<string | null>(null);
	const attempt = useSignal(0);
	const listing = useSignal(props.listing);
	if (listing.peek() !== props.listing) listing.value = props.listing;

	useEffect(() => subscribeDevSeam(() => attempt.value++), []);

	useSignalEffect(() => {
		const slug = listing.value;
		void attempt.value;
		void pipelineRevision.value;
		let live = true;
		void readWaitlist(slug).then((res) => {
			if (!live) return;
			if (res.ok && res.data) {
				waitlist.value = res.data;
				error.value = null;
			} else {
				error.value = res.message ?? "We couldn't load the waitlist just now.";
			}
		});
		return () => {
			live = false;
		};
	});

	const clock: WaitlistClock = {
		ago: (iso) => {
			const age = relativeAge(iso, props.now);
			return age ? `${age} ago` : "just now";
		},
		at: (iso) => HELD_UNTIL.format(new Date(iso)),
	};
	const data = waitlist.value;
	const summary = data ? waitlistSummary(data.counts) : "";

	return (
		<section class="cat-wl" aria-labelledby={HEADING_ID} aria-busy={!data && !error.value}>
			<h2 class="cat-cl__lane-head" id={HEADING_ID}>
				<span class="cat-cl__lane-title">Waitlist</span>
				{data && <span class="cat-cl__count">{liveCount(data.counts)}</span>}
			</h2>
			{error.value && (
				<div class="cat-wl__state" role="alert">
					<p class="cat-wl__note">{error.value}</p>
					<Button
						label="Try again"
						size="sm"
						severity="neutral"
						variant="outlined"
						onClick={() => attempt.value++}
					/>
				</div>
			)}
			{!data && !error.value && <p class="cat-wl__note" role="status">Loading the waitlist…</p>}
			{data && (
				<p class="cat-wl__note">
					{summary ||
						"Nobody is waiting. When this cohort is full or none is enrolling, buyers can join the waitlist from the listing."}
				</p>
			)}
			{data && data.entries.length > 0 && (
				<ul class="cat-cl__list">
					{data.entries.map((e) => {
						const tag = WAITLIST_STATUS_TAG[e.status];
						return (
							<li key={e.userId} class="cat-cl__item">
								<div class="cat-wl__row">
									<UserAvatar
										class="cat-cl__avatar"
										image={e.avatar || null}
										label={e.name}
										size="sm"
									/>
									<span class="cat-cl__body">
										<span class="cat-cl__name">{e.name}</span>
										<span class="cat-cl__meta">
											{waitlistMeta(e, clock).map((part, i) => (
												<span key={i} class="cat-cl__meta-part cat-cl__time">{part}</span>
											))}
										</span>
									</span>
									{tag && (
										<Tag
											class="cat-cl__reason"
											value={tag}
											severity={e.status === "invited"
												? "info"
												: e.status === "converted"
												? "success"
												: "secondary"}
											variant="subtle"
										/>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
