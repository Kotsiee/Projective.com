import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import {
	ActionMenu,
	composeMenu,
	type ContextSurfaceSource,
	linkActionItems,
	type MenuItem,
} from "@projective/ui/navigation";
import { styleVars } from "@ui/core/style.ts";
import { kindCopy, roleLabel, type WorkspaceSummary } from "@projective/types/workspace";
import { initialsOf } from "../core/workspace-model.ts";
import { cloneGlyph, KebabGlyph } from "../core/workspace-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * WorkspaceCard — one entity on the `/teams` · `/businesses` index, and the surface's most-repeated
 * element.
 *
 * The whole card is a single stretched anchor to the console, so a middle-click opens a tab and a
 * Cmd-click opens a background tab exactly as a link should — the behaviour an `onClick` handler on a
 * `<div>` silently takes away. The kebab and the flag stack sit ABOVE that anchor in the stacking order
 * (`position: relative` + `z-index`), so opening the menu never navigates.
 *
 * **Dumb by construction.** Every action is dispatched to the island through {@link onAction}; the card
 * fetches nothing, decides no permissions, and formats no money — `summary.stats` values arrive
 * pre-formatted from the server and are rendered verbatim (root CLAUDE.md §12).
 *
 * Presentation follows the surface's two hard rules. The mark is a **rounded square** because an entity
 * is an organisation; the member stack is **circular** because those are people. In-row state is
 * **iconographic** — a state dot, a verification dot, a pulsing update dot — and the words live only in
 * the portal `Tooltip` (§B.6), never as inline prose beside the name.
 */

// #region Props
/** An action a card (or a compact-view row) dispatches to its island. */
export type WorkspaceCardAction =
	| "act"
	| "exit"
	| "profile"
	| "wallet"
	| "copy"
	| "archive"
	| "restore";

export interface WorkspaceCardProps {
	/** The roster projection this card renders. */
	summary: WorkspaceSummary;
	/** The console href — the card's stretched link. */
	href: string;
	/** Whether a context switch is in flight, so the acting action cannot be double-fired. */
	busy?: boolean;
	/** Dispatches a menu action upward; the island owns every side effect. */
	onAction: (action: WorkspaceCardAction, summary: WorkspaceSummary) => void;
}
// #endregion

// #region Card
export function WorkspaceCard(props: WorkspaceCardProps): JSX.Element {
	const { summary, href, busy, onAction } = props;
	const copy = kindCopy(summary.kind);
	const stats = summary.stats.slice(0, 3);
	const hidden = Math.max(0, summary.memberCount - summary.faces.length);
	const unfinished = summary.setupProgress < 1;
	const cardRef = useRef<HTMLElement>(null);

	return (
		<article
			ref={cardRef}
			class="wsp-card"
			role="listitem"
			data-kind={summary.kind}
			data-acting={summary.isActing ? "true" : undefined}
			data-status={summary.status}
		>
			{
				/*
				 * The stretched link carries the accessible name for the whole card and is visually erased by
				 * `font-size: 0` — the name the reader sees is the `__name-text` below, which is not itself a
				 * link so a text selection inside the card does not start a drag on an anchor.
				 */
			}
			<a class="wsp-card__link" href={href}>{summary.name}</a>

			<div class="wsp-card__top">
				<EntityMark summary={summary} />

				<div class="wsp-card__ident">
					<h3 class="wsp-card__name">
						<span class="wsp-card__name-text">{summary.name}</span>
						{summary.hasUpdate && (
							<Tooltip content="New activity since you last looked" placement="top">
								<span class="wsp-pulse wsp-card__dot" role="status" aria-label="New activity" />
							</Tooltip>
						)}
					</h3>
					<span class="wsp-card__handle">@{summary.handle}</span>
				</div>

				{
					/*
					 * Acting is folded INTO the role chip rather than sitting beside it. The two were
					 * separate chips of identical shape, differing only in fill, and both answered the same
					 * question — what is my relationship to this workspace — so they read as two competing
					 * marks where there is one fact. As a dot on the role chip the state is iconographic
					 * with its words in the tooltip, which is what §B.6 asks of an in-row status.
					 */
				}
				<div class="wsp-card__flags">
					{summary.isActing
						? (
							<Tooltip content="You are acting as this workspace" placement="top">
								<span class="wsp-chip wsp-chip--acting">
									<span class="wsp-actingchip__dot" aria-hidden="true" />
									{roleLabel(summary.role)}
								</span>
							</Tooltip>
						)
						: (
							<span class="wsp-chip" data-tone={summary.isOwner ? undefined : "muted"}>
								{roleLabel(summary.role)}
							</span>
						)}
					<StateDots summary={summary} />
					<WorkspaceKebab
						summary={summary}
						href={href}
						busy={busy}
						onAction={onAction}
						surface={cardRef}
					/>
				</div>
			</div>

			{summary.tagline && <p class="wsp-card__tagline">{summary.tagline}</p>}

			<div class="wsp-card__members">
				<MemberStack summary={summary} hidden={hidden} />
				<span class="wsp-card__membercount">
					{summary.memberCount} {summary.memberCount === 1 ? "member" : "members"}
				</span>
			</div>

			{stats.length > 0 && (
				<div class="wsp-card__stats">
					{stats.map((stat) => (
						<div class="wsp-card__stat" key={stat.label}>
							<span class="wsp-card__stat-label">{stat.label}</span>
							<span class="wsp-card__stat-value">{stat.value}</span>
							{stat.delta && (
								<span class="wsp-card__stat-delta" data-dir={deltaDirection(stat.delta)}>
									{stat.delta}
								</span>
							)}
						</div>
					))}
				</div>
			)}

			{unfinished && (
				<div class="wsp-card__setup">
					{
						/*
						 * The fill's inline-size ENCODES the progress, so it is a value channel (`--wsp-progress`)
						 * and never a transition: a frozen animation clock must not be able to draw a finished
						 * checklist as empty. The printed percentage carries the same fact in text.
						 */
					}
					<span class="wsp-card__setup-bar" aria-hidden="true">
						<span
							class="wsp-card__setup-fill"
							style={styleVars({ "--wsp-progress": summary.setupProgress })}
						/>
					</span>
					<span class="wsp-card__setup-text">
						{Math.round(summary.setupProgress * 100)}% set up
					</span>
				</div>
			)}

			{
				/* A draft entity is fully usable, so the state is stated once, quietly, and never as a
			warning — see `StateDots` for the tooltip that explains it. */
			}
			<span class="ui-visually-hidden">
				{copy.Noun}, {summary.status}
				{summary.isActing ? ", currently acting as this " + copy.noun : ""}
			</span>
		</article>
	);
}
// #endregion

// #region The entity mark
/** The rounded-square badge: a logo when there is one, the derived initials when there is not. */
function EntityMark({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	return (
		<span class="wsp-mark wsp-mark--lg" aria-hidden="true">
			{summary.avatar
				? <img class="wsp-mark__img" src={summary.avatar} alt="" loading="lazy" />
				: (
					<span class="wsp-mark__initial">
						{initialsOf(summary.name, summary.handle)}
					</span>
				)}
		</span>
	);
}
// #endregion

// #region Iconographic state
/**
 * The lifecycle dot, plus a verification dot only while verification is outstanding.
 *
 * A verified entity gets no mark at all: a badge that appears on every healthy row teaches the reader
 * to ignore it, and then it cannot do its job on the row that is actually blocked.
 */
function StateDots({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	const copy = kindCopy(summary.kind);
	const lifecycle = summary.status === "draft"
		? `Draft — usable now, setup unfinished`
		: summary.status === "archived"
		? `Archived — restorable at any time`
		: `Active ${copy.noun}`;

	return (
		<>
			<Tooltip content={lifecycle} placement="top">
				<span
					class="wsp-statedot wsp-card__dot"
					data-state={summary.status}
					role="img"
					aria-label={lifecycle}
				/>
			</Tooltip>
			{summary.verification !== "verified" && (
				<Tooltip
					content={summary.verification === "pending"
						? `${copy.verification} in review`
						: `${copy.verification} not started — needed before money moves`}
					placement="top"
				>
					<span
						class="wsp-statedot wsp-card__dot"
						data-verify={summary.verification}
						role="img"
						aria-label={`${copy.verification} ${summary.verification}`}
					/>
				</Tooltip>
			)}
		</>
	);
}
// #endregion

// #region The member stack
/**
 * Up to five circular faces plus a `+N` for the remainder.
 *
 * The images are decorative (`alt=""`) and the names are announced once from the container, so a
 * screen reader hears "5 of 12 members: …" rather than five consecutive unlabelled graphics.
 */
function MemberStack(
	{ summary, hidden }: { summary: WorkspaceSummary; hidden: number },
): JSX.Element | null {
	if (summary.faces.length === 0) return null;
	const names = summary.faces.map((f) => f.name).join(", ");
	return (
		<div
			class="wsp-card__faces"
			role="img"
			aria-label={`${summary.faces.length} of ${summary.memberCount} members: ${names}`}
		>
			{summary.faces.map((face) => (
				<UserAvatar
					key={face.handle}
					class="wsp-card__face"
					image={face.avatar || undefined}
					label={face.name}
					alt=""
					size={24}
				/>
			))}
			{hidden > 0 && <span class="wsp-card__more" aria-hidden="true">+{hidden}</span>}
		</div>
	);
}
// #endregion

// #region The kebab menu
export interface WorkspaceKebabProps extends WorkspaceCardProps {
	/** Anchor the panel to the block-end edge on a row rather than a card. */
	placement?: "bottom-end" | "bottom-start";
	/** The card or row this menu belongs to; right-click on it opens the same rows at the pointer. */
	surface?: ContextSurfaceSource;
}

const MENU_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;

function linkRows(summary: WorkspaceSummary, href: string, copyLink: () => void): MenuItem[] {
	return linkActionItems({
		href,
		title: summary.name,
		include: ["open", "open-new-tab", "copy-link"],
	}).map((row) => {
		if (row.key === "link-open") return { ...row, label: "Open console" };
		if (row.key === "link-copy") return { ...row, command: copyLink };
		return row;
	});
}

function actingRow(
	summary: WorkspaceSummary,
	busy: boolean,
	dispatch: (action: WorkspaceCardAction) => void,
): MenuItem {
	const busyReason = "A switch is already in progress.";
	if (summary.isActing) {
		return {
			key: "exit",
			label: "Return to acting personally",
			icon: "logout",
			disabled: busy,
			disabledReason: busyReason,
			command: () => dispatch("exit"),
		};
	}
	const archived = summary.status === "archived";
	return {
		key: "act",
		label: `Act as this ${kindCopy(summary.kind).noun}`,
		icon: "switch",
		hint: "Everything you do is attributed to it",
		disabled: busy || archived,
		disabledReason: archived ? "Restore it before acting as it." : busyReason,
		command: () => dispatch("act"),
	};
}

function ownerRows(
	summary: WorkspaceSummary,
	dispatch: (action: WorkspaceCardAction) => void,
): MenuItem[] {
	if (!summary.isOwner) return [];
	return summary.status === "archived"
		? [{ key: "restore", label: "Restore", icon: "history", command: () => dispatch("restore") }]
		: [{
			key: "archive",
			label: "Archive",
			icon: "archive-box",
			hint: "Hidden from your roster; restorable",
			command: () => dispatch("archive"),
		}];
}

/**
 * An entity's menu rows: the console link rows, acting as it, its public profile and money, and the
 * owner's archive or restore. The card's kebab and the compact table's row actions both render this.
 */
export function workspaceMenu(
	summary: WorkspaceSummary,
	href: string,
	busy: boolean,
	onAction: (action: WorkspaceCardAction, summary: WorkspaceSummary) => void,
): MenuItem[] {
	const copy = kindCopy(summary.kind);
	const dispatch = (action: WorkspaceCardAction) => onAction(action, summary);
	return composeMenu(
		linkRows(summary, href, () => dispatch("copy")),
		[actingRow(summary, busy, dispatch)],
		[
			{ key: "profile", label: "Public profile", icon: "user", command: () => dispatch("profile") },
			{
				key: "wallet",
				label: `Open the ${copy.moneyNoun}`,
				icon: "wallet",
				command: () => dispatch("wallet"),
			},
		],
		ownerRows(summary, dispatch),
	);
}

/**
 * The per-entity action menu, shared verbatim by the card and the compact view so the two presentations
 * can never drift into offering different actions for the same entity. Right-clicking the `surface`
 * opens the same rows at the pointer.
 *
 * Archiving is offered only to an owner, and only ever as "archive" — nothing on this surface
 * hard-deletes (root CLAUDE.md §5). `avoid` keeps the panel clear of the middle-nav lane the roster
 * body sits beside (Decision #19).
 */
export function WorkspaceKebab(props: WorkspaceKebabProps): JSX.Element {
	const { summary, href, busy = false, onAction, surface, placement = "bottom-end" } = props;
	const model = workspaceMenu(summary, href, busy, onAction);

	return (
		<ActionMenu
			model={model}
			surface={surface}
			placement={placement}
			avoid={MENU_AVOID}
			aria-label={`Actions for ${summary.name}`}
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="wsp-card__kebab"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					aria-label={`Actions for ${summary.name}`}
					onClick={api.toggle}
				>
					{cloneGlyph(KebabGlyph)}
				</button>
			)}
		/>
	);
}
// #endregion

// #region Helpers
/**
 * The tonal direction of a pre-formatted delta string.
 *
 * Reads the SIGN the server already printed rather than comparing numbers — the client never parses a
 * money figure, and a compacted value ("+£1.2k") is not arithmetic it should be attempting.
 */
export function deltaDirection(delta: string): "up" | "down" | "flat" {
	const first = delta.trim().charAt(0);
	if (first === "+") return "up";
	if (first === "-" || first === "−") return "down";
	return "flat";
}
// #endregion
