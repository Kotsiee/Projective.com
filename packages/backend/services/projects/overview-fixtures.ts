import { formatMoney, type MoneyView } from "@projective/types/finance";
import type {
	BoardCard,
	ChannelKind,
	ProjectAssignment,
	ProjectDetail,
	ProjectOverview,
	ProjectOverviewChannel,
	ProjectOverviewFinance,
	ProjectParty,
	ProjectStatus,
	ProjectSummary,
	ProjectUpdate,
	SystemActivityType,
} from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";
import { findMessagePage } from "./messages-fixtures.ts";
import { findProject } from "./query.ts";

/**
 * projects overview fixtures — the in-memory answer for the FREELANCER's `/projects/[projectId]`
 * dashboard while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10).
 *
 * Like every sibling read it DERIVES rather than declares: the hero, the update rail, the channel
 * shortcuts, the assignment list and the money position are all folded out of the SAME resolved
 * {@link ProjectDetail} and board corpus the sidebar and the Kanban board render, so the dashboard can
 * never quote a stage, a ticket or a figure the surface next to it disagrees with. No RNG; a fixed
 * reference clock and unsigned slug hashes only.
 *
 * ## Every index is unsigned
 *
 * `>>> 0`, never `>> 0`. A signed shift on a 32-bit hash goes negative, a negative index reads
 * `undefined` out of a pool, and the result is a rendered "undefined min" rather than a thrown error
 * — a bug this repo has shipped more than once (root CLAUDE.md §8 Decision #48).
 *
 * ## Viewer pertinence, and the one thing the corpus cannot say
 *
 * {@link ProjectOverviewFinanceSchema} is the viewer's own escrow position and nothing else: a
 * freelancer is owed a truthful account of their own money and is owed nothing about what the client
 * pays anybody else. The corpus has no per-viewer ASSIGNMENT, though — `BoardPage.viewerId` is the
 * sentinel `"viewer"`, which matches no party in the cast — so the dashboard adopts one provider seat
 * as the acting account's, chosen deterministically from the board's own assignee pool. The live path
 * replaces that choice with `projects.tickets.current_assignee_id` and nothing else about this module
 * changes.
 */

// #region Reference clock + deterministic helpers
/** Fixed reference "now" (no `Date.now()`), matching the sibling fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A tiny stable hash → non-negative int. Every derived index is taken from this UNSIGNED. */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A short relative label ("3h ago", "Yesterday", "Mon, Jul 14") — `atLabel` is `max(28)`.
 *
 * UTC components and fixed English month/day names, never `Intl`: this string is produced on the
 * server and re-produced by the island on every refetch, so anything reading a local zone or a locale
 * makes SSR and hydration disagree about when something happened.
 */
function relativeLabel(ms: number): string {
	const delta = NOW - ms;
	if (delta < HOUR) {
		const mins = Math.max(1, Math.floor(delta / 60_000));
		return `${mins}m ago`;
	}
	if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
	const days = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (days === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Fri, 12 Sep` — the due label on an assignment row. */
function dueLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	return `Due ${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
}
// #endregion

// #region Money
/**
 * The engagement's currency.
 *
 * `projects.projects.currency` has no counterpart on {@link ProjectSummary}, so the fixture corpus
 * quotes a single currency throughout — the same one {@link formatTicketMoney} assumes for the board.
 * A per-project currency arrives with the live path, at which point this constant is read from the
 * row rather than assumed.
 */
const FIXTURE_CURRENCY = "USD";

/**
 * Build the money shape the surface renders.
 *
 * Server-summed, server-formatted, and handed over as a finished string: the client never totals,
 * splits or converts (root CLAUDE.md §8 Decision #55). `origin` is `null` because nothing here has
 * been converted — an FX disclosure beside an unconverted figure manufactures doubt about an exact
 * number.
 */
function money(minor: number): MoneyView {
	return {
		minor,
		currency: FIXTURE_CURRENCY,
		display: formatMoney(minor, FIXTURE_CURRENCY),
		origin: null,
	};
}

/**
 * Fold a ticket's money trail into the viewer's three-state position.
 *
 * Only the two movements that are the FREELANCER's are counted. A `fee` is the platform's 5% cut and
 * a `refund` returns money to the client, so neither is ever the viewer's money; counting either
 * would tell a freelancer they had been paid something that went somewhere else. `held` is committed
 * but nobody's yet, a `settled` release has landed, and a `pending` release is inside the clearing
 * window — the same three words the wallet uses, so a freelancer reading one surface and then the
 * other is reading one vocabulary.
 */
function financeOf(cards: readonly BoardCard[]): ProjectOverviewFinance {
	let escrowed = 0;
	let released = 0;
	let pending = 0;
	for (const card of cards) {
		for (const entry of card.payments) {
			if (entry.kind === "hold" && entry.state === "held") escrowed += Math.abs(entry.amountCents);
			if (entry.kind !== "release") continue;
			if (entry.state === "settled") released += Math.abs(entry.amountCents);
			if (entry.state === "pending") pending += Math.abs(entry.amountCents);
		}
	}
	return { escrowed: money(escrowed), released: money(released), pending: money(pending) };
}
// #endregion

// #region Hero
/** The lifecycle state in words — the one containered element on the identity row (§B.11). */
const STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

/** The engagement's format in words, for the middot-separated meta line. */
const FORMAT_LABEL: Record<ProjectSummary["format"], string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
	session: "Sessions",
};

/**
 * The identity band.
 *
 * `meta` is assembled here, pre-formatted, for the same reason the feed pre-formats `budgetLabel`: a
 * currency or a count assembled in the browser renders a different string from the one SSR sent, and
 * the two disagreeing is a hydration mismatch on the first line of the page.
 */
function heroOf(row: ProjectSummary, detail: ProjectDetail): ProjectOverview["hero"] {
	const meta: string[] = [detail.typeLabel, FORMAT_LABEL[row.format], row.scopeLabel];
	if (row.counterparty) meta.push(`with ${row.counterparty.name}`);
	if (row.budgetLabel) meta.push(row.budgetLabel);

	return {
		title: detail.title,
		owner: detail.owner,
		handle: detail.owner.handle,
		status: detail.status,
		statusLabel: STATUS_LABEL[detail.status],
		meta,
		completedStages: row.completedStages,
		totalStages: row.totalStages,
	};
}
// #endregion

// #region Assignments
/**
 * The provider seat the acting account holds on this engagement.
 *
 * See the module docblock: there is no per-viewer assignment in the corpus, so one seat from the
 * board's own assignee pool is adopted, chosen by an unsigned slug hash so the same project always
 * resolves the same seat and the dashboard agrees with itself across refreshes.
 */
function viewerSeat(slug: string, assignees: readonly ProjectParty[]): ProjectParty | null {
	if (assignees.length === 0) return null;
	return assignees[hash(`${slug}:seat`) % assignees.length];
}

/** Whether two parties are the same person. Handle first; a fixture party may carry only a name. */
function samePerson(a: ProjectParty | null, b: ProjectParty | null): boolean {
	if (!a || !b) return false;
	return (a.handle ?? a.name) === (b.handle ?? b.name);
}

/**
 * The viewer's open work, newest first.
 *
 * Completed and cancelled tickets are excluded: "Your work" is what is still owed, and a finished
 * ticket sitting in it is a to-do item that can never be ticked off.
 */
function assignmentsOf(
	slug: string,
	cards: readonly BoardCard[],
	stageNames: ReadonlyMap<string, string>,
	seat: ProjectParty | null,
): ProjectAssignment[] {
	return cards
		.filter((card) => samePerson(card.assignee, seat))
		.filter((card) => card.status !== "completed" && card.status !== "cancelled")
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, 12)
		.map((card) => ({
			ticketId: card.id,
			title: card.title,
			stageName: card.stageId ? stageNames.get(card.stageId) ?? null : null,
			status: card.status,
			dueLabel: card.dueDate ? dueLabel(card.dueDate) : null,
			href: `/projects/${slug}/board`,
		}));
}
// #endregion

// #region Channels
/** How many rooms the quick-entry list carries before it stops being a shortcut. */
const CHANNEL_LIMIT = 8;

/**
 * The rooms worth opening, unread first.
 *
 * Ordered rather than filtered: a project whose channels are all read still needs somewhere to go, so
 * the list degrades to "the rooms this engagement has" instead of to an empty block that reads as a
 * missing feature.
 */
function channelsOf(slug: string, detail: ProjectDetail): ProjectOverviewChannel[] {
	const rows: Array<{ id: string; name: string; kind: ChannelKind; unread: boolean }> = [
		...detail.channels.general.map((c) => ({
			id: c.id,
			name: c.name,
			kind: c.kind,
			unread: c.unread,
		})),
		...detail.channels.stages.map((s) => ({
			id: s.channel.id,
			name: s.channel.name,
			kind: s.channel.kind,
			unread: s.channel.unread,
		})),
		...detail.channels.teams.flatMap((t) =>
			t.channels.map((c) => ({ id: c.id, name: c.name, kind: c.kind, unread: c.unread }))
		),
		...detail.channels.dms.map((d) => ({
			id: d.chatId,
			name: d.party.name,
			kind: "dm" as ChannelKind,
			unread: d.unread,
		})),
	];

	return rows
		.sort((a, b) => Number(b.unread) - Number(a.unread))
		.slice(0, CHANNEL_LIMIT)
		.map((row) => ({
			id: row.id,
			name: row.name,
			kind: row.kind,
			unread: row.unread,
			lastMessagePreview: previewOf(slug, row.id),
			href: `/projects/${slug}/${row.id}`,
		}));
}

/** How much of the last line the row shows before it stops being a preview. */
const PREVIEW_MAX = 120;

/**
 * The last line in a room, truncated server-side.
 *
 * Resolved through the SAME message fixture the channel itself renders, so the preview and the
 * conversation it opens cannot show different last messages. An empty room yields `""`, which the
 * surface reads as "nothing here yet" rather than as a failed lookup.
 */
function previewOf(slug: string, channelId: string): string {
	const page = findMessagePage({ projectId: slug, channelId, limit: 1 });
	const last = page?.messages[page.messages.length - 1];
	if (!last) return "";
	const text = last.text.trim() || (last.audio ? "Voice message" : "Attachment");
	return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}
// #endregion

// #region Updates
/** How many events the rail carries. Beyond this it stops being "recent". */
const UPDATE_LIMIT = 12;

/** A line in the update rail, before it is sorted and capped. */
interface UpdateSeed {
	id: string;
	kind: SystemActivityType;
	actor: ProjectParty | null;
	text: string;
	at: number;
	href: string | null;
}

/**
 * Everything that has happened on this engagement, newest first.
 *
 * Assembled from facts the corpus states unambiguously rather than by translating the ticket audit
 * log wholesale. {@link TicketHistoryKind} carries entries — `status`, `edited`, `priority` — with no
 * counterpart in {@link SystemActivityType}, and mapping one onto the nearest available member would
 * report a priority change as a closed ticket. Only the three kinds that mean the same thing on both
 * sides are carried across; the rest of the rail is built from the stage run and the money trail,
 * which say what they mean.
 */
function updatesOf(
	slug: string,
	detail: ProjectDetail,
	cards: readonly BoardCard[],
	seat: ProjectParty | null,
): ProjectUpdate[] {
	const seeds: UpdateSeed[] = [];
	const boardHref = `/projects/${slug}/board`;

	for (const stage of detail.channels.stages) {
		if (stage.status !== "completed") continue;
		const at = NOW - (hash(`${slug}:${stage.id}:done`) % 21 + stage.order) * DAY;
		seeds.push({
			id: `${slug}-stage-${stage.id}`,
			kind: "stage_completed",
			actor: null,
			text: `${stage.name} was completed and signed off.`,
			at,
			href: `/projects/${slug}/${stage.channel.id}`,
		});
	}

	for (const card of cards) {
		if (card.activity === "revision_requested") {
			seeds.push({
				id: `${card.id}-revision`,
				kind: "revision_requested",
				actor: card.owner,
				text: `A revision was requested on “${card.title}”.`,
				at: Date.parse(card.updatedAt),
				href: boardHref,
			});
		}
		for (const entry of card.history) {
			const kind = UPDATE_KIND[entry.kind];
			if (!kind) continue;
			seeds.push({
				id: entry.id,
				kind,
				actor: entry.actor,
				text: `${entry.summary} — ${card.title}`,
				at: Date.parse(entry.at),
				href: kind === "submission_made" ? `/projects/${slug}/submissions` : boardHref,
			});
		}
		if (!samePerson(card.assignee, seat)) continue;
		for (const entry of card.payments) {
			if (entry.kind !== "release" || entry.state !== "settled") continue;
			seeds.push({
				id: `${card.id}-${entry.id}`,
				kind: "payment_released",
				actor: entry.party,
				text: `${entry.label} on “${card.title}”.`,
				at: Date.parse(entry.at),
				href: boardHref,
			});
		}
	}

	return seeds
		.filter((seed) => Number.isFinite(seed.at))
		.sort((a, b) => b.at - a.at)
		.slice(0, UPDATE_LIMIT)
		.map((seed) => ({
			id: seed.id,
			kind: seed.kind,
			actor: seed.actor,
			text: seed.text.length > 240 ? `${seed.text.slice(0, 239)}…` : seed.text,
			at: new Date(seed.at).toISOString(),
			atLabel: relativeLabel(seed.at),
			href: seed.href,
		}));
}

/**
 * The three audit kinds that mean the same thing in both vocabularies.
 *
 * Deliberately partial. An entry with no honest counterpart is DROPPED, because a rail that reports
 * an edit as a closed ticket is worse than one that does not mention the edit at all.
 */
const UPDATE_KIND: Partial<Record<BoardCard["history"][number]["kind"], SystemActivityType>> = {
	created: "ticket_created",
	submission: "submission_made",
	assigned: "member_joined",
};
// #endregion

// #region Public builder
/**
 * Resolve the freelancer dashboard for a slug, or `null` when no such engagement (→ 404).
 *
 * The board is resolved ONCE, at project scope with no facets, and every derived block reads from
 * that one list — so the assignment count, the money position and the update rail are three views of
 * one corpus rather than three independent derivations that can drift apart.
 */
export function findProjectOverview(slug: string): ProjectOverview | null {
	const row = findProject(slug);
	const detail = findProjectDetail(slug);
	if (!row || !detail) return null;

	const board = findBoardPage({ projectId: slug, view: "stages" });
	const cards = board?.cards ?? [];
	const seat = viewerSeat(slug, board?.assignees ?? []);
	const stageNames = new Map(detail.channels.stages.map((s) => [s.id, s.name]));
	const mine = cards.filter((card) => samePerson(card.assignee, seat));

	return {
		slug,
		hero: heroOf(row, detail),
		updates: updatesOf(slug, detail, cards, seat),
		channels: channelsOf(slug, detail),
		assignments: assignmentsOf(slug, cards, stageNames, seat),
		finance: financeOf(mine),
	};
}
// #endregion
