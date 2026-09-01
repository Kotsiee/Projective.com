import type { ComponentChildren, JSX } from "preact";
import { Icon, type IconName } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import type {
	ChannelKind,
	ProjectAssignment,
	ProjectOverviewChannel,
	ProjectOverviewFinance,
	ProjectStatus,
	ProjectUpdate,
	SystemActivityType,
	TicketStatus,
} from "../../types/projects-types.ts";
import { statusLabel, statusTone } from "../../core/board-model.ts";

/**
 * DashboardBlocks — the parts the member dashboard on `/projects/[projectId]` is assembled from: the
 * shared identity primitives (the middot meta line, the one licensed lifecycle pill) and the four
 * content blocks (Recent updates · Messages · Your work · Your earnings on this project).
 *
 * Every export here is a SERVER component. There is no state, no fetch and no signal: the dashboard's
 * whole read arrives resolved from `resolveProjectOverview`, and the money in it is server-summed,
 * server-converted and server-formatted, so anything this file did with a figure beyond rendering it
 * would be a second arithmetic path (root CLAUDE.md §8 Decision #55).
 *
 * ## Empty is a real value
 *
 * Each block renders an honest sentence when its list is empty rather than collapsing to nothing. A
 * blank region is indistinguishable from a failed fetch, so the reader is left diagnosing the
 * interface instead of reading it; "No updates yet" is a fact and closes the question.
 *
 * ## What is allowed a container
 *
 * Exactly one thing on this surface: the engagement's lifecycle status, whose fill IS the semantic
 * channel (DESIGN_SYSTEM.md §B.11.3). The project type, its format and its workspace are what the
 * engagement permanently *is*, so they are inline `--text-secondary` text separated by middots. A
 * ticket's state is drawn as a tinted mark plus its word rather than a second pill, because two
 * adjacent non-interactive fills on one row is the §B.11.5 finding.
 */

// #region Identity primitives
/**
 * Non-actionable metadata as one inline, middot-separated line (§B.11.2).
 *
 * Renders a `<span>`, not a `<p>`: this line appears inside an anchor's phrasing content on an
 * assignment row as well as beside the title in the hero, and a paragraph nested in a `<span>` is
 * invalid markup that browsers repair by breaking the row apart.
 *
 * Keyed by INDEX rather than by value. The server dedupes what it can, but a component must not
 * depend on its caller having done so — a type label and a workspace name can legitimately collide,
 * and keying by the string risks mis-reconciling the row.
 */
export function MetaFacts({ items }: { items: readonly string[] }): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<span class="pjd-meta">
			{items.map((item, i) => (
				<span class="pjd-meta__item" key={`${i}:${item}`}>
					{i > 0 && <span class="pjd-meta__sep" aria-hidden="true">·</span>}
					<span>{item}</span>
				</span>
			))}
		</span>
	);
}

/**
 * The engagement's lifecycle state — the one fill this surface spends.
 *
 * The colour rides a `data-status` attribute rather than a class per state so the stylesheet owns the
 * whole mapping, and the WORD is always present: colour is never the only channel carrying the fact.
 */
export function StatusMark(
	{ status, label }: { status: ProjectStatus; label: string },
): JSX.Element {
	return <span class="pjd-status" data-status={status}>{label}</span>;
}
// #endregion

// #region Block frame
/** Props shared by every block: a section header, an optional trailing link, and its content. */
interface BlockProps {
	title: string;
	/** The fuller view for this block; omitted when the block has nowhere further to go. */
	moreHref?: string;
	moreLabel?: string;
	children: ComponentChildren;
}

/**
 * A section: a header in the §A.4 section register over its content, separated from its neighbours by
 * SPACING alone. No surface, no border, no card — a block is a region of the page, and §B.4 spends
 * one device on a boundary, which the grid's gap has already spent.
 */
function Block({ title, moreHref, moreLabel, children }: BlockProps): JSX.Element {
	return (
		<section class="pjd-block">
			<div class="pjd-block__head">
				<h2 class="pjd-block__title">{title}</h2>
				{moreHref && <a class="pjd-block__more" href={moreHref}>{moreLabel ?? "View all"}</a>}
			</div>
			{children}
		</section>
	);
}

/** The honest empty line a block renders in place of its list. */
function Empty({ children }: { children: string }): JSX.Element {
	return <p class="pjd-block__empty">{children}</p>;
}
// #endregion

// #region Recent updates
/**
 * The glyph for an activity kind.
 *
 * Exhaustive over {@link SystemActivityType} deliberately: a `Record` forces a new member of that
 * enum to be given a mark here rather than silently falling through to a default, which is how one
 * event ends up wearing another event's meaning.
 */
const UPDATE_ICON: Record<SystemActivityType, IconName> = {
	submission_made: "submission",
	ticket_created: "ticket",
	ticket_closed: "check",
	revision_requested: "refresh",
	stage_completed: "stages",
	member_joined: "user-plus",
	member_left: "user-minus",
	payment_released: "wallet",
};

/**
 * Recent updates — the engagement's activity, newest first.
 *
 * An entry with no `href` renders as a plain row rather than as an anchor. A styled, hoverable
 * affordance whose handler reaches nothing is a defect of the same class as a broken link and is
 * invisible to a type-checker (root CLAUDE.md §3 gate 11), so the absence of a target has to change
 * the element, not merely disable a handler.
 */
export function UpdatesBlock({ updates }: { updates: readonly ProjectUpdate[] }): JSX.Element {
	return (
		<Block title="Recent updates">
			{updates.length === 0
				? <Empty>No updates yet. Activity on this engagement will appear here.</Empty>
				: (
					<ul class="pjd-list">
						{updates.map((u) => {
							const body = (
								<>
									<span class="pjd-row__icon" aria-hidden="true">
										<Icon name={UPDATE_ICON[u.kind]} size="sm" />
									</span>
									<span class="pjd-row__body">
										<span class="pjd-row__text">{u.text}</span>
									</span>
									<span class="pjd-row__time">{u.atLabel}</span>
								</>
							);
							return (
								<li key={u.id}>
									{u.href
										? <a class="pjd-row" href={u.href}>{body}</a>
										: <div class="pjd-row">{body}</div>}
								</li>
							);
						})}
					</ul>
				)}
		</Block>
	);
}
// #endregion

// #region Messages
/** The glyph for a room's kind — exhaustive for the same reason {@link UPDATE_ICON} is. */
const CHANNEL_ICON: Record<ChannelKind, IconName> = {
	general: "channel",
	stage: "stages",
	team: "members",
	dm: "message",
};

/**
 * Messages — the rooms worth opening, each a quick entry into `/projects/[projectId]/[channelId]`.
 *
 * Unread is a PULSING DOT and never a count (DESIGN_SYSTEM.md Part D.1). The dot is decorative to
 * assistive technology and the fact travels as text beside it, because a coloured circle is not a
 * word and a reader who cannot see it is owed the same information rather than a smaller version
 * of it.
 */
export function MessagesBlock(
	{ channels }: { channels: readonly ProjectOverviewChannel[] },
): JSX.Element {
	return (
		<Block title="Messages">
			{channels.length === 0
				? <Empty>No conversations yet. Rooms you can open will be listed here.</Empty>
				: (
					<ul class="pjd-list">
						{channels.map((c) => (
							<li key={c.id}>
								<a class="pjd-row" href={c.href}>
									<span class="pjd-row__icon" aria-hidden="true">
										<Icon name={CHANNEL_ICON[c.kind]} size="sm" />
									</span>
									<span class="pjd-row__body">
										<span class="pjd-row__title">{c.name}</span>
										{c.lastMessagePreview !== "" && (
											<span class="pjd-row__sub">{c.lastMessagePreview}</span>
										)}
									</span>
									{c.unread && (
										<span class="pjd-row__end">
											<span class="ui-visually-hidden">Unread</span>
											<span class="pjd-dot" aria-hidden="true" />
										</span>
									)}
								</a>
							</li>
						))}
					</ul>
				)}
		</Block>
	);
}
// #endregion

// #region Your work
/**
 * The stage meter.
 *
 * The fill's width is written straight onto the element as a custom property the stylesheet consumes,
 * so the geometry is correct on the first paint and stays correct in a backgrounded tab. A width that
 * arrives through a transition renders at zero while the animation clock is frozen, which reports no
 * progress on an engagement that has some — the Decision #60 defect class.
 *
 * The track itself is `aria-hidden`; the accessible reading is the `role="progressbar"` wrapper,
 * which carries the raw stage counts rather than the derived percentage because "3 of 5 stages" is
 * the fact and 60% is an inference from it.
 */
function StageProgress({ completed, total }: { completed: number; total: number }): JSX.Element {
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
	return (
		<div
			class="pjd-progress"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={completed}
			aria-valuetext={`${completed} of ${total} stages complete`}
			aria-label="Stage progress"
		>
			<p class="pjd-progress__head">
				<span>Stage progress</span>
				<span class="pjd-progress__value">{completed} / {total}</span>
			</p>
			<span class="pjd-progress__track" aria-hidden="true">
				<span class="pjd-progress__fill" style={{ "--pjd-fill": `${pct}%` }} />
			</span>
		</div>
	);
}

/**
 * The stage and the due date as one middot line.
 *
 * An undated ticket contributes nothing rather than the word "undated": an absent deadline is not a
 * fact the reader needs restating, and it is emphatically not the same as an overdue one.
 */
function workMeta(stageName: string | null, dueLabel: string | null): string[] {
	const out: string[] = [];
	if (stageName) out.push(stageName);
	if (dueLabel) out.push(dueLabel);
	return out;
}

/** A ticket's lifecycle state: the tone on the mark, the state in words beside it. */
function TicketState({ status }: { status: TicketStatus }): JSX.Element {
	return (
		<span class="pjd-tstate" data-tone={statusTone(status)}>
			<span class="pjd-tstate__mark" aria-hidden="true" />
			{statusLabel(status)}
		</span>
	);
}

/**
 * Your work — the tickets assigned to the viewer, with the stage each runs in and the run's overall
 * progress above them.
 *
 * The ticket state is a tinted mark plus its word, not a pill: the hero already spends this surface's
 * one licensed fill on the engagement's lifecycle, and a second fill on the same screen makes the two
 * compete for the channel §A.1 reserves for semantics.
 */
export function WorkBlock(
	{ assignments, completedStages, totalStages }: {
		assignments: readonly ProjectAssignment[];
		completedStages: number | null;
		totalStages: number | null;
	},
): JSX.Element {
	const total = totalStages ?? 0;
	return (
		<Block title="Your work">
			{total > 0 && <StageProgress completed={completedStages ?? 0} total={total} />}
			{assignments.length === 0
				? <Empty>Nothing assigned to you yet. Tickets you claim will show up here.</Empty>
				: (
					<ul class="pjd-list">
						{assignments.map((a) => (
							<li key={a.ticketId}>
								<a class="pjd-row" href={a.href}>
									<span class="pjd-row__body">
										<span class="pjd-row__title">{a.title}</span>
										<MetaFacts items={workMeta(a.stageName, a.dueLabel)} />
									</span>
									<span class="pjd-row__end">
										<TicketState status={a.status} />
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
		</Block>
	);
}
// #endregion

// #region Your earnings
/** One named money position, in the order a freelancer reads them: committed → paid → clearing. */
const FINANCE_ROWS: { key: keyof ProjectOverviewFinance; term: string }[] = [
	{ key: "escrowed", term: "In escrow" },
	{ key: "released", term: "Released" },
	{ key: "pending", term: "Pending release" },
];

/**
 * Your earnings on this project — the viewer's own position, and nothing about the engagement's
 * books.
 *
 * Three figures the server summed, rendered through {@link MoneyView} so a currency switch
 * re-projects each one from its own immutable origin. Nothing here adds two of them together to make
 * a fourth: the client is not a second place money is calculated, and a total that disagreed with the
 * ledger by a rounding step would be a wrong number stated confidently.
 */
export function EarningsBlock({ finance }: { finance: ProjectOverviewFinance }): JSX.Element {
	return (
		<Block title="Your earnings on this project">
			<dl class="pjd-money">
				{FINANCE_ROWS.map((r) => (
					<div class="pjd-money__row" key={r.key}>
						<dt class="pjd-money__term">{r.term}</dt>
						<dd class="pjd-money__value">
							<MoneyView value={finance[r.key]} size="key" />
						</dd>
					</div>
				))}
			</dl>
			<p class="pjd-money__note">
				Your position on this engagement only. Everything you have earned across the platform lives
				in your <a class="pjd-money__link" href="/wallet">wallet</a>.
			</p>
		</Block>
	);
}
// #endregion
