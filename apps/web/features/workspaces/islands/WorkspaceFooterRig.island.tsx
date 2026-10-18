import type { JSX, VNode } from "preact";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Link } from "@projective/ui/navigation";
import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";
import { type ModuleKey } from "../core/module-registry.tsx";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import {
	openCreate,
	openInvite,
	policyDirty,
	requestDiscard,
	requestSave,
	saveState,
	selectModuleView,
	viewOr,
} from "../core/workspace-state.ts";
import { workspaceZoom } from "../core/view-state.ts";
import { type RigAction, rigModel } from "../core/rig-model.ts";
import { subViewsFor } from "../core/sub-views.ts";
import { CardsViewIcon, ChartViewIcon, TableViewIcon } from "../components/MemberCard.tsx";
import { cloneGlyph, InviteGlyph, PlusGlyph, SettingsGlyph } from "../core/workspace-glyphs.tsx";

/**
 * WorkspaceFooterRig — the middle-nav frame's footer band across the workspace surface.
 *
 * The band's division of labour: **view switching on the leading side, actions on the trailing side,
 * and nothing in the body.** The body's remit is viewing and selecting data — the moment a page grows
 * its own Save, there are two of them and the reader has to work out which one is real.
 *
 * Every control is a `@projective/ui` control at its Interaction Matrix tier (§B.8.1), from
 * `rig-model.ts`, which decides what the rig holds and is pinned by its unit test:
 *
 *   - Leading — the shared zoom (`ViewZoomRig`) on the roster and the Members people readings, with
 *     the Org chart toggle beside it (tier 5, `aria-pressed`), which selects the `chart` sub-view —
 *     the same state the header band's tabs and the lane's context control write.
 *   - Trailing — tier-4 utilities (New, Invite), Settings as a ui `Link` (a navigation is a link,
 *     never a button-styled anchor), then the policy editor's Discard (tier 5) and Save (tier 3, the
 *     rig's one filled control) — both ONLY while the editor holds unsaved changes. The status line
 *     says why before the buttons do.
 *
 * **It talks to the body through signals, never props.** The rig is a separate hydration root mounted
 * into a shell slot; it cannot receive a callback from a page it does not contain. `requestSave()` /
 * `requestDiscard()` are pulses the open policy editor answers (`usePolicyBridge`), and `policyDirty` /
 * `saveState` come back the same way (`workspace-state.ts`).
 *
 * Below `--bp-md` the utilities fold to their glyphs (named by `aria-label` and a Tooltip); Save and
 * Discard keep their words, because a commit is never a guess.
 */

export interface WorkspaceFooterRigProps {
	kind: WorkspaceKind;
	/** The entity's `@handle` — present on a console route; absent on the roster index. */
	workspaceHandle?: string | null;
	/** The module being rendered — decides which actions are on offer. */
	module?: ModuleKey | null;
	/** The module's sub-view, resolved server-side (`resolveSubView`). */
	view?: string | null;
	/** The viewer's server-resolved capabilities — the sub-views they are offered. */
	capabilities?: readonly WorkspaceCapability[];
	/** Whether the viewer may invite (drives the Invite action's presence, not its disabled state). */
	canInvite?: boolean;
	/** Whether the viewer may edit money policy (drives Save's presence). */
	canManageMoney?: boolean;
	/** Whether the viewer may open the Settings module (drives the Settings link's presence). */
	canManageSettings?: boolean;
	/** Whether the viewer may create another entity of this kind. */
	canCreate?: boolean;
}

export default function WorkspaceFooterRig(props: WorkspaceFooterRigProps): JSX.Element {
	const module = props.module ?? null;
	const views = subViewsFor(module, props.kind, props.capabilities ?? []);
	const rig = rigModel({
		kind: props.kind,
		handle: props.workspaceHandle ?? null,
		module,
		view: viewOr(props.view ?? null),
		canCreate: props.canCreate !== false,
		canInvite: props.canInvite ?? false,
		canManageMoney: props.canManageMoney ?? false,
		canManageSettings: props.canManageSettings ?? false,
		dirty: policyDirty.value,
		saveState: saveState.value,
	});
	const chart = rig.chart;

	return (
		<div class="wsp-footerrig" data-kind={props.kind}>
			{/* #region Leading — view switching */}
			<div class="wsp-footerrig__group" role="group" aria-label="View">
				{
					/*
					 * The persistent zoom rig, the same control the File Explorer, Submissions, Catalogue and
					 * Wallet carry: crossing its centre marker IS the table⇄cards switch. The org chart sits
					 * BESIDE it rather than on it, because a chart is a different reading of the people, not
					 * a different density.
					 */
				}
				{rig.zoom && (
					<ViewZoomRig
						store={workspaceZoom}
						label={rig.zoom.label}
						class="wsp-footerrig__density"
						listIcon={<TableViewIcon />}
						gridIcon={<CardsViewIcon />}
					>
						{chart
							? (
								<Tooltip content={chart.label} placement="top">
									<Button
										class="wsp-footerrig__toggle wsp-footerrig__fold"
										variant="text"
										severity="secondary"
										size="sm"
										icon={<ChartViewIcon />}
										label={chart.label}
										aria-label={chart.label}
										aria-pressed={chart.pressed}
										onClick={() => selectModuleView(chart.next, views)}
									/>
								</Tooltip>
							)
							: null}
					</ViewZoomRig>
				)}
			</div>
			{/* #endregion */}

			<span class="wsp-footerrig__spacer" />

			{/* #region Trailing — actions */}
			<div class="wsp-footerrig__actions">
				{rig.status && (
					<span class="wsp-footerrig__status" data-tone={rig.status.tone} role="status">
						{rig.status.text}
					</span>
				)}
				{rig.actions.map((action) => (
					<RigControl
						key={action.key}
						action={action}
						onCreate={() => openCreate(props.kind)}
					/>
				))}
			</div>
			{/* #endregion */}
		</div>
	);
}

/** One trailing control, at its tier. */
function RigControl(
	props: { action: RigAction; onCreate: () => void },
): JSX.Element {
	const { action } = props;
	switch (action.key) {
		case "create":
			return (
				<Utility
					label={action.label}
					glyph={cloneGlyph(PlusGlyph)}
					onClick={props.onCreate}
				/>
			);
		case "invite":
			return action.control === "button"
				? (
					<Utility
						label={action.label}
						glyph={cloneGlyph(InviteGlyph)}
						onClick={() => openInvite()}
					/>
				)
				: <RigLink label={action.label} href={action.href} glyph={cloneGlyph(InviteGlyph)} />;
		case "settings":
			return <RigLink label={action.label} href={action.href} glyph={cloneGlyph(SettingsGlyph)} />;
		case "discard":
			return (
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					label={action.label}
					disabled={action.disabled}
					onClick={requestDiscard}
				/>
			);
		case "save":
			return <Button size="sm" label={action.label} loading={action.busy} onClick={requestSave} />;
	}
}

/** A tier-4 utility — neutral outlined, its words folding to the glyph below `--bp-md`. */
function Utility(
	props: { label: string; glyph: VNode; onClick: () => void },
): JSX.Element {
	return (
		<Tooltip content={props.label} placement="top">
			<Button
				class="wsp-footerrig__fold"
				severity="neutral"
				variant="outlined"
				size="sm"
				icon={props.glyph}
				label={props.label}
				aria-label={props.label}
				onClick={props.onClick}
			/>
		</Tooltip>
	);
}

/** A navigation — a ui `Link`, its words folding to the glyph below `--bp-md`. */
function RigLink(props: { label: string; href: string; glyph: VNode }): JSX.Element {
	return (
		<Tooltip content={props.label} placement="top">
			<Link class="wsp-footerrig__link" href={props.href} aria-label={props.label}>
				<span class="wsp-footerrig__glyph" aria-hidden="true">{props.glyph}</span>
				<span class="wsp-footerrig__label">{props.label}</span>
			</Link>
		</Tooltip>
	);
}
