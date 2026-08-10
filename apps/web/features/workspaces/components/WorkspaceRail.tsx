import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import {
	type KindCopy,
	kindCopy,
	type VerificationState,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import type { ModuleKey, WorkspaceModule } from "../core/module-registry.tsx";
import { cloneGlyph, PlusGlyph } from "../core/workspace-glyphs.tsx";
import { EntityMark } from "./EntityMark.tsx";
import { ContextSwitchControl, isActingEntity } from "./ContextSwitchControl.tsx";

/**
 * WorkspaceRail — the **collapsed** presentation of the workspace lane: one vertical column of
 * `--shell-nav-block` squares, mirroring the global sidebar's collapsed `.ui-nav-item` exactly so the
 * two rails read as one control at two scales.
 *
 * It is rendered **alongside** the expanded lane at all times and CSS reveals exactly one, keyed off
 * `.ui-splitter[data-mode="collapsed"]` (`workspace-chrome.css`). No client width observer: an
 * observer paints the wrong presentation for at least one frame on every load, and a nav that
 * flickers between two shapes reads as a broken shell. It also makes the toggle deterministic — the
 * expanded lane's footer button only ever collapses, this rail's button only ever expands, and each
 * is visible solely in its own state.
 *
 * Every control here is icon-only, so every control carries a portal {@link Tooltip} **and** an
 * `aria-label`, never a native `title` (§B.6). Module glyphs are shared with the expanded lane and the
 * header band, so each is {@link cloneGlyph}-copied at the point of use — a single VNode object cannot
 * be mounted in two positions of one tree.
 *
 * Two modes, one component, because the collapsed geometry and the tooltip discipline are identical:
 *
 *  - **Entity mode** ({@link WorkspaceRailProps.modules} supplied) — the console's module column, with
 *    the entity's mark pinned at the top and the acting switch + verification state at the bottom.
 *  - **Index mode** ({@link WorkspaceRailProps.entities} supplied) — the roster as a column of entity
 *    marks, so a collapsed lane is still a usable switcher between the viewer's teams.
 */

// #region Signals
/**
 * A per-module signal shown on its row. A **dot** means "this needs attention"; a **count** means
 * "this is a queue of known size" (§B.6 — never a sentence in the row; the words live in the
 * tooltip).
 *
 * Computed ONCE by the lane island and handed to both presentations, so the rail and the expanded nav
 * can never disagree about what needs attention.
 */
export interface ModuleSignal {
	dot?: boolean;
	count?: number;
}

/** Signals by module key. Absent keys render no marker at all. */
export type ModuleSignals = Partial<Record<ModuleKey, ModuleSignal>>;
// #endregion

// #region Props
export interface WorkspaceRailProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active square. */
	path: string;

	// --- Entity mode ---
	/** The entity's id, name, handle and mark. Present in entity mode. */
	entity?: {
		id: string;
		name: string;
		handle: string;
		avatar: string;
		verification: VerificationState;
		verificationPrompt: string | null;
		isActing: boolean;
	};
	/** The viewer's visible modules, in registry order. Present in entity mode. */
	modules?: readonly WorkspaceModule[];
	/** The module currently rendered. */
	activeModule?: ModuleKey | null;
	/** Per-module attention markers, shared with the expanded lane. */
	signals?: ModuleSignals;

	// --- Index mode ---
	/** The viewer's entities. Present in index mode. */
	entities?: readonly WorkspaceSummary[];
	/** The single acting entity id, already resolved. */
	actingId?: string | null;
	/** Whether the viewer may create another entity of this kind. */
	canCreate?: boolean;
	/** Open the create-entity modal. */
	onCreate?: () => void;

	/** Expand the lane back out (dispatched to the splitter by the lane island). */
	onExpand: () => void;
}
// #endregion

// #region Component
/** The collapsed workspace rail. See the module header for the dual-presentation contract. */
export function WorkspaceRail(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	return (
		<nav
			class="wsp-rail"
			data-kind={props.kind}
			aria-label={props.entity ? `${props.entity.name} navigation` : `${copy.Plural} navigation`}
		>
			{props.entity ? <EntityTop {...props} /> : <IndexTop {...props} />}

			<div class="wsp-rail__bottom">
				{props.entity && (
					<>
						<Tooltip
							content={props.entity.verificationPrompt ??
								verifyText(props.entity.verification, copy)}
							placement="right"
						>
							<span class="wsp-rail__verify">
								<span
									class="wsp-statedot"
									data-verify={props.entity.verification}
									role="img"
									aria-label={verifyText(props.entity.verification, copy)}
								/>
							</span>
						</Tooltip>
						<ContextSwitchControl
							kind={props.kind}
							id={props.entity.id}
							name={props.entity.name}
							handle={props.entity.handle}
							acting={props.entity.isActing}
							variant="icon"
						/>
					</>
				)}

				<Tooltip content="Expand lane" placement="right">
					<button
						type="button"
						class="wsp-rail__toggle"
						data-collapsed="true"
						aria-label="Expand lane"
						aria-pressed="true"
						onClick={props.onExpand}
					>
						<SidebarToggleIcon />
					</button>
				</Tooltip>
			</div>
		</nav>
	);
}
// #endregion

// #region Entity mode
/** The console's module column, with the entity's mark pinned above it. */
function EntityTop(props: WorkspaceRailProps): JSX.Element {
	const entity = props.entity;
	if (!entity) return <div class="wsp-rail__items" />;
	const modules = props.modules ?? [];
	const signals = props.signals ?? {};
	const home = workspaceHref(props.kind, entity.id);

	return (
		<>
			<div class="wsp-rail__brand">
				<Tooltip content={entity.name} placement="right">
					<a
						class="wsp-rail__switch"
						href={home}
						data-verify={entity.verification}
						data-acting={entity.isActing ? "true" : undefined}
						aria-label={`${entity.name} overview`}
					>
						<EntityMark
							name={entity.name}
							handle={entity.handle}
							kind={props.kind}
							image={entity.avatar}
							size="md"
						/>
					</a>
				</Tooltip>
			</div>

			{
				/*
				 * `flatMap` rather than a fragment per iteration: a group separator is a SIBLING of the rows,
				 * not a wrapper around one, and wrapping each row in a keyed fragment would nest the rail's
				 * flex column one level deeper than its `gap` and `overflow` rules expect.
				 */
			}
			<div class="wsp-rail__items">
				{modules.flatMap((module, i) => {
					const signal = signals[module.key];
					const active = module.key === props.activeModule;
					const rows: JSX.Element[] = [];

					if (i > 0 && modules[i - 1].group !== module.group) {
						rows.push(
							<span class="wsp-rail__group-sep" role="separator" key={`sep-${module.key}`} />,
						);
					}

					// The blurb is the rail tooltip's second half: with the label hidden, "what is this for"
					// is exactly what a bare glyph cannot say.
					rows.push(
						<Tooltip
							key={module.key}
							content={`${module.label} — ${module.blurb}`}
							placement="right"
						>
							<a
								class="wsp-rail__item"
								href={workspaceHref(props.kind, entity.id, module.key)}
								data-active={active ? "true" : undefined}
								aria-current={active ? "page" : undefined}
								aria-label={module.label}
							>
								{cloneGlyph(module.glyph)}
								{(signal?.dot || (signal?.count ?? 0) > 0) && (
									<span class="wsp-rail__dot wsp-pulse" aria-hidden="true" />
								)}
							</a>
						</Tooltip>,
					);

					return rows;
				})}
			</div>
		</>
	);
}
// #endregion

// #region Index mode
/** The roster as a column of entity marks, so a collapsed lane is still a switcher. */
function IndexTop(props: WorkspaceRailProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const entities = (props.entities ?? []).filter((e) => e.status !== "archived");
	const actingId = props.actingId ?? null;

	return (
		<>
			{props.onCreate && (
				<div class="wsp-rail__brand">
					<Tooltip
						content={props.canCreate === false ? `${copy.Noun} limit reached` : `New ${copy.noun}`}
						placement="right"
					>
						<button
							type="button"
							class="wsp-rail__item"
							aria-label={`New ${copy.noun}`}
							aria-disabled={props.canCreate === false ? "true" : undefined}
							onClick={props.onCreate}
						>
							{cloneGlyph(PlusGlyph)}
						</button>
					</Tooltip>
				</div>
			)}

			<div class="wsp-rail__items" role="list">
				{entities.map((entity) => {
					const acting = isActingEntity(entity.id, actingId);
					const active = props.path.startsWith(workspaceHref(props.kind, entity.id));
					return (
						<Tooltip key={entity.id} content={entity.name} placement="right">
							<a
								class="wsp-rail__item"
								href={workspaceHref(props.kind, entity.id)}
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
			</div>
		</>
	);
}
// #endregion

// #region Helpers
/**
 * The verification state's WORDS. Every state carries its own text as well as its tone, so the
 * meaning survives a colour-blind palette and greyscale — a ring colour alone is not a channel.
 */
function verifyText(state: VerificationState, copy: KindCopy): string {
	if (state === "verified") return `${copy.verification} verified`;
	if (state === "pending") return `${copy.verification} in review`;
	return `${copy.verification} not started`;
}
// #endregion
