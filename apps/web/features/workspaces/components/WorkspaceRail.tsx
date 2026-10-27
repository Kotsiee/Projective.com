import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { LaneCollapseButton, LaneCreateButton } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import {
	kindCopy,
	type VerificationState,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import {
	hubSignal,
	type LaneHubRow,
	laneRailEntities,
	type LaneZones,
	type ModuleSignals,
	signalLabel,
	verificationWords,
} from "../core/lane-model.ts";
import { isWithinPath } from "../core/workspace-model.ts";
import {
	ChannelGlyph,
	cloneGlyph,
	InviteGlyph,
	PlusGlyph,
	SettingsGlyph,
} from "../core/workspace-glyphs.tsx";
import { EntityMark } from "./EntityMark.tsx";
import { ContextSwitchControl, isActingEntity } from "./ContextSwitchControl.tsx";

/**
 * WorkspaceRail — the **collapsed** presentation of the workspace lane: the same four zones the
 * expanded lane draws (`lane-model.ts`), folded to one column of glyphs.
 *
 *   1. **Header strip** → the entity's mark (its ring is the verification state) and the acting switch
 *      as an icon-only Button. The roster index has no identity to fold, so its rail starts at zone 2.
 *      The kebab folds into the header band's copy, which paints while the lane is collapsed.
 *   2. **Views** → Core operations' hub glyphs, a hairline, a team's Catalogue glyph and the Channels
 *      glyph (the two sections' homes) — or, on the roster index, the
 *      viewer's live entities as marks in the expanded list's order (owned first,
 *      {@link laneRailEntities}), so a collapsed lane is a switcher.
 *   3. **Context controls** → none: a segmented control has no glyph form, and the expanded lane is one
 *      press away. For the same reason the roster rail ignores the partition and the search — a filter
 *      the reader cannot see would hide entities for no visible reason.
 *   4. **Footer rig** → on the index the same `LaneCreateButton`; inside a console the circular Invite
 *      member and Settings; then the expand toggle.
 *
 * It is rendered **alongside** the expanded lane at all times and CSS reveals exactly one, keyed off
 * `.ui-splitter[data-mode="collapsed"]` (`workspace-chrome.css`). No client width observer: an
 * observer paints the wrong presentation for at least one frame on every load. It also makes the
 * toggle deterministic — the expanded lane's footer button only ever collapses, this rail's button
 * only ever expands, and each is visible solely in its own state.
 *
 * Every control here is icon-only, so every control carries a portal {@link Tooltip} **and** an
 * `aria-label`, never a native `title` (§B.6). Module glyphs are shared with the expanded lane and the
 * header band, so each is {@link cloneGlyph}-copied at the point of use.
 *
 * The module and entity squares and the identity mark are this feature's own links
 * (`workspace-chrome.css` owns their geometry, the NavItem active pair and their §B.12 press), like the
 * Projects and Catalogue rails: `NavItem`'s square form exists only in the collapsed global sidebar,
 * and in a collapsed splitter it is a label-less row with no press of its own.
 */

// #region Props
/**
 * What zone 4's one create action does when pressed — the props its `LaneCreateButton` takes: a
 * handler when it opens a modal on this page, an `href` when it lands on another page.
 */
export type LaneCreateTarget = { href: string } | { onClick: () => void };

export interface WorkspaceRailProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active entity square on the roster index. */
	path: string;
	/** The lane's composition; the rail folds the same zones. */
	zones: LaneZones;
	/** Zone 4's create action on the roster index — the same target the expanded lane's button takes. */
	createTarget: LaneCreateTarget | null;
	/** A console's Invite member — the same target the expanded footer's circle takes. */
	inviteTarget?: LaneCreateTarget | null;

	// --- Console ---
	/** The entity's id, name, handle and mark. Present inside a console. */
	entity?: {
		id: string;
		name: string;
		handle: string;
		avatar: string;
		verification: VerificationState;
		isActing: boolean;
	};
	/** Per-module attention marks, shared with the expanded lane. */
	signals?: ModuleSignals;

	// --- Roster index ---
	/** The viewer's entities. Present on the roster index. */
	entities?: readonly WorkspaceSummary[];
	/** The single acting entity id, already resolved. */
	actingId?: string | null;

	/** Expand the lane back out (dispatched to the splitter by the lane island). */
	onExpand: () => void;
}
// #endregion

// #region Component
/** The collapsed workspace rail. See the module header for the zone folding. */
export function WorkspaceRail(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const create = props.zones.footer.create;
	const target = props.createTarget;

	return (
		<nav
			class="wsp-rail"
			data-kind={props.kind}
			aria-label={props.entity ? `${props.entity.name} navigation` : `${copy.Plural} navigation`}
		>
			{props.entity && <RailIdentity kind={props.kind} entity={props.entity} />}

			<div class="wsp-rail__items">
				{props.entity ? <RailModules {...props} /> : <RailEntities {...props} />}
			</div>

			<div class="wsp-rail__bottom">
				{create && target && (
					<Tooltip content={create.label} placement="right">
						<LaneCreateButton
							label={create.label}
							icon={cloneGlyph(create.action === "invite" ? InviteGlyph : PlusGlyph)}
							{...target}
						/>
					</Tooltip>
				)}
				{props.entity && <RailUtilities {...props} />}
				<LaneCollapseButton
					collapsed
					icon={<SidebarToggleIcon />}
					tooltipPlacement="right"
					onToggle={props.onExpand}
				/>
			</div>
		</nav>
	);
}
// #endregion

// #region Zone 1 — identity
/** The entity's mark, ringed by its verification state, and the acting switch beneath it. */
function RailIdentity(
	{ kind, entity }: { kind: WorkspaceKind; entity: NonNullable<WorkspaceRailProps["entity"]> },
): JSX.Element {
	const verify = verificationWords(kind, entity.verification);
	return (
		<div class="wsp-rail__brand">
			<Tooltip content={`${entity.name} · ${verify}`} placement="right">
				<a
					class="wsp-rail__switch"
					href={workspaceHref(kind, entity.handle)}
					data-verify={entity.verification}
					data-acting={entity.isActing ? "true" : undefined}
					aria-label={`${entity.name} overview, ${verify}`}
				>
					<EntityMark
						name={entity.name}
						handle={entity.handle}
						kind={kind}
						image={entity.avatar}
						size="md"
					/>
				</a>
			</Tooltip>
			<ContextSwitchControl
				kind={kind}
				id={entity.id}
				name={entity.name}
				handle={entity.handle}
				acting={entity.isActing}
				variant="icon"
			/>
		</div>
	);
}
// #endregion

// #region Zone 2 — views
/**
 * Core operations' hubs, a team's Catalogue and the Channels glyph — the expanded
 * zone 2 in glyphs, each group set off by a hairline.
 */
function RailModules(props: WorkspaceRailProps): JSX.Element | null {
	const views = props.zones.views;
	const entity = props.entity;
	if (views.mode !== "console" || !entity) return null;
	const signals = props.signals ?? {};

	const square = (row: LaneHubRow) => {
		const mark = signalLabel(hubSignal(row.modules, signals));
		// The blurb is the tooltip's second half: with the label hidden, "what is this for" is exactly
		// what a bare glyph cannot say.
		return (
			<Tooltip key={row.key} content={`${row.label} — ${row.blurb}`} placement="right">
				<a
					class="wsp-rail__item"
					href={row.href}
					data-active={row.active ? "true" : undefined}
					aria-current={row.active ? "page" : undefined}
					aria-label={mark ? `${row.label} — ${mark}` : row.label}
				>
					{cloneGlyph(row.glyph)}
					{mark && <span class="wsp-rail__dot wsp-pulse" aria-hidden="true" />}
				</a>
			</Tooltip>
		);
	};
	const operations = views.sections.find((s) => s.id === "operations")?.rows ?? [];
	const catalogue = views.catalogue;
	const channels = views.channels;

	return (
		<>
			{operations.map(square)}
			{(catalogue || channels) && <span class="wsp-rail__group-sep" role="separator" />}
			{catalogue && square(catalogue.row)}
			{channels && (
				<Tooltip content={`${channels.label} — workspace-wide chat`} placement="right">
					<a
						class="wsp-rail__item"
						href={channels.base}
						data-active={channels.active ? "true" : undefined}
						aria-current={channels.active ? "page" : undefined}
						aria-label={channels.label}
					>
						{cloneGlyph(ChannelGlyph)}
					</a>
				</Tooltip>
			)}
		</>
	);
}

/** A console's Invite member and Settings, as the rail's circular glyphs. */
function RailUtilities(props: WorkspaceRailProps): JSX.Element | null {
	const footer = props.zones.footer;
	if (!("actAs" in footer)) return null;
	const invite = footer.invite;
	const target = props.inviteTarget ?? null;
	return (
		<>
			{invite && target && (
				<Tooltip content={invite.label} placement="right">
					{"href" in target
						? (
							<a class="wsp-rail__item" href={target.href} aria-label={invite.label}>
								{cloneGlyph(InviteGlyph)}
							</a>
						)
						: (
							<Button
								class="ui-hit"
								severity="neutral"
								variant="outlined"
								size="sm"
								rounded
								iconOnly
								icon={cloneGlyph(InviteGlyph)}
								aria-label={invite.label}
								aria-haspopup="dialog"
								onClick={target.onClick}
							/>
						)}
				</Tooltip>
			)}
			{footer.settings && (
				<Tooltip content={footer.settings.label} placement="right">
					<a
						class="wsp-rail__item"
						href={footer.settings.href}
						data-active={footer.settings.active ? "true" : undefined}
						aria-current={footer.settings.active ? "page" : undefined}
						aria-label={footer.settings.label}
					>
						{cloneGlyph(SettingsGlyph)}
					</a>
				</Tooltip>
			)}
		</>
	);
}

/**
 * The viewer's live entities as marks, so a collapsed roster lane is still a switcher — in the expanded
 * list's order (owned first), unfiltered by the folded-away partition and search.
 */
function RailEntities(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const entities = laneRailEntities(props.entities ?? []);
	const actingId = props.actingId ?? null;

	return (
		<>
			{entities.map((entity) => {
				const acting = isActingEntity(entity.id, actingId);
				const active = isWithinPath(props.path, workspaceHref(props.kind, entity.handle));
				return (
					<Tooltip key={entity.id} content={entity.name} placement="right">
						<a
							class="wsp-rail__item"
							href={workspaceHref(props.kind, entity.handle)}
							data-active={active ? "true" : undefined}
							aria-current={active ? "page" : undefined}
							aria-label={acting ? `${entity.name} — acting as this ${copy.noun}` : entity.name}
						>
							<EntityMark
								name={entity.name}
								handle={entity.handle}
								kind={props.kind}
								image={entity.avatar}
								size="sm"
							/>
							{entity.hasUpdate && <span class="wsp-rail__dot wsp-pulse" aria-hidden="true" />}
						</a>
					</Tooltip>
				);
			})}
		</>
	);
}
// #endregion
