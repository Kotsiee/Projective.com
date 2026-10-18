import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { MetaLine, Tag } from "@projective/ui/display";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import {
	ActionMenu,
	composeMenu,
	type ContextSurfaceSource,
	linkActionItems,
	type MenuItem,
} from "@projective/ui/navigation";
import { kindCopy, type WorkspaceSummary } from "@projective/types/workspace";
import {
	cardFigure,
	cardMeta,
	lifecycleTag,
	setupPercent,
	setupUnfinished,
} from "../core/roster-model.ts";
import { cloneGlyph, KebabGlyph } from "../core/workspace-glyphs.tsx";
import { EntityMark } from "./EntityMark.tsx";

/**
 * WorkspaceCard — one entity on the `/teams` · `/businesses` index, and the surface's most-repeated
 * element (Teams work order R1).
 *
 * **The whole card is ONE link to the console**: a single stretched anchor, so a middle-click opens a
 * tab and a Cmd-click a background tab exactly as a link should — the behaviour an `onClick` handler
 * on a `<div>` silently takes away. The kebab sits ABOVE that anchor in the stacking order and stops
 * its own press from travelling further, so opening the menu never navigates; right-click, the
 * ContextMenu key and Shift+F10 anywhere on the card open the same rows (Decision #222's `surface`).
 *
 * **What it says**, top to bottom: the `EntityMark` (squares are entities), the name in the title
 * register at `--fw-medium` and the `@handle` beneath it; the lifecycle `Tag` — ONLY for a Draft or
 * Archived entity — then ONE `MetaLine` of facts (`Owner · 4 members · 2 live projects`, `Acting`
 * while the session acts as it), never chips (§B.11); the one-line tagline; the kind's 30-day figure;
 * and, until setup is done, the ui `ProgressBar`. Unseen activity and outstanding verification stay
 * iconographic beside the kebab, their words in the Tooltip (§B.6).
 *
 * **Separation** is the card's own: it is the interactive container, so it sits on `--surface-1`
 * with no border, lifts one tonal step on hover and compresses on press (§B.12). Acting is the
 * reserved leading rule (W1), never a ring.
 *
 * **Dumb by construction.** Every action is dispatched to the island through {@link onAction}; the
 * card fetches nothing, decides no permissions, and formats no money — the figure arrives
 * pre-formatted from the server and is rendered verbatim (Decision #55). Every rule it renders is
 * `roster-model.ts`.
 */

// #region Props
/** An action a card (or a table row) dispatches to its island. */
export type WorkspaceCardAction =
	| "act"
	| "exit"
	| "profile"
	| "wallet"
	| "copy"
	| "archive"
	| "restore";

/** Props for {@link WorkspaceCard}. */
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
/** One entity on the roster index: a single link to its console, with its kebab menu above it. */
export function WorkspaceCard(props: WorkspaceCardProps): JSX.Element {
	const { summary, href, busy, onAction } = props;
	const copy = kindCopy(summary.kind);
	const tag = lifecycleTag(summary.status);
	const figure = cardFigure(summary);
	const percent = setupPercent(summary.setupProgress);
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
				 * `font-size: 0` — the name the reader sees is the heading below, which is not itself a link,
				 * so a text selection inside the card does not start a drag on an anchor.
				 */
			}
			<a class="wsp-card__link" href={href}>{summary.name}</a>

			<div class="wsp-card__top">
				<EntityMark
					name={summary.name}
					handle={summary.handle}
					image={summary.avatar}
					size="md"
				/>
				<div class="wsp-card__ident">
					<h3 class="wsp-card__name">{summary.name}</h3>
					<span class="wsp-card__handle">@{summary.handle}</span>
				</div>
				<div class="wsp-card__marks">
					<EntityStateMarks summary={summary} />
					<WorkspaceKebab
						summary={summary}
						href={href}
						busy={busy}
						onAction={onAction}
						surface={cardRef}
					/>
				</div>
			</div>

			<div class="wsp-card__facts">
				{tag && <Tag value={tag.label} severity={tag.severity} variant="subtle" rounded />}
				<MetaLine class="wsp-card__meta" items={cardMeta(summary)} />
			</div>

			{summary.tagline && <p class="wsp-card__tagline">{summary.tagline}</p>}

			{figure && (
				<p class="wsp-card__figure">
					<span class="wsp-card__figure-label">{figure.label}</span>
					<span class="wsp-card__figure-value">{figure.value}</span>
				</p>
			)}

			{setupUnfinished(summary.setupProgress) && (
				<div class="wsp-card__setup">
					{/* The fill is the kind token, set on the bar's accent by the roster sheet. */}
					<ProgressBar
						class="wsp-card__setup-bar"
						value={percent}
						aria-label={`Setup ${percent}% complete`}
					/>
					<span class="wsp-card__setup-text" aria-hidden="true">{percent}% set up</span>
				</div>
			)}

			{
				/* The stretched link names the entity; this says its kind and lifecycle, which an active
				   card shows the eye only by the absence of a Tag. Acting is the MetaLine's own word. */
			}
			<span class="ui-visually-hidden">{copy.Noun}, {summary.status}</span>
		</article>
	);
}
// #endregion

// #region Iconographic state
/**
 * The unseen-activity pulse, and the verification dot only while verification is outstanding — each a
 * mark with its words in the Tooltip (§B.6). A verified entity gets no mark at all: a badge on every
 * healthy card or row teaches the reader to ignore it, and then it cannot do its job on the one that
 * is actually blocked. Shared by the card and the table's identity cell.
 */
export function EntityStateMarks({ summary }: { summary: WorkspaceSummary }): JSX.Element {
	const copy = kindCopy(summary.kind);
	return (
		<>
			{summary.hasUpdate && (
				<Tooltip content="New activity since you last looked" placement="top">
					<span class="wsp-pulse" role="img" aria-label="New activity" />
				</Tooltip>
			)}
			{summary.verification !== "verified" && (
				<Tooltip
					content={summary.verification === "pending"
						? `${copy.verification} in review`
						: `${copy.verification} not started — needed before money moves`}
					placement="top"
				>
					<span
						class="wsp-statedot"
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

// #region The kebab menu
/** Props for {@link WorkspaceKebab} — a card's own, plus where its panel opens and what it hangs on. */
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
 * owner's archive or restore. The card's kebab and the table's row actions both render this.
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
 * The per-entity action menu, shared verbatim by the card and the table so the two presentations can
 * never drift into offering different actions for the same entity. Its trigger is the ui `Button`
 * (tier 5, icon-only, named by `aria-label`), which stops its press at itself so nothing under the
 * card's link answers it. Right-clicking the `surface` opens the same rows at the pointer.
 *
 * Archiving is offered only to an owner, and only ever as "archive" — nothing on this surface
 * hard-deletes (root CLAUDE.md §5). `avoid` keeps the panel clear of the middle-nav lane the roster
 * body sits beside (Decision #19).
 */
export function WorkspaceKebab(props: WorkspaceKebabProps): JSX.Element {
	const { summary, href, busy = false, onAction, surface, placement = "bottom-end" } = props;
	const model = workspaceMenu(summary, href, busy, onAction);
	const label = `Actions for ${summary.name}`;

	return (
		<ActionMenu
			model={model}
			surface={surface}
			placement={placement}
			avoid={MENU_AVOID}
			aria-label={label}
			trigger={(api) => (
				<Button
					triggerRef={api.ref}
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					icon={cloneGlyph(KebabGlyph)}
					aria-label={label}
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={(event) => {
						event.stopPropagation();
						api.toggle();
					}}
				/>
			)}
		/>
	);
}
// #endregion
