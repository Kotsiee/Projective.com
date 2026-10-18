import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
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
	rosterFirstRun,
	saveState,
	selectModuleView,
	viewOr,
} from "../core/workspace-state.ts";
import { workspaceZoom } from "../core/view-state.ts";
import { type RigAction, type RigModel, rigModel } from "../core/rig-model.ts";
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
 *   - Leading — the shared zoom (`ViewZoomRig`) on the roster and the Members People reading, and the
 *     Org chart toggle (tier 5, `aria-pressed`) beside it, which selects the `chart` sub-view — the
 *     same state the header band's tabs and the lane's context control write. On the chart the toggle
 *     stands alone: the chart has no density, so a zoom there would do nothing.
 *   - Trailing — tier-4 utilities (New — not in the roster's first run, whose empty state carries the
 *     one create — and Invite), Settings as a ui `Link` (a navigation is a link,
 *     never a button-styled anchor), then the policy editor's Discard (tier 5) and Save (tier 3, the
 *     rig's one filled control) — both ONLY while the editor holds unsaved changes. The status line
 *     says why before the buttons do.
 *
 * **It talks to the body through signals, never props.** The rig is a separate hydration root mounted
 * into a shell slot; it cannot receive a callback from a page it does not contain. `requestSave()` /
 * `requestDiscard()` are pulses the open policy editor answers (`usePolicyBridge`), and `policyDirty` /
 * `saveState` come back the same way (`workspace-state.ts`).
 *
 * **Focus is never dropped.** Save goes inert while it saves and leaves with Discard once the editor is
 * clean, so a press that held focus would leave it on `<body>`; it lands on the status line, which
 * says what the press did, or on the last trailing control that stays.
 *
 * Where their words do not fit, each utility and the toggle swap to their icon-only `Button` (named by
 * `aria-label` and a Tooltip) — two presentations, the stylesheet deciding which paints, so no rule
 * reaches inside a shared control. The rig's OWN width decides (container queries: the trailing side
 * by what `rig.holds` says it carries, the toggle by the rig beside a zoom), so a docked lane that
 * leaves the rig narrow folds them at any viewport; below `--bp-md` they fold regardless. Save and
 * Discard keep their words and never shrink, because a commit is never a guess: the status line is
 * what yields.
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
	/** Whether the viewer may edit the entity's name and visibility (drives Settings' Save). */
	canEditProfile?: boolean;
	/** Whether the viewer may create another entity of this kind. */
	canCreate?: boolean;
	/**
	 * The roster's first run over the server's read (`isFirstRun`) — the rig then offers no New, since
	 * the canvas's empty state carries the page's one create. Once the canvas publishes its own reading
	 * (`rosterFirstRun` — a retried read or an answered invitation can change it), that wins.
	 */
	firstRun?: boolean;
}

export default function WorkspaceFooterRig(props: WorkspaceFooterRigProps): JSX.Element {
	// #region The model
	const module = props.module ?? null;
	const views = subViewsFor(module, props.kind, props.capabilities ?? []);
	const rig = rigModel({
		kind: props.kind,
		handle: props.workspaceHandle ?? null,
		module,
		view: viewOr(props.view ?? null),
		canCreate: props.canCreate !== false,
		firstRun: rosterFirstRun.value ?? props.firstRun ?? false,
		canInvite: props.canInvite ?? false,
		canManageMoney: props.canManageMoney ?? false,
		canManageSettings: props.canManageSettings ?? false,
		canEditProfile: props.canEditProfile ?? false,
		dirty: policyDirty.value,
		saveState: saveState.value,
	});
	const chart = rig.chart;
	// #endregion

	// #region Focus continuity
	const rigRef = useRef<HTMLDivElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const statusRef = useRef<HTMLSpanElement>(null);
	/**
	 * Set when Save or Discard is pressed while it holds focus: that control is about to go inert or
	 * leave, and the focus it holds has to land somewhere that stays.
	 */
	const carry = useRef(false);

	useSignalEffect(() => {
		// Every change that can disable or remove the pressed control re-runs this.
		void policyDirty.value;
		void saveState.value;
		if (!carry.current) return;
		// After the rig has re-rendered for the change, not before.
		const timer = setTimeout(() => {
			const active = globalThis.document.activeElement;
			const lost = !active || active === globalThis.document.body ||
				(active instanceof HTMLButtonElement && active.disabled);
			if (lost) {
				landFocus(actionsRef.current, statusRef.current);
			} else if (!rigRef.current?.contains(active)) {
				carry.current = false;
				return;
			}
			if (!policyDirty.peek()) carry.current = false;
		}, 0);
		return () => clearTimeout(timer);
	});

	/** Press Save or Discard, remembering whether focus rode on it. */
	function pressPending(event: Event, request: () => void): void {
		carry.current = event.currentTarget === globalThis.document.activeElement;
		request();
	}
	// #endregion

	return (
		<div ref={rigRef} class="wsp-footerrig" data-kind={props.kind}>
			{/* #region Leading — view switching */}
			<div class="wsp-footerrig__group" role="group" aria-label="View">
				{
					/*
					 * The persistent zoom rig, the same control the File Explorer, Submissions, Catalogue and
					 * Wallet carry: crossing its centre marker IS the table⇄cards switch. The org chart sits
					 * BESIDE it rather than on it, because a chart is a different reading of the people, not
					 * a different density — and it keeps its place whether the zoom is drawn or not, so a
					 * press that hides the zoom never drops the toggle from under the reader's focus.
					 */
				}
				{rig.zoom && (
					<ViewZoomRig
						store={workspaceZoom}
						label={rig.zoom.label}
						class="wsp-footerrig__density"
						listIcon={<TableViewIcon />}
						gridIcon={<CardsViewIcon />}
					/>
				)}
				{chart && (
					<ChartToggle
						chart={chart}
						onToggle={() => selectModuleView(chart.next, views)}
					/>
				)}
			</div>
			{/* #endregion */}

			{/* #region Trailing — actions */}
			<div ref={actionsRef} class="wsp-footerrig__actions" data-holds={rig.holds}>
				{rig.statusLine && (
					<span
						ref={statusRef}
						class="wsp-footerrig__status"
						data-tone={rig.status?.tone}
						role="status"
						tabIndex={-1}
					>
						{rig.status?.text}
					</span>
				)}
				{rig.actions.map((action) => (
					<RigControl
						key={action.key}
						action={action}
						onCreate={() => openCreate(props.kind)}
						onSave={(event) => pressPending(event, requestSave)}
						onDiscard={(event) => pressPending(event, requestDiscard)}
					/>
				))}
			</div>
			{/* #endregion */}
		</div>
	);
}

// #region Focus landing
/**
 * Put focus somewhere that stays, once the control holding it went inert or left: the status line
 * while it has something to say (Saving…, Saved, Could not save), else the last trailing control
 * still drawn, else the status line itself — it is mounted for as long as the editor is open.
 */
function landFocus(actions: HTMLElement | null, status: HTMLElement | null): void {
	if (status?.textContent?.trim()) {
		status.focus({ preventScroll: true });
		return;
	}
	const controls = actions
		? [...actions.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")]
			.filter((el) => el.getClientRects().length > 0)
		: [];
	(controls.at(-1) ?? status)?.focus({ preventScroll: true });
}
// #endregion

// #region Controls
/** One trailing control, at its tier. */
function RigControl(
	props: {
		action: RigAction;
		onCreate: () => void;
		onSave: (event: Event) => void;
		onDiscard: (event: Event) => void;
	},
): JSX.Element {
	const { action } = props;
	switch (action.key) {
		case "create":
			return <Utility label={action.label} glyph={PlusGlyph} onClick={props.onCreate} />;
		case "invite":
			return action.control === "button"
				? <Utility label={action.label} glyph={InviteGlyph} onClick={() => openInvite()} />
				: <RigLink label={action.label} href={action.href} glyph={cloneGlyph(InviteGlyph)} />;
		case "settings":
			return <RigLink label={action.label} href={action.href} glyph={cloneGlyph(SettingsGlyph)} />;
		case "discard":
			return (
				<Button
					class="wsp-footerrig__commit"
					variant="text"
					severity="secondary"
					size="sm"
					label={action.label}
					disabled={action.disabled}
					onClick={props.onDiscard}
				/>
			);
		case "save":
			return (
				<Button
					class="wsp-footerrig__commit"
					size="sm"
					label={action.label}
					loading={action.busy}
					onClick={props.onSave}
				/>
			);
	}
}

/**
 * A tier-4 utility — neutral outlined, in two presentations: its words, or where they do not fit its
 * glyph alone under a Tooltip. The wrapper has no gap, so the one not drawn leaves no space behind.
 */
function Utility(
	props: { label: string; glyph: VNode; onClick: () => void },
): JSX.Element {
	return (
		<span class="wsp-footerrig__utility">
			<Button
				class="wsp-footerrig__wide"
				severity="neutral"
				variant="outlined"
				size="sm"
				icon={cloneGlyph(props.glyph)}
				label={props.label}
				onClick={props.onClick}
			/>
			<Tooltip content={props.label} placement="top">
				<Button
					class="wsp-footerrig__narrow"
					severity="neutral"
					variant="outlined"
					size="sm"
					iconOnly
					icon={cloneGlyph(props.glyph)}
					aria-label={props.label}
					onClick={props.onClick}
				/>
			</Tooltip>
		</span>
	);
}

/**
 * The Org chart toggle — a tier-5 text Button whose engaged state is the Button's own
 * (`aria-pressed`), in the same two presentations as a utility.
 */
function ChartToggle(
	props: { chart: NonNullable<RigModel["chart"]>; onToggle: () => void },
): JSX.Element {
	const { chart } = props;
	return (
		<span class="wsp-footerrig__utility">
			<Button
				class="wsp-footerrig__wide"
				variant="text"
				severity="secondary"
				size="sm"
				icon={<ChartViewIcon />}
				label={chart.label}
				aria-pressed={chart.pressed}
				onClick={props.onToggle}
			/>
			<Tooltip content={chart.label} placement="top">
				<Button
					class="wsp-footerrig__narrow"
					variant="text"
					severity="secondary"
					size="sm"
					iconOnly
					icon={<ChartViewIcon />}
					aria-label={chart.label}
					aria-pressed={chart.pressed}
					onClick={props.onToggle}
				/>
			</Tooltip>
		</span>
	);
}

/** A navigation — a ui `Link`, its words folding to the glyph where they do not fit. */
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
// #endregion
