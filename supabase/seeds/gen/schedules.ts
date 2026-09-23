/**
 * schedules.ts — the development world's AVAILABILITY: who publishes a schedule, when they work,
 * when they take calls, what a call costs, where it happens, and what already occupies their week.
 *
 * Every seller whose listings or profile offer a booking publishes a schedule here, because the
 * booking surfaces read it live — the listing's Book modal draws its slot grid from these bands, the
 * profile's consultation row from these call settings — and a seller with no row simply offers
 * nothing. That is also the shape of the world on purpose: not every freelancer has published their
 * hours (Lena, Inês, Kwame and Saoirse take their calls through their teams), and one new account
 * (Chloe) has a DRAFT schedule a visitor cannot see.
 *
 * Times are wall-clock times in the owner's own zone, placed relative to the CURRENT week by
 * `localAt` so a reset on any day yields bookings that are still in the future and still inside the
 * windows they belong to.
 *
 * Keep it compatible with the owner's Availability editor (`scheduling.save_owner_availability`),
 * which round-trips these rows: no overlapping bands of one kind on one weekday, `end > start`, a
 * paid call always carries a fee and a currency.
 */

// #region Types
/** 0 = Sunday … 6 = Saturday — the `weekday` column's own numbering (JS `Date#getDay`). */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** `[weekday, "HH:MM" start, "HH:MM" end]` in the owner's zone. */
export type Band = [Weekday, string, string];

/** A point in the owner's week: weeks from this week's Monday, days after Monday (0 = Mon), a time. */
export interface WeekSlot {
	week: number;
	/** 0 = Monday … 6 = Sunday (offset from the week's Monday — NOT the `weekday` column numbering). */
	day: number;
	time: string;
}

export interface CallSpec {
	courtesy?: { minutes: number; maxPerWeek: number; cooldownDays: number };
	paid?: { minutes: number; feeMinor: number; currency: string };
	bufferBefore: number;
	bufferAfter: number;
	noticeMinutes: number;
	advanceDays: number;
	autoConfirm: boolean;
	agendaRequired: boolean;
	/** Conferencing providers, in the owner's order (`integrations.providers.slug`). */
	platforms: string[];
}

export interface ScheduleSpec {
	/** A persona key (an individual's schedule) or a team entity key. */
	owner: string;
	published: boolean;
	working: Band[];
	calls: Band[];
	/** Discovery-call settings; absent = this owner takes no calls. */
	call?: CallSpec;
	blackouts?: Array<{ from: WeekSlot; to: WeekSlot; label: string; public: boolean }>;
	/** Commitments already on the calendar — they take time out of the grid. */
	events?: Array<{
		at: WeekSlot;
		minutes: number;
		kind: "busy" | "sync" | "session" | "booking" | "general";
		title: string;
	}>;
}

export interface DiscoveryCallSpec {
	key: string;
	/** The schedule owner (persona or team key). */
	host: string;
	/** The persona asking. */
	requester: string;
	type: "courtesy" | "paid";
	status: "proposed" | "confirmed" | "completed";
	at: WeekSlot;
	agenda: string;
	platform: string | null;
	/** The corpus listing the call is about, when it was booked from one. */
	listing?: string;
	/** Days before the call that it was requested. */
	requestedDaysBefore: number;
}
// #endregion

// #region Schedules
const MON_FRI = [1, 2, 3, 4, 5] as const;

/** The same hours on every day in `days`. */
function everyDay(days: readonly Weekday[], start: string, end: string): Band[] {
	return days.map((d) => [d, start, end] as Band);
}

export const SCHEDULES: ScheduleSpec[] = [
	{
		owner: "maris",
		published: true,
		working: [...everyDay([1, 2, 3, 4], "09:00", "17:30"), [5, "09:00", "13:00"]],
		calls: [[2, "14:00", "16:00"], [4, "10:00", "12:00"]],
		call: {
			courtesy: { minutes: 20, maxPerWeek: 4, cooldownDays: 30 },
			paid: { minutes: 45, feeMinor: 7500, currency: "GBP" },
			bufferBefore: 0,
			bufferAfter: 10,
			noticeMinutes: 720,
			advanceDays: 45,
			autoConfirm: false,
			agendaRequired: false,
			platforms: ["google", "zoom"],
		},
		blackouts: [{
			from: { week: 2, day: 0, time: "00:00" },
			to: { week: 2, day: 3, time: "00:00" },
			label: "Speaking at Config",
			public: true,
		}],
		events: [
			{ at: { week: 1, day: 1, time: "14:30" }, minutes: 60, kind: "busy", title: "Client workshop" },
			{ at: { week: 1, day: 3, time: "10:00" }, minutes: 60, kind: "sync", title: "Design review" },
			{ at: { week: 2, day: 3, time: "15:00" }, minutes: 90, kind: "busy", title: "Focus block" },
		],
	},
	{
		owner: "ren",
		published: true,
		working: everyDay([2, 3, 4, 5, 6], "10:00", "18:00"),
		calls: [[3, "16:00", "18:00"], [6, "11:00", "12:30"]],
		call: {
			courtesy: { minutes: 15, maxPerWeek: 3, cooldownDays: 60 },
			bufferBefore: 5,
			bufferAfter: 10,
			noticeMinutes: 1440,
			advanceDays: 30,
			autoConfirm: false,
			agendaRequired: true,
			platforms: ["zoom"],
		},
		events: [
			{ at: { week: 1, day: 2, time: "16:00" }, minutes: 60, kind: "busy", title: "Render review" },
		],
	},
	{
		owner: "juno",
		published: true,
		working: everyDay(MON_FRI, "08:30", "16:30"),
		calls: [[1, "09:00", "10:30"], [3, "09:00", "10:30"], [5, "09:00", "10:30"]],
		call: {
			paid: { minutes: 30, feeMinor: 6000, currency: "EUR" },
			bufferBefore: 0,
			bufferAfter: 15,
			noticeMinutes: 720,
			advanceDays: 60,
			autoConfirm: true,
			agendaRequired: true,
			platforms: ["google"],
		},
		blackouts: [{
			from: { week: 1, day: 3, time: "00:00" },
			to: { week: 1, day: 5, time: "00:00" },
			label: "Travelling",
			public: false,
		}],
	},
	{
		owner: "samuel",
		published: true,
		working: everyDay(MON_FRI, "09:00", "17:00"),
		calls: [[2, "15:00", "17:00"], [4, "15:00", "17:00"]],
		call: {
			courtesy: { minutes: 20, maxPerWeek: 5, cooldownDays: 14 },
			bufferBefore: 0,
			bufferAfter: 10,
			noticeMinutes: 480,
			advanceDays: 60,
			autoConfirm: false,
			agendaRequired: false,
			platforms: ["google", "microsoft_teams"],
		},
	},
	{
		owner: "tomasz",
		published: true,
		working: everyDay(MON_FRI, "08:00", "16:00"),
		calls: [[1, "13:00", "15:00"]],
		call: {
			courtesy: { minutes: 15, maxPerWeek: 2, cooldownDays: 30 },
			paid: { minutes: 60, feeMinor: 20000, currency: "PLN" },
			bufferBefore: 10,
			bufferAfter: 10,
			noticeMinutes: 1440,
			advanceDays: 60,
			autoConfirm: false,
			agendaRequired: true,
			platforms: ["microsoft_teams"],
		},
	},
	{
		// Publishes working hours but takes no calls: the consultation row is absent, never disabled.
		owner: "aiko",
		published: true,
		working: everyDay(MON_FRI, "10:00", "19:00"),
		calls: [],
	},
	{
		// A new account still drafting availability. Nothing here is visible to anybody but Chloe.
		owner: "chloe",
		published: false,
		working: everyDay(MON_FRI, "10:00", "16:00"),
		calls: [],
	},
	{
		owner: "nova",
		published: true,
		working: everyDay(MON_FRI, "09:30", "18:00"),
		calls: [[2, "11:00", "13:00"], [4, "11:00", "13:00"]],
		call: {
			courtesy: { minutes: 30, maxPerWeek: 5, cooldownDays: 30 },
			paid: { minutes: 60, feeMinor: 12000, currency: "EUR" },
			bufferBefore: 0,
			bufferAfter: 15,
			noticeMinutes: 1440,
			advanceDays: 45,
			autoConfirm: false,
			agendaRequired: false,
			platforms: ["microsoft_teams", "zoom", "google"],
		},
		events: [
			{ at: { week: 1, day: 3, time: "11:00" }, minutes: 60, kind: "busy", title: "Brand workshop" },
			{ at: { week: 2, day: 1, time: "12:00" }, minutes: 60, kind: "sync", title: "Studio crit" },
		],
	},
	{
		owner: "north",
		published: true,
		working: everyDay(MON_FRI, "09:00", "17:00"),
		calls: [[3, "10:00", "12:00"]],
		call: {
			courtesy: { minutes: 20, maxPerWeek: 3, cooldownDays: 30 },
			bufferBefore: 0,
			bufferAfter: 10,
			noticeMinutes: 720,
			advanceDays: 60,
			autoConfirm: false,
			agendaRequired: true,
			platforms: ["google"],
		},
		blackouts: [{
			from: { week: 3, day: 0, time: "00:00" },
			to: { week: 3, day: 5, time: "00:00" },
			label: "Team offsite",
			public: true,
		}],
	},
	{
		// The mentoring practice: the portfolio review (60 min) and the mentorship block (6 × 45 min) are
		// booked into these working hours.
		owner: "fern",
		published: true,
		working: everyDay(MON_FRI, "09:00", "17:00"),
		calls: [[1, "12:00", "13:00"], [3, "12:00", "13:00"]],
		call: {
			paid: { minutes: 30, feeMinor: 4000, currency: "GBP" },
			bufferBefore: 0,
			bufferAfter: 10,
			noticeMinutes: 720,
			advanceDays: 60,
			autoConfirm: false,
			agendaRequired: false,
			platforms: ["zoom"],
		},
		events: [
			// Chloe's booked portfolio review — the same instant her order line (07_finance) is scheduled.
			{ at: FERN_REVIEW_SLOT(), minutes: 60, kind: "session", title: "Portfolio review" },
			{ at: { week: 1, day: 0, time: "14:00" }, minutes: 120, kind: "busy", title: "Editorial deadline" },
		],
	},
];

/**
 * When Chloe's booked portfolio review happens — shared by the Studio Fern schedule above and the
 * order line that paid for it (`07_finance.sql`), so the calendar and the invoice name one instant.
 * A function so the spec above can reference it before this line in the file.
 */
export function FERN_REVIEW_SLOT(): WeekSlot {
	return { week: 1, day: 2, time: "10:00" };
}
// #endregion

// #region Discovery calls
export const DISCOVERY_CALLS: DiscoveryCallSpec[] = [
	{
		key: "theo-maris",
		host: "maris",
		requester: "theo",
		type: "courtesy",
		status: "proposed",
		at: { week: 1, day: 1, time: "14:00" },
		agenda: "Scoping a design-system refresh for our booking app before we commit to a pipeline.",
		platform: "google",
		listing: "sv-design-system-foundation",
		requestedDaysBefore: 3,
	},
	{
		key: "noor-juno",
		host: "juno",
		requester: "noor",
		type: "paid",
		status: "confirmed",
		at: { week: 1, day: 0, time: "09:00" },
		agenda: "Walk through the landing page brief and the analytics we need wired in.",
		platform: "google",
		listing: "sv-landing-page-in-a-week",
		requestedDaysBefore: 5,
	},
	{
		key: "daniel-north",
		host: "north",
		requester: "daniel",
		type: "courtesy",
		status: "confirmed",
		at: { week: 1, day: 2, time: "10:00" },
		agenda: "Realtime dashboard for Atlas — is a four-week MVP realistic for our data volumes?",
		platform: "google",
		listing: "sv-realtime-mvp-build",
		requestedDaysBefore: 4,
	},
	{
		key: "chloe-nova",
		host: "nova",
		requester: "chloe",
		type: "courtesy",
		status: "completed",
		at: { week: -1, day: 1, time: "11:00" },
		agenda: "Advice on a portfolio brand before I start pitching.",
		platform: "zoom",
		requestedDaysBefore: 6,
	},
];
// #endregion

// #region Project meetings
/**
 * A meeting on an engagement's own calendar (`scheduling.events.project_id`), with its roster and —
 * where there is one — the open attempt to move it.
 *
 * Every roster is people who really are on the engagement: the client's owner and business members,
 * the freelancer or team seated on the stage. Rooms are either still to be minted (`pending`) or a
 * named place with no link: a seeded meeting URL would be a link to nowhere.
 *
 * The two negotiations are the two branches the calendar's reschedule surface has: a group meeting
 * settled by a vote (Meridian — three people, so `rescheduleModeFor` says vote), and a 1-on-1 settled
 * by the other party accepting a slot (Atlas). Both sit next week, so a reset on any day leaves them
 * outside the 12-hour lockout with the vote's deadline still ahead.
 */
export interface ProjectMeetingSpec {
	key: string;
	/** A `world.ts` project key. */
	project: string;
	/** The stage whose room it belongs to, or none for the whole engagement. */
	stage?: string;
	title: string;
	tz: string;
	at: WeekSlot;
	minutes: number;
	meeting: {
		provider: "google" | "zoom" | "microsoft_teams" | "custom";
		label: string;
		details?: string;
		/** The room is still to be created — nothing to join yet. */
		pending?: boolean;
	};
	/** Persona key of the organiser, seated as the `host`. */
	host: string;
	attendees: Array<{
		who: string;
		role?: "participant" | "optional";
		response: "accepted" | "rejected" | "tentative" | "pending";
		note?: string;
		/** When they answered; omitted for `pending` (the schema keeps an unanswered row undated). */
		respondedHoursAgo?: number;
	}>;
	createdDaysAgo: number;
	reschedule?: {
		mode: "vote" | "counterparty";
		status: "voting" | "awaiting_counterparty";
		openedHoursAgo: number;
		/** A slot offered by the host is on the ballot at once; one offered by an attendee awaits approval. */
		proposals: Array<{ by: string; at: WeekSlot; minutes: number; hoursAgo: number; note?: string }>;
		votes?: Array<{ who: string; proposal: number; hoursAgo: number }>;
	};
}

export const PROJECT_MEETINGS: ProjectMeetingSpec[] = [
	{
		key: "helia-readout",
		project: "helia-wallet",
		stage: "s1",
		title: "Research readout",
		tz: "Europe/London",
		at: { week: -1, day: 3, time: "10:00" },
		minutes: 60,
		meeting: { provider: "custom", label: "In person", details: "Helia office, 3rd floor — Thames room" },
		host: "hannah",
		attendees: [
			{ who: "maris", response: "accepted", respondedHoursAgo: 190 },
			{ who: "priya", role: "optional", response: "accepted", respondedHoursAgo: 170 },
		],
		createdDaysAgo: 12,
	},
	{
		key: "helia-flows",
		project: "helia-wallet",
		stage: "s1",
		title: "Flows walkthrough",
		tz: "Europe/London",
		at: { week: 1, day: 1, time: "10:00" },
		minutes: 45,
		meeting: { provider: "google", label: "Google Meet", pending: true },
		host: "hannah",
		attendees: [
			{ who: "maris", response: "accepted", respondedHoursAgo: 20 },
			{ who: "priya", response: "tentative", note: "Might join a few minutes late.", respondedHoursAgo: 6 },
		],
		createdDaysAgo: 2,
	},
	{
		key: "meridian-crit",
		project: "meridian-ds",
		stage: "s2",
		title: "Design system crit",
		tz: "Europe/London",
		at: { week: 1, day: 2, time: "11:00" },
		minutes: 60,
		meeting: { provider: "custom", label: "In person", details: "Helia office, 3rd floor — Thames room" },
		host: "hannah",
		attendees: [
			{ who: "maris", response: "pending" },
			{ who: "priya", response: "accepted", respondedHoursAgo: 30 },
		],
		createdDaysAgo: 4,
		reschedule: {
			mode: "vote",
			status: "voting",
			openedHoursAgo: 26,
			proposals: [
				{ by: "hannah", at: { week: 1, day: 3, time: "15:00" }, minutes: 60, hoursAgo: 26 },
				{ by: "hannah", at: { week: 2, day: 0, time: "10:00" }, minutes: 60, hoursAgo: 26 },
				{
					by: "maris",
					at: { week: 1, day: 4, time: "11:00" },
					minutes: 60,
					hoursAgo: 20,
					note: "Friday morning works best for the component walkthrough.",
				},
			],
			votes: [{ who: "priya", proposal: 0, hoursAgo: 5 }],
		},
	},
	{
		key: "atlas-demo",
		project: "atlas-analytics",
		stage: "s2",
		title: "Sprint demo",
		tz: "America/Toronto",
		at: { week: 1, day: 3, time: "11:00" },
		minutes: 45,
		meeting: { provider: "zoom", label: "Zoom", pending: true },
		host: "daniel",
		attendees: [{ who: "kwame", response: "pending" }],
		createdDaysAgo: 3,
		reschedule: {
			mode: "counterparty",
			status: "awaiting_counterparty",
			openedHoursAgo: 8,
			proposals: [
				{
					by: "daniel",
					at: { week: 2, day: 1, time: "11:00" },
					minutes: 45,
					hoursAgo: 8,
					note: "Our data team is out on Thursday — could we push to the Tuesday after?",
				},
			],
		},
	},
	{
		key: "noor-kickoff",
		project: "noor-site",
		stage: "s1",
		title: "Kick-off call",
		tz: "Asia/Dubai",
		at: { week: 1, day: 0, time: "13:00" },
		minutes: 30,
		meeting: { provider: "google", label: "Google Meet", pending: true },
		host: "noor",
		attendees: [
			{ who: "juno", response: "tentative", note: "Running five minutes late from another call.", respondedHoursAgo: 14 },
		],
		createdDaysAgo: 1,
	},
	{
		key: "verdant-moodboard",
		project: "verdant-brand",
		stage: "s1",
		title: "Moodboard review",
		tz: "Europe/London",
		at: { week: 1, day: 1, time: "15:00" },
		minutes: 45,
		meeting: { provider: "custom", label: "Studio", details: "Nova studio, Lisbon — or dial in on request" },
		host: "priya",
		attendees: [
			{ who: "ines", response: "accepted", respondedHoursAgo: 40 },
			{ who: "lena", role: "optional", response: "pending" },
		],
		createdDaysAgo: 5,
	},
];

/**
 * Stage deadlines — the `file_due_date` a stage with a `fixed_deadline` owes its work by, in the
 * client's zone. Keyed `project:stage`.
 */
export const STAGE_DEADLINES: Record<string, { tz: string; at: WeekSlot }> = {
	"helia-wallet:s1": { tz: "Europe/London", at: { week: 1, day: 4, time: "17:00" } },
	"meridian-ds:s2": { tz: "Europe/London", at: { week: 2, day: 3, time: "17:00" } },
	"atlas-analytics:s2": { tz: "America/Toronto", at: { week: 2, day: 0, time: "17:00" } },
	"noor-site:s1": { tz: "Asia/Dubai", at: { week: 2, day: 2, time: "17:00" } },
	"verdant-brand:s1": { tz: "Europe/London", at: { week: 1, day: 4, time: "12:00" } },
};
// #endregion
