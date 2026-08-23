import { z } from "zod";
import { MoneyViewSchema } from "../finance/wallet.ts";

/**
 * Event COORDINATION — who is coming, what the occurrence is worth, how a time gets moved, and what
 * has happened to it since it was created.
 *
 * `./scheduling.ts` positions an event on a grid; this file describes the negotiation around it.
 * The two are deliberately separate because the calendar ENGINE (`@projective/ui/calendar`) needs
 * only the former: it is a portable, zod-free, product-agnostic renderer, so RSVP states, votes and
 * money must never become part of its presentational contract. An event carrying these fields flows
 * through the engine untouched (object identity is preserved across `onOpenEvent`) and the app casts
 * back to the Zod type at the boundary, exactly as it already does.
 *
 * **Money.** Every figure is a {@link MoneyViewSchema} — the ONE money shape on the platform
 * (integer minor units + currency + a server-formatted display string + the pre-conversion origin).
 * It is imported from `finance`, never re-declared: a second money representation is how a total
 * comes to disagree with the ledger it was drawn from. Nothing here is a float, and no client
 * multiplies seats by a price — {@link EventPricingSchema.occurrenceEarnings} arrives computed.
 *
 * **The rules are here, not in a component.** The business rules below govern commitments and money,
 * so they are pure exported functions with unit tests beside them ({@link ./coordination_test.ts})
 * rather than conditions inlined into a modal. A surface that needs to know whether a reschedule is
 * still allowed asks {@link canReschedule}; there is no second implementation to drift. The fat
 * `ScheduleBackendService` applies these same functions — it never re-derives a rule — so a refusal
 * a surface predicts and a refusal the server issues cannot disagree.
 *
 * **Privacy is not here.** What a given VIEWER is allowed to receive of all this is a separate
 * concern with a separate file ({@link ./privacy.ts}), applied at the service boundary on the way
 * out. Keeping the two apart is deliberate: these rules answer "may this happen", that one answers
 * "may this person see it", and conflating them is how a payload comes to be filtered by whether a
 * block is masked rather than by who is asking.
 *
 * Like its siblings this is a READ + WRITE projection: the shapes are what a surface renders and
 * what it posts back, not table rows (contrast `./rows.ts`). See the module note in `./mod.ts` for
 * what the live path would need to persist them.
 */

// #region Business rules — named constants
/** One hour in ms. Private: the exported rules speak in hours, callers in instants. */
const HOUR_MS = 3_600_000;

/**
 * How close to an event rescheduling stops being allowed. Inside this window the other party has
 * almost certainly arranged their day around the slot, so moving it stops being a negotiation and
 * becomes a cancellation.
 *
 * ⚠️ **Unreconciled with the 24-hour cancellation window, and deliberately left that way.**
 * `PRODUCT_SPEC.md` §Cancellation & Escrow Protection refunds an attendee who cancels more than 24
 * hours out and forfeits their escrow inside it. Between T-24h and T-12h this figure still permits a
 * MOVE, so rescheduling is a documented route around the forfeit rule. Which number governs — and
 * whether moving a session inside the escrow window should carry the same financial consequence as
 * cancelling it — is a money decision, so it is flagged in root CLAUDE.md §8 for a human rather than
 * settled here by picking whichever value happened to be easier to implement.
 */
export const RESCHEDULE_LOCKOUT_HOURS = 12;
/** {@link RESCHEDULE_LOCKOUT_HOURS} in milliseconds. */
export const RESCHEDULE_LOCKOUT_MS = RESCHEDULE_LOCKOUT_HOURS * HOUR_MS;

/**
 * How far ahead of the earliest slot on the ballot a vote resolves, so the winner is announced with
 * enough notice to be actionable.
 *
 * Deliberately a SEPARATE constant from {@link RESCHEDULE_LOCKOUT_HOURS} even though both are 12
 * today: one governs whether a time may be touched, the other when a decision is taken. Collapsing
 * them into one figure would silently couple two unrelated policies the first time either moves.
 */
export const VOTE_RESOLUTION_LEAD_HOURS = 12;
/** {@link VOTE_RESOLUTION_LEAD_HOURS} in milliseconds. */
export const VOTE_RESOLUTION_LEAD_MS = VOTE_RESOLUTION_LEAD_HOURS * HOUR_MS;

/**
 * The minimum number of slots that must be on the ballot before a vote may open. One option is not
 * a vote — it is an announcement, and putting it to a cohort implies a choice they do not have.
 */
export const MIN_VOTE_PROPOSALS = 2;
// #endregion

// #region Party identity
/**
 * A person attached to an event — the actor on a history line, the author of a proposal, a voter.
 *
 * Field-for-field identical to the projects domain's `ProjectPartySchema` so one renderer reads
 * both, but declared locally rather than imported: a public `/[handle]/availability` page is
 * guest-reachable and has no business dragging in the engagement type graph to draw a face.
 */
export const SchedulingPartySchema = z.object({
	name: z.string().min(1).max(120),
	/** Avatar URL (Unsplash face crops in fixtures, per DESIGN_SYSTEM.md §C.4). */
	avatar: z.string().max(400).nullable(),
	handle: z.string().max(40).nullable(),
});
export type SchedulingParty = z.infer<typeof SchedulingPartySchema>;
// #endregion

// #region Attendees + RSVP
/**
 * An invitee's answer.
 *
 * `pending` is a real state, not the absence of one: "has not answered yet" and "said no" are
 * different facts to a host deciding whether a session is viable, so the roster always carries a
 * response and never leaves it undefined.
 */
export const RsvpResponse = z.enum(["accepted", "rejected", "tentative", "pending"]);
export type RsvpResponse = z.infer<typeof RsvpResponse>;

/** Human labels for the four responses. */
export const RSVP_LABEL: Record<RsvpResponse, string> = {
	accepted: "Going",
	rejected: "Not going",
	tentative: "Maybe",
	pending: "No answer yet",
};

/** Why someone is on the roster — drives whether their absence blocks the meeting. */
export const AttendeeRole = z.enum(["host", "participant", "optional"]);
export type AttendeeRole = z.infer<typeof AttendeeRole>;

/** One row of an event's participant list. */
export const EventAttendeeSchema = SchedulingPartySchema.extend({
	/** Stable per-event id — the key a vote and a per-attendee write address. */
	id: z.string().min(1).max(120),
	role: AttendeeRole,
	response: RsvpResponse,
	/** Epoch ms (UTC) of the answer; `null` while `pending`. */
	respondedAt: z.number().int().nullable(),
	/**
	 * True on the acting viewer's own row. Server-resolved: the client has no reliable way to
	 * recognise itself in a roster (a handle can be absent, and a display name is not an identity).
	 */
	isViewer: z.boolean().default(false),
	/** A short note the attendee left with their answer ("joining late"). */
	note: z.string().max(280).nullable(),
});
export type EventAttendee = z.infer<typeof EventAttendeeSchema>;
// #endregion

// #region Money
/**
 * How an occurrence is priced. `free` is explicit rather than a null price, because a courtesy call
 * being deliberately free and a session whose price has not been set are different facts.
 */
export const EventPricingModel = z.enum(["free", "per_seat", "per_session"]);
export type EventPricingModel = z.infer<typeof EventPricingModel>;

/**
 * What an event is worth — for a paid group session, a recurring class, or a paid discovery call.
 *
 * Every total is SERVER-COMPUTED. The client renders `display` strings and never multiplies a seat
 * price by an attendee count: a rounded per-seat figure times a count does not reliably equal the
 * amount that will actually be released, and a host reading a fabricated number would be reading a
 * promise nobody made.
 */
export const EventPricingSchema = z.object({
	model: EventPricingModel,
	/** What one seat (`per_seat`) or the whole booking (`per_session`) costs. `null` when free. */
	unitPrice: MoneyViewSchema.nullable(),
	/** Seats actually paid for — the multiplicand behind {@link occurrenceEarnings}. */
	paidSeats: z.number().int().min(0),
	/** What the host earns from THIS occurrence, net of nothing — gross, as the ledger will see it. */
	occurrenceEarnings: MoneyViewSchema.nullable(),
	/**
	 * What the host earns across {@link remainingOccurrences} of a recurring session. `null` for a
	 * one-off, so a single booking never advertises a series total it does not have.
	 */
	seriesEarnings: MoneyViewSchema.nullable(),
	/** Occurrences {@link seriesEarnings} covers, this one included. `1` for a one-off. */
	remainingOccurrences: z.number().int().min(1),
	/** Whether the viewer has already paid for their seat (gates the pay affordance). */
	viewerHasPaid: z.boolean().default(false),
});
export type EventPricing = z.infer<typeof EventPricingSchema>;
// #endregion

// #region Rescheduling + voting
/** Which side of the table a proposed slot came from. */
export const ProposerRole = z.enum(["host", "attendee"]);
export type ProposerRole = z.infer<typeof ProposerRole>;

/** One attendee backing one proposed slot. */
export const ProposalVoteSchema = SchedulingPartySchema.extend({
	/** The {@link EventAttendeeSchema.id} that cast it — one vote per attendee, per negotiation. */
	attendeeId: z.string().min(1).max(120),
	/** Epoch ms (UTC) the vote was cast. */
	at: z.number().int(),
});
export type ProposalVote = z.infer<typeof ProposalVoteSchema>;

/** An alternative slot somebody has put forward. */
export const RescheduleProposalSchema = z.object({
	id: z.string().min(1).max(80),
	/** Epoch ms (UTC) of the proposed start / end. */
	start: z.number().int(),
	end: z.number().int(),
	proposedBy: SchedulingPartySchema,
	proposedByRole: ProposerRole,
	proposedAt: z.number().int(),
	/**
	 * Whether the host has let this slot onto the ballot.
	 *
	 * A host's own slot arrives approved — offering a time and then approving it would be theatre.
	 * A client's needs the freelancer's approval first, because the freelancer's calendar is the
	 * scarce side of the arrangement and a client should not be able to put a time in front of a
	 * cohort that the person delivering the work cannot make. See {@link isProposalOnBallot}.
	 */
	approved: z.boolean(),
	note: z.string().max(280).nullable(),
	votes: z.array(ProposalVoteSchema).max(200).default([]),
});
export type RescheduleProposal = z.infer<typeof RescheduleProposalSchema>;

/**
 * How this negotiation is settled: a 1-on-1 waits for the other party to confirm, a group session
 * puts the options to its cohort. The mode is a property of the EVENT (how many people have to
 * agree), not a choice the opener makes.
 */
export const RescheduleMode = z.enum(["counterparty", "vote"]);
export type RescheduleMode = z.infer<typeof RescheduleMode>;

/**
 * Which mode an event settles in, from its head count (the host included).
 *
 * Two people is a conversation and is settled by the other one saying yes; three or more is a vote.
 * Exported so the fixtures, the fat service and any surface derive it from ONE rule — the mode
 * decides which controls render and which refusals are possible, so two implementations of it would
 * eventually offer a "vote" of one.
 */
export function rescheduleModeFor(attendeeCount: number): RescheduleMode {
	return attendeeCount > 2 ? "vote" : "counterparty";
}

/**
 * Where the negotiation has got to.
 *
 * `collecting` is the host assembling slots before anything goes out — a vote cannot open until the
 * ballot holds {@link MIN_VOTE_PROPOSALS}, so there is a real interval during which proposals exist
 * and nobody has been asked anything. A per-proposal `approved: false` covers "waiting on the host",
 * which is why that is not a status here: two client proposals can be outstanding while a vote runs.
 *
 * **`resolved` and `lapsed` are two different endings and neither is the other's null case.**
 * `resolved` means a time was chosen and {@link EventRescheduleSchema.resolvedProposalId} names it;
 * `lapsed` means the cohort was asked, the question closed, and no slot reached a majority, so the
 * original time stands. Folding the second into `resolved` with a null winner was rejected: a reader
 * of `resolved` must be able to assume something was decided, and an overloaded null is how a
 * surface comes to render "moved to —".
 *
 * All three endings are terminal FOR THAT ROUND. Proposing again starts a fresh round (see
 * {@link EventRescheduleSchema.round}), which is why `withdrawn` is an ending rather than a trap.
 */
export const RescheduleStatus = z.enum([
	"none",
	"collecting",
	"awaiting_counterparty",
	"voting",
	"resolved",
	"lapsed",
	"withdrawn",
]);
export type RescheduleStatus = z.infer<typeof RescheduleStatus>;

/** The statuses from which nothing further can be asked of the current round. */
const CLOSED_STATUSES: readonly RescheduleStatus[] = ["resolved", "lapsed", "withdrawn"];

/**
 * Has this round ended? A closed round accepts no votes, approvals or confirmations — only a fresh
 * {@link RescheduleAction} `propose`, which opens the next one.
 */
export function isRescheduleClosed(status: RescheduleStatus): boolean {
	return CLOSED_STATUSES.includes(status);
}

/** The open (or most recent) attempt to move an event. */
export const EventRescheduleSchema = z.object({
	mode: RescheduleMode,
	status: RescheduleStatus,
	openedBy: SchedulingPartySchema.nullable(),
	/** Epoch ms (UTC) the negotiation opened; `null` when {@link RescheduleStatus} is `none`. */
	openedAt: z.number().int().nullable(),
	proposals: z.array(RescheduleProposalSchema).max(12).default([]),
	/**
	 * Epoch ms (UTC) the vote closes — {@link VOTE_RESOLUTION_LEAD_HOURS} before the EARLIEST slot on
	 * the ballot. Server-stamped from {@link voteResolvesAt} so SSR and the hydrated island agree on
	 * a deadline rather than each deriving it from a clock they separately own. `null` off a vote.
	 *
	 * Retained through `resolved` and `lapsed` — it is the instant the decision was taken, which a
	 * history line and a "closed 3 hours ago" label both read. Cleared on `withdrawn`, because a
	 * question that was pulled no longer has a deadline to have arrived.
	 */
	resolvesAt: z.number().int().nullable(),
	/** The proposal that won; `null` unless `resolved`. */
	resolvedProposalId: z.string().max(80).nullable(),
	/**
	 * Which attempt this is, from zero. A session may legitimately be moved more than once, and a
	 * withdrawn or lapsed round is not a reason to lose the ability to ask again — so `propose` after
	 * a closed round starts round `n + 1` with an empty ballot rather than appending to a question
	 * nobody can answer any more. It also keeps proposal ids unique across rounds.
	 */
	round: z.number().int().min(0).default(0),
});
export type EventReschedule = z.infer<typeof EventRescheduleSchema>;

/** The moves a party can make on a negotiation — the write vocabulary the thin route accepts. */
export const RescheduleAction = z.enum([
	"propose",
	"approve",
	"open",
	"vote",
	"confirm",
	"withdraw",
]);
export type RescheduleAction = z.infer<typeof RescheduleAction>;

/**
 * Machine-readable refusal codes, mirroring the {@link CallRefusalReason} precedent: a reason rather
 * than a bare boolean lets a surface explain a refusal without re-deriving the rules client-side,
 * and keeps the explanation identical wherever the refusal is rendered.
 */
export const RescheduleRefusalReason = z.enum([
	"inside_lockout",
	"proposal_inside_lockout",
	"event_passed",
	"not_enough_proposals",
	"proposal_not_approved",
	"unknown_proposal",
	"vote_closed",
	"no_majority",
	"not_permitted",
	"duplicate_vote",
]);
export type RescheduleRefusalReason = z.infer<typeof RescheduleRefusalReason>;

/** Human copy for each refusal code. */
export const RESCHEDULE_REFUSAL_COPY: Record<RescheduleRefusalReason, string> = {
	inside_lockout: `Too late to move this — it starts in under ${RESCHEDULE_LOCKOUT_HOURS} hours.`,
	proposal_inside_lockout:
		`Offer a time at least ${RESCHEDULE_LOCKOUT_HOURS} hours away — anything sooner could not be taken up.`,
	event_passed: "That session has already finished.",
	not_enough_proposals: "Offer at least two alternative times before opening a vote.",
	proposal_not_approved: "That time is waiting on the host's approval.",
	unknown_proposal: "That time is no longer on the table.",
	vote_closed: "Voting has closed for this session.",
	no_majority: "No time has a majority yet.",
	not_permitted: "You can't make that change.",
	duplicate_vote: "You've already voted.",
};
// #endregion

// #region History
/** What a {@link EventHistoryEntry} records — drives its glyph and tone. */
export const EventHistoryKind = z.enum([
	"created",
	"edited",
	"rescheduled",
	"proposal",
	"vote",
	"rsvp",
	"attachment",
	"meeting_link",
	"cancelled",
]);
export type EventHistoryKind = z.infer<typeof EventHistoryKind>;

/**
 * One entry in an event's chronological audit log.
 *
 * Shaped to match the projects domain's `TicketHistoryEntrySchema` field for field, so the two logs
 * read alike and a single row renderer serves both. `at` is an ISO string rather than the epoch ms
 * this domain uses elsewhere for the same reason it is on a ticket: a history line is LISTED, never
 * positioned on a grid, so it does not need the calendar engine's numeric contract.
 *
 * Append-only. Nothing is edited or removed — a correction is a new line (root CLAUDE.md §5).
 */
export const EventHistoryEntrySchema = z.object({
	id: z.string().min(1).max(80),
	kind: EventHistoryKind,
	/** Who acted; `null` for a system transition (a vote resolving on its deadline). */
	actor: SchedulingPartySchema.nullable(),
	/** The headline — "Proposed Thu 14:00", "Marked Going". */
	summary: z.string().min(1).max(200),
	/** Optional supporting line (the diff, the reason). */
	detail: z.string().max(400).nullable(),
	at: z.string(),
	dateLabel: z.string().max(28),
	/**
	 * Whether the acting viewer has not yet seen this event. A per-viewer fact, so it is resolved
	 * server-side rather than inferred from a timestamp the client would compare against a clock it
	 * does not own.
	 */
	unread: z.boolean().default(false),
	/**
	 * What this line points at when following it means going somewhere — a proposal id, an attendee
	 * id. `null` for a line with no destination. (The ticket log's positional `targetPath` addresses
	 * a submission TREE; an event has no tree, so a flat id is the honest equivalent.)
	 */
	targetId: z.string().max(120).nullable(),
});
export type EventHistoryEntry = z.infer<typeof EventHistoryEntrySchema>;
// #endregion

// #region Business rules — pure predicates
/**
 * The instant rescheduling closes for an event starting at `eventStartMs`. Exposed so a surface can
 * render a countdown against the same figure the refusal is computed from.
 */
export function rescheduleLockoutAt(eventStartMs: number): number {
	return eventStartMs - RESCHEDULE_LOCKOUT_MS;
}

/**
 * May this event still be moved? False once it starts in less than {@link RESCHEDULE_LOCKOUT_HOURS}
 * hours — and therefore also false for an event that has already started or finished, which falls
 * out of the same comparison rather than needing a second rule.
 *
 * The boundary is inclusive: at exactly the lockout the notice period is still satisfied.
 */
export function canReschedule(nowMs: number, eventStartMs: number): boolean {
	return eventStartMs - nowMs >= RESCHEDULE_LOCKOUT_MS;
}

/**
 * Is this slot on the ballot — i.e. may it be voted for or confirmed?
 *
 * A host's slot always is. An attendee's (in practice, a client's) needs the host's approval first,
 * so an unapproved client proposal is visible to the host as a request but is not an option anybody
 * else can pick.
 */
export function isProposalOnBallot(proposal: RescheduleProposal): boolean {
	return proposal.proposedByRole === "host" || proposal.approved;
}

/** The subset of `proposals` that can actually be chosen — see {@link isProposalOnBallot}. */
export function ballotProposals(
	proposals: readonly RescheduleProposal[],
): RescheduleProposal[] {
	return proposals.filter(isProposalOnBallot);
}

/**
 * May a vote be opened on these proposals? Requires {@link MIN_VOTE_PROPOSALS} slots ON THE BALLOT,
 * which is how "the freelancer must supply at least two alternatives" is enforced: a host's slots
 * qualify on arrival, so an unapproved client proposal cannot be used to make up the number.
 */
export function canOpenVote(proposals: readonly RescheduleProposal[]): boolean {
	return ballotProposals(proposals).length >= MIN_VOTE_PROPOSALS;
}

/**
 * When the vote closes: {@link VOTE_RESOLUTION_LEAD_HOURS} before the EARLIEST slot on the ballot —
 * because once the first option's notice period is gone, that option can no longer be chosen, and a
 * ballot that can still elect an unusable time is not a ballot.
 *
 * `null` when nothing is on the ballot. Note the result may already be in the past, which is a real
 * and renderable state (see {@link voteIsOpen}), not an error.
 */
export function voteResolvesAt(proposals: readonly RescheduleProposal[]): number | null {
	const ballot = ballotProposals(proposals);
	if (ballot.length === 0) return null;
	let earliest = ballot[0].start;
	for (const p of ballot) if (p.start < earliest) earliest = p.start;
	return earliest - VOTE_RESOLUTION_LEAD_MS;
}

/**
 * Is voting still open at `nowMs`? Exclusive at the deadline: the vote resolves AT that instant, so
 * a ballot cast on the stroke of it arrives after the decision.
 */
export function voteIsOpen(nowMs: number, proposals: readonly RescheduleProposal[]): boolean {
	const at = voteResolvesAt(proposals);
	return at !== null && nowMs < at;
}
// #endregion

// #region Derived views (counting, never deciding)
/** Votes per ballot proposal, highest first; ties broken by the earlier slot, then by id. */
export function voteTally(
	proposals: readonly RescheduleProposal[],
): { proposalId: string; votes: number }[] {
	return ballotProposals(proposals)
		.slice()
		.sort((a, b) =>
			b.votes.length - a.votes.length || a.start - b.start || a.id.localeCompare(b.id)
		)
		.map((p) => ({ proposalId: p.id, votes: p.votes.length }));
}

/**
 * The proposal currently winning, or `null` when the ballot is empty. Deterministic on a tie (the
 * earlier slot wins) so the same ballot always resolves the same way, on the server and in a
 * preview alike.
 */
export function leadingProposal(
	proposals: readonly RescheduleProposal[],
): RescheduleProposal | null {
	const top = voteTally(proposals)[0];
	if (!top) return null;
	return proposals.find((p) => p.id === top.proposalId) ?? null;
}

/** The proposal this attendee backed, or `null` when they have not voted. */
export function voteOf(
	proposals: readonly RescheduleProposal[],
	attendeeId: string,
): RescheduleProposal | null {
	return proposals.find((p) => p.votes.some((v) => v.attendeeId === attendeeId)) ?? null;
}

/** Head-count per response. Every key is always present, so a zero renders as a zero. */
export function rsvpTally(roster: readonly EventAttendee[]): Record<RsvpResponse, number> {
	const out: Record<RsvpResponse, number> = {
		accepted: 0,
		rejected: 0,
		tentative: 0,
		pending: 0,
	};
	for (const a of roster) out[a.response]++;
	return out;
}

/** The acting viewer's own roster row, or `null` when they are not an attendee. */
export function viewerAttendee(roster: readonly EventAttendee[]): EventAttendee | null {
	return roster.find((a) => a.isViewer) ?? null;
}
// #endregion

// #region Majority & settlement (Rule 6 — PRODUCT_SPEC §The Proactive Calendar)
/**
 * Who is entitled to vote: every seat except the host's.
 *
 * The host authored the options, so letting them vote too would be casting a ballot in their own
 * election — and, more importantly, it would inflate the denominator a majority is measured against.
 * `optional` attendees DO count: they were invited, and a time they cannot make is a time that
 * excludes them.
 */
export function eligibleVoterCount(roster: readonly EventAttendee[]): number {
	let n = 0;
	for (const a of roster) if (a.role !== "host") n++;
	return n;
}

/**
 * How many votes one slot needs to carry: strictly more than half of {@link eligibleVoterCount}.
 *
 * PRODUCT_SPEC.md §The Proactive Calendar: "In multi-attendee sessions (Group Sessions), a change in
 * time requires a **majority** consensus to be finalized." The denominator is everyone entitled to
 * vote, NOT everyone who happened to answer — measuring against votes cast would let two people move
 * a session of twelve simply by being the only two paying attention, which is the opposite of what
 * consensus means. Abstaining is therefore a vote against moving, and deliberately so: the default
 * outcome of an unanswered question is that nothing changes.
 */
export function voteQuorum(eligibleVoters: number): number {
	return Math.floor(Math.max(0, eligibleVoters) / 2) + 1;
}

/**
 * The slot that has actually carried, or `null` when none has.
 *
 * Reads the leader from {@link leadingProposal} and then tests it against the quorum, so there is one
 * ordering rule and one threshold rather than two. No tie-break can decide this: two slots cannot
 * both hold more than half of the same electorate, so {@link leadingProposal}'s earlier-slot-wins
 * tie-break only ever orders the DISPLAY, never the outcome.
 */
export function majorityProposal(
	proposals: readonly RescheduleProposal[],
	eligibleVoters: number,
): RescheduleProposal | null {
	const lead = leadingProposal(proposals);
	if (!lead) return null;
	return lead.votes.length >= voteQuorum(eligibleVoters) ? lead : null;
}

/** Total ballots cast across the whole ballot — one per attendee, so this is a head count. */
export function votesCast(proposals: readonly RescheduleProposal[]): number {
	let n = 0;
	for (const p of ballotProposals(proposals)) n += p.votes.length;
	return n;
}

/**
 * Has the question finished being asked? Either the deadline has arrived, or everybody entitled to
 * answer already has — a vote is immutable once cast ({@link RescheduleRefusalReason} `duplicate_vote`),
 * so once the last eligible voter has spoken the result cannot change and making a cohort wait out a
 * deadline whose outcome is already fixed is theatre.
 */
export function voteIsSettleable(
	nowMs: number,
	proposals: readonly RescheduleProposal[],
	eligibleVoters: number,
): boolean {
	if (!voteIsOpen(nowMs, proposals)) return true;
	return eligibleVoters > 0 && votesCast(proposals) >= eligibleVoters;
}

/**
 * Settle a negotiation that has finished being asked, returning the state it has come to rest in.
 *
 * **Total and idempotent** — a round that is not a live vote, or one that is a live vote still worth
 * asking, comes back untouched, and settling an already-settled round is a no-op. That is what lets
 * the read path apply it on every read and the write path apply it before every action without
 * either needing to know whether the other already had: there is no cron in this layer, so the
 * transition has to be a function of (clock, ballot, electorate) rather than an event somebody must
 * remember to fire. In the live path the same function backs the sweep that stamps the row.
 *
 * A vote that closes with a {@link majorityProposal} is `resolved` and names its winner; one that
 * closes without is `lapsed` and the original time stands.
 */
export function settleVote(
	nowMs: number,
	reschedule: EventReschedule,
	eligibleVoters: number,
): EventReschedule {
	if (reschedule.mode !== "vote" || reschedule.status !== "voting") return reschedule;
	if (!voteIsSettleable(nowMs, reschedule.proposals, eligibleVoters)) return reschedule;

	const winner = majorityProposal(reschedule.proposals, eligibleVoters);
	return winner
		? { ...reschedule, status: "resolved", resolvedProposalId: winner.id }
		: { ...reschedule, status: "lapsed", resolvedProposalId: null };
}
// #endregion

// #region Live status
/** Where an event sits relative to now. */
export const EventLiveState = z.enum(["upcoming", "running", "passed"]);
export type EventLiveState = z.infer<typeof EventLiveState>;

/** The resolved live status of one event. */
export interface EventLiveStatus {
	state: EventLiveState;
	/** Milliseconds until the start; `0` once it has started. */
	msUntilStart: number;
	/**
	 * Exact fractional hours until the start; `0` once it has started. Left unrounded on purpose —
	 * "in 11.9 hours" reads as 11 or 12 depending on the surface, and that is a presentation choice
	 * the render site makes, not one this function should bake in.
	 */
	hoursUntilStart: number;
	/** Milliseconds until the end; `0` once it has passed. */
	msUntilEnd: number;
}

/**
 * Is this event still to come, happening now, or over?
 *
 * Both boundaries are decided in favour of the later state: at exactly the start it is running (the
 * meeting is due, and telling someone it is "in 0 hours" is worse than telling them it has begun),
 * and at exactly the end it has passed.
 */
export function eventLiveStatus(
	nowMs: number,
	startMs: number,
	endMs: number,
): EventLiveStatus {
	const untilStart = Math.max(0, startMs - nowMs);
	const untilEnd = Math.max(0, endMs - nowMs);
	const state: EventLiveState = nowMs < startMs ? "upcoming" : nowMs < endMs ? "running" : "passed";
	return {
		state,
		msUntilStart: untilStart,
		hoursUntilStart: untilStart / HOUR_MS,
		msUntilEnd: untilEnd,
	};
}
// #endregion
