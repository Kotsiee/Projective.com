import type {
	ListingWaitlist,
	ListingWaitlistEntry,
	WaitlistStatus,
} from "@projective/types/projects";

/**
 * waitlist-model — the pure rules behind the workspace's waitlist section (Decision #455): where it
 * reads from, which places count as the live queue, the one-line summary and each place's meta.
 * Clocks and formatters come in as arguments, so the rules are testable without a DOM.
 */

// #region Reads
/** `/api/catalogue/waitlist?listing=`, plus the `clientPipeline` dev axis when one is set. */
export function waitlistPath(listing: string, sim: string | null = null): string {
	const q = new URLSearchParams({ listing });
	if (sim) q.set("sim", sim);
	return `/api/catalogue/waitlist?${q.toString()}`;
}
// #endregion

// #region Copy
/** The lifecycle label a place's status container carries; `null` where the meta already says it. */
export const WAITLIST_STATUS_TAG: Readonly<Record<WaitlistStatus, string | null>> = {
	waiting: null,
	invited: "Seat held",
	converted: "Bought a seat",
	expired: "Invite lapsed",
};

/** The places still in play: people waiting, and people holding an invited seat. */
export function liveCount(counts: ListingWaitlist["counts"]): number {
	return counts.waiting + counts.invited;
}

/** "3 waiting · 1 seat held · 1 bought a seat" — the states with anyone in them; `""` when empty. */
export function waitlistSummary(counts: ListingWaitlist["counts"]): string {
	const parts: string[] = [];
	if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
	if (counts.invited > 0) {
		parts.push(`${counts.invited} ${counts.invited === 1 ? "seat" : "seats"} held`);
	}
	if (counts.converted > 0) parts.push(`${counts.converted} bought a seat`);
	if (counts.expired > 0) {
		parts.push(`${counts.expired} ${counts.expired === 1 ? "invite" : "invites"} lapsed`);
	}
	return parts.join(" · ");
}

/** How a place's meta line names an instant: relative (`ago`) or absolute (`at`). */
export interface WaitlistClock {
	ago: (iso: string) => string;
	at: (iso: string) => string;
}

/** The meta parts of one place, rendered as middot-separated text. */
export function waitlistMeta(entry: ListingWaitlistEntry, clock: WaitlistClock): string[] {
	switch (entry.status) {
		case "waiting":
			return [
				entry.position ? `Number ${entry.position} in the queue` : "In the queue",
				`joined ${clock.ago(entry.queuedAt)}`,
			];
		case "invited":
			return entry.inviteExpiresAt
				? [`Held until ${clock.at(entry.inviteExpiresAt)}`, `joined ${clock.ago(entry.queuedAt)}`]
				: [`joined ${clock.ago(entry.queuedAt)}`];
		case "converted":
		case "expired":
			return entry.resolvedAt
				? [
					`joined ${clock.ago(entry.queuedAt)}`,
					`${entry.status === "converted" ? "bought" : "lapsed"} ${clock.ago(entry.resolvedAt)}`,
				]
				: [`joined ${clock.ago(entry.queuedAt)}`];
	}
}
// #endregion
