import type { JSX, VNode } from "preact";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { kindCopy, workspaceHref, type WorkspaceKind } from "@projective/types/workspace";
import { type ModuleKey } from "../core/module-registry.tsx";
import {
	membersView,
	openCreate,
	openInvite,
	policyDirty,
	requestSave,
	rosterView,
	saveState,
} from "../core/workspace-state.ts";
import { CardsViewIcon, ChartViewIcon, TableViewIcon } from "../components/MemberCard.tsx";
import { cloneGlyph, InviteGlyph, PlusGlyph } from "../core/workspace-glyphs.tsx";

/**
 * WorkspaceFooterRig — the middle-nav frame's footer band across the workspace surface.
 *
 * The band's division of labour is strict and worth stating: **view switching on the leading side,
 * primary actions on the trailing side, and nothing in the body.** The body's remit is viewing and
 * selecting data — the moment a page grows its own "Save" button, there are two of them and the reader
 * has to work out which one is real.
 *
 * **It talks to the body through signals, never props.** The footer band is a separate hydration root
 * mounted into a shell slot; it cannot receive a callback from a page it does not contain. So
 * `membersView` / `rosterView` are written here and read there, and `requestSave()` is a pulse the
 * open policy editor answers. That indirection is the sanctioned channel (`workspace-state.ts`), not a
 * workaround.
 *
 * Every control is icon-first with a portal `Tooltip` and an `aria-label`; the words in each label sit
 * in a `<span>` so the mobile rule can drop them and keep the glyph (§B.6).
 */

export interface WorkspaceFooterRigProps {
	kind: WorkspaceKind;
	/** Present on a console route; absent on the roster index. */
	workspaceId?: string | null;
	/** The module being rendered — decides which actions are on offer. */
	module?: ModuleKey | null;
	/** Whether the viewer may invite (drives the Invite action's presence, not its disabled state). */
	canInvite?: boolean;
	/** Whether the viewer may edit money policy (drives Save's presence). */
	canManageMoney?: boolean;
	/** Whether the viewer may create another entity of this kind. */
	canCreate?: boolean;
}

/** One icon-only control in the rig. */
function RigButton(
	props: {
		label: string;
		glyph: VNode;
		onClick: () => void;
		active?: boolean;
		pressed?: boolean;
	},
): JSX.Element {
	return (
		<Tooltip content={props.label} placement="top">
			<button
				type="button"
				class="wsp-footerrig__action"
				data-active={props.active ? "true" : undefined}
				aria-label={props.label}
				aria-pressed={props.pressed}
				onClick={props.onClick}
			>
				<span class="wsp-footerrig__glyph" aria-hidden="true">{props.glyph}</span>
				<span class="wsp-footerrig__label">{props.label}</span>
			</button>
		</Tooltip>
	);
}

export default function WorkspaceFooterRig(props: WorkspaceFooterRigProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const onRoster = !props.workspaceId;
	const module = props.module ?? null;
	const dirty = policyDirty.value;
	const state = saveState.value;

	return (
		<div class="wsp-footerrig" data-kind={props.kind}>
			{/* #region Leading — view switching */}
			<div class="wsp-footerrig__group" role="group" aria-label="View">
				{onRoster && (
					<div class="wsp-footerrig__density">
						<RigButton
							label="Cards"
							glyph={<CardsViewIcon />}
							active={rosterView.value === "grid"}
							pressed={rosterView.value === "grid"}
							onClick={() => {
								rosterView.value = "grid";
							}}
						/>
						<RigButton
							label="Table"
							glyph={<TableViewIcon />}
							active={rosterView.value === "table"}
							pressed={rosterView.value === "table"}
							onClick={() => {
								rosterView.value = "table";
							}}
						/>
					</div>
				)}

				{module === "members" && (
					<div class="wsp-footerrig__density">
						<RigButton
							label="Cards"
							glyph={<CardsViewIcon />}
							active={membersView.value === "cards"}
							pressed={membersView.value === "cards"}
							onClick={() => {
								membersView.value = "cards";
							}}
						/>
						<RigButton
							label="Table"
							glyph={<TableViewIcon />}
							active={membersView.value === "table"}
							pressed={membersView.value === "table"}
							onClick={() => {
								membersView.value = "table";
							}}
						/>
						<RigButton
							label="Org chart"
							glyph={<ChartViewIcon />}
							active={membersView.value === "chart"}
							pressed={membersView.value === "chart"}
							onClick={() => {
								membersView.value = "chart";
							}}
						/>
					</div>
				)}
			</div>
			{/* #endregion */}

			<span class="wsp-footerrig__spacer" />

			{/* #region Trailing — primary actions */}
			<div class="wsp-footerrig__actions">
				{
					/*
					 * An unsaved policy says so BEFORE the button, because the nudge is the information and the
					 * button is only the response to it.
					 */
				}
				{dirty && (
					<span class="wsp-footerrig__nudge" role="status">
						<span class="wsp-footerrig__nudge-text">
							{state === "error" ? "Could not save" : "Unsaved changes"}
						</span>
					</span>
				)}

				{onRoster && props.canCreate !== false && (
					<RigButton
						label={`New ${copy.noun}`}
						glyph={cloneGlyph(PlusGlyph)}
						onClick={() => openCreate(props.kind)}
					/>
				)}

				{!onRoster && props.canInvite && (
					<RigButton
						label="Invite members"
						glyph={cloneGlyph(InviteGlyph)}
						onClick={() => openInvite()}
					/>
				)}

				{!onRoster && props.canManageMoney &&
					(module === "payouts" || module === "spend") && (
					<Tooltip
						content={dirty ? "Save the policy" : "Nothing to save yet"}
						placement="top"
					>
						<button
							type="button"
							class="wsp-footerrig__action"
							data-active={dirty ? "true" : undefined}
							aria-label="Save changes"
							disabled={!dirty || state === "saving"}
							onClick={requestSave}
						>
							<span class="wsp-footerrig__label">
								{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save changes"}
							</span>
						</button>
					</Tooltip>
				)}

				{!onRoster && props.workspaceId && (
					<a
						class="wsp-footerrig__action"
						href={workspaceHref(props.kind, props.workspaceId, "settings")}
					>
						<span class="wsp-footerrig__label">Settings</span>
					</a>
				)}
			</div>
			{/* #endregion */}
		</div>
	);
}
