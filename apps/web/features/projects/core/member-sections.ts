import type { MemberRosterPage } from "../types/projects-types.ts";

/**
 * member-sections — the pure, DOM-free rules behind the Members tab's three sections and its
 * project-type adaptations. Side-effect-free so the route (first paint), the island and the tests all
 * derive one answer.
 *
 * **Sections are addressed.** `?view=requests` / `?view=invitations` select a section (Members is the
 * bare URL), resolved server-side against what the viewer may see — a link to a management section
 * opened by someone who cannot manage lands on Members rather than on an empty queue, and the section
 * survives a reload and opens in a second tab (`ROUTING.md`: a mode held only in a signal has no
 * address and cannot be guarded).
 */

// #region Sections
/** The roster's sections: the people on it, the applications to it, the invitations it sent. */
export type MemberSection = "members" | "requests" | "invitations";

/** The query parameter that addresses a section. */
export const MEMBER_SECTION_PARAM = "view";

/**
 * The sections this roster offers its viewer. Requests and Invitations are management queues, so they
 * exist only for a viewer who can invite, and never on a conversation (which has no stages to apply to
 * and sends no invitations).
 */
export function memberSectionsFor(page: MemberRosterPage | null): MemberSection[] {
	if (!page || page.scope === "conversation" || !page.viewerCaps.canInvite) return ["members"];
	return ["members", "requests", "invitations"];
}

/** The section a raw `?view=` value selects, falling back to Members for anything not offered. */
export function resolveMemberSection(
	raw: string | null | undefined,
	available: readonly MemberSection[],
): MemberSection {
	return available.includes(raw as MemberSection) ? (raw as MemberSection) : "members";
}

/** The current URL re-addressed to a section, every other parameter kept. Members is the bare URL. */
export function memberSectionHref(href: string, section: MemberSection): string {
	const url = new URL(href);
	if (section === "members") url.searchParams.delete(MEMBER_SECTION_PARAM);
	else url.searchParams.set(MEMBER_SECTION_PARAM, section);
	return `${url.pathname}${url.search}${url.hash}`;
}
// #endregion

// #region Project-type context
/** How the roster adapts to the engagement it describes. */
export interface MemberContext {
	/**
	 * Whether stages are a dimension worth showing — a pipeline's stage chips, the stage filter, the
	 * stage picker in Edit. A one-off has one deliverable and a session has sittings rather than stages,
	 * so both hide them.
	 */
	showStages: boolean;
	/** A STAGE channel's roster, where each person is an assigned contributor or an observer. */
	stageChannel: boolean;
	/** `solo` / `group` on a session engagement — the attendance + capacity adaptation; else `null`. */
	session: "solo" | "group" | null;
}

/**
 * Resolve the roster's {@link MemberContext}. The DEV Context Switcher's simulated service type may
 * re-shape a session (1-1 ⇄ group) on top of the server's `session.mode`; in production it is `null`.
 */
export function memberContextFor(
	page: MemberRosterPage,
	simulatedService: string | null = null,
): MemberContext {
	const stageChannel = page.scope === "channel" && page.channelKind === "stage";
	if (page.scope === "conversation") {
		return { showStages: false, stageChannel: false, session: null };
	}
	if (page.format === "session") {
		const simulated = simulatedService === "group_session"
			? "group"
			: simulatedService === "normal_session"
			? "solo"
			: null;
		return {
			showStages: false,
			stageChannel,
			session: simulated ?? page.session?.mode ?? "solo",
		};
	}
	return {
		showStages: page.format === "pipeline" && page.stages.length > 0,
		stageChannel,
		session: null,
	};
}

/**
 * The seat line a session roster states in its header ("8 of 12 seats" · "8 attending"), or `null`
 * when there is no seat picture to state. Words, not a count badge (DESIGN_SYSTEM §B.11).
 */
export function sessionSeatLine(
	page: MemberRosterPage,
	mode: "solo" | "group" | null,
): string | null {
	const session = page.session;
	if (!mode || !session) return null;
	if (mode === "solo") return session.seatsTaken > 0 ? "1-1 session" : "1-1 session · seat open";
	if (session.seatCap === null) return `${session.seatsTaken} attending`;
	const open = Math.max(0, session.seatCap - session.seatsTaken);
	return `${session.seatsTaken} of ${session.seatCap} seats · ${open} open`;
}
// #endregion
