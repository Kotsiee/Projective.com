import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { LaneCollapseButton, LaneCreateButton } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import {
	kindCopy,
	type VerificationState,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import type { WorkspaceModule } from "../core/module-registry.tsx";
import {
	type LaneZones,
	type ModuleSignals,
	signalLabel,
	verificationWords,
} from "../core/lane-model.ts";
import { isWithinPath } from "../core/workspace-model.ts";
import { cloneGlyph, InviteGlyph, PlusGlyph } from "../core/workspace-glyphs.tsx";
import { EntityMark } from "./EntityMark.tsx";
import { ContextSwitchControl, isActingEntity } from "./ContextSwitchControl.tsx";

/**
 * WorkspaceRail — the **collapsed** presentation of the workspace lane: the same four zones the
 * expanded lane draws (`lane-model.ts`), folded to one column of glyphs.
 *
 *   1. **Header strip** → the entity's mark (its ring is the verification state) and the acting switch
 *      as an icon-only Button. The roster index has no identity to fold, so its rail starts at zone 2.
 *   2. **Primary views** → the primary modules' glyphs, a hairline, then every "More" module's glyph —
 *      or, on the roster index, the viewer's entities as marks, so a collapsed lane is still a
 *      switcher.
 *   3. **Context controls** → none: a segmented control has no glyph form, and the expanded lane is one
 *      press away.
 *   4. **Footer rig** → the same `LaneCreateButton` (its label folds away in a collapsed splitter, its
 *      `aria-label` stays) and the expand toggle.
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
 */

// #region Props
export interface WorkspaceRailProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active entity square on the roster index. */
	path: string;
	/** The lane's composition; the rail folds the same zones. */
	zones: LaneZones;

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

	/** Run zone 4's create action — the same handler the expanded lane's button calls. */
	onCreate: () => void;
	/** Expand the lane back out (dispatched to the splitter by the lane island). */
	onExpand: () => void;
}
// #endregion

// #region Component
/** The collapsed workspace rail. See the module header for the zone folding. */
export function WorkspaceRail(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const create = props.zones.footer.create;

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
				{create && (
					<Tooltip content={create.label} placement="right">
						<LaneCreateButton
							label={create.label}
							icon={cloneGlyph(create.action === "invite" ? InviteGlyph : PlusGlyph)}
							onClick={props.onCreate}
						/>
					</Tooltip>
				)}
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
/** The primary modules, a hairline, then the "More" modules — the expanded zone 2 in glyphs. */
function RailModules(props: WorkspaceRailProps): JSX.Element | null {
	const views = props.zones.views;
	const entity = props.entity;
	if (views.mode !== "console" || !entity) return null;
	const signals = props.signals ?? {};

	const square = (module: WorkspaceModule) => {
		const active = module.key === views.active;
		const mark = signalLabel(signals[module.key]);
		// The blurb is the tooltip's second half: with the label hidden, "what is this for" is exactly
		// what a bare glyph cannot say.
		return (
			<Tooltip key={module.key} content={`${module.label} — ${module.blurb}`} placement="right">
				<a
					class="wsp-rail__item"
					href={workspaceHref(props.kind, entity.handle, module.key)}
					data-active={active ? "true" : undefined}
					aria-current={active ? "page" : undefined}
					aria-label={mark ? `${module.label} — ${mark}` : module.label}
				>
					{cloneGlyph(module.glyph)}
					{mark && <span class="wsp-rail__dot wsp-pulse" aria-hidden="true" />}
				</a>
			</Tooltip>
		);
	};

	return (
		<>
			{views.primary.map(square)}
			{views.more.length > 0 && <span class="wsp-rail__group-sep" role="separator" />}
			{views.more.map(square)}
		</>
	);
}

/** The viewer's live entities as marks, so a collapsed roster lane is still a switcher. */
function RailEntities(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const entities = (props.entities ?? []).filter((e) => e.status !== "archived");
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
