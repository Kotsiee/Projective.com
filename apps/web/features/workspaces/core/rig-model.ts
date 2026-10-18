import { kindCopy, workspaceHref, type WorkspaceKind } from "@projective/types/workspace";
import { type ButtonTier, isFilledTier } from "./header-model.ts";
import { isPeopleReading, MEMBERS_CHART, MEMBERS_PEOPLE } from "./sub-views.ts";

/**
 * rig-model — the workspace footer rig as a pure function of what the viewer is looking at (Teams
 * work order L2).
 *
 * The rig's division of labour: **view switching on the leading side, actions on the trailing side.**
 * The leading side is the shared zoom (the roster, and the Members People reading) with the Org chart
 * toggle riding beside it — and the toggle alone on the chart, which has no density to zoom. The
 * trailing side is the Button Interaction Matrix (§B.8.1) in one row:
 * tier-4 utilities (New, Invite, Settings), then the open editor's Discard (tier 5) and Save
 * (tier 3) — both present ONLY while the editor holds unsaved changes, so the rig never shows a
 * Save that has nothing to save, and Save is the rig's one filled control. The editors are the money
 * policies (Payouts, Spend, Billing) and a team's Settings name and visibility (Teams C6).
 *
 * A navigation is a link (the rig renders a ui `Link`), never a button that assigns `location`; an
 * action that opens something on this page is a button.
 *
 * Pure: no signals, no DOM, no registry import, so `deno test` loads it directly. Teams and
 * Businesses share it (Decision #61).
 */

// #region Vocabulary
/** The lifecycle of a policy save, as the rig reports it. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/** The modules whose body is a money-policy editor answering the rig's Save and Discard. */
export const POLICY_MODULES: readonly string[] = ["payouts", "spend", "billing"];

/**
 * The module whose body is the identity editor (name and visibility, `org.update_workspace`) answering
 * the same Save and Discard — a team's Settings (Teams C6), for an `edit_profile` holder.
 */
export const PROFILE_EDITOR_MODULE = "settings";

/** The rig's inputs. Capabilities are the server-resolved ones; the rig decides PRESENCE from them. */
export interface RigInput {
	kind: WorkspaceKind;
	/** The entity's `@handle` inside a console; `null` on the roster index. */
	handle: string | null;
	/** The module being rendered; `null` on the roster index. */
	module: string | null;
	/** The module's current sub-view (`sub-views.ts`), or `null`. */
	view: string | null;
	/** Whether the viewer may create another entity of this kind (the roster). */
	canCreate: boolean;
	canInvite: boolean;
	canManageMoney: boolean;
	canManageSettings: boolean;
	/** Whether the viewer may edit the entity's identity (`edit_profile`) — a team's Settings' Save. */
	canEditProfile: boolean;
	/** Whether the open policy editor holds unsaved changes (`policyDirty`). */
	dirty: boolean;
	saveState: SaveState;
}

/** One trailing control. */
export type RigAction =
	| { key: "create"; control: "button"; tier: 4; label: string }
	| { key: "invite"; control: "button"; tier: 4; label: string }
	| { key: "invite"; control: "link"; label: string; href: string }
	| { key: "settings"; control: "link"; label: string; href: string }
	| { key: "discard"; control: "button"; tier: 5; label: string; disabled: boolean }
	| { key: "save"; control: "button"; tier: 3; label: string; busy: boolean };

/** The save status line, said before the buttons it explains. */
export interface RigStatus {
	text: string;
	tone: "unsaved" | "saving" | "error" | "saved";
}

/**
 * What the trailing side holds, which is how much room its words need: `create` (the roster's one
 * New), `utilities` (Invite and Settings), `editor` (a policy editor at rest: its status line — empty,
 * or "Saved" — then the utilities) or `commit` (the editor with unsaved changes: the status line, the
 * utilities, Discard and Save). The stylesheet folds the utilities to their glyphs below each one's
 * own width, asked of the trailing side's own box, so a docked lane that leaves the rig narrow folds
 * them whatever the viewport.
 */
export type RigHolds = "create" | "utilities" | "editor" | "commit";

/** The rig. */
export interface RigModel {
	/**
	 * The shared zoom rig and its accessible name, or `null` where nothing is zoomable — the roster and
	 * the Members People reading. Never on the org chart: the chart ignores the table⇄cards axis, so a
	 * zoom there would be a control that does nothing (root CLAUDE.md §3.11).
	 */
	zoom: { label: string } | null;
	/**
	 * The Org chart toggle (tier 5), or `null`: beside the zoom on People, alone on the chart (where it
	 * is pressed, and a press returns to People). `next` is the view a press selects.
	 */
	chart: { label: string; pressed: boolean; next: string } | null;
	/**
	 * Whether the save status line is mounted — while a policy editor is open, even with nothing to say,
	 * so it is a live region before it first speaks and the place focus lands when the Save or Discard
	 * the reader pressed goes inert or leaves.
	 */
	statusLine: boolean;
	/** The policy editor's save status, or `null` when there is nothing to say. */
	status: RigStatus | null;
	/** The trailing controls, in order. */
	actions: RigAction[];
	/** What the trailing side holds — the width its words need before the utilities fold. */
	holds: RigHolds;
}
// #endregion

// #region Composition
/** The footer rig for what the viewer is looking at. Total: every input yields a model. */
export function rigModel(input: RigInput): RigModel {
	const copy = kindCopy(input.kind);

	if (!input.handle) {
		return {
			zoom: { label: `${copy.Plural} view zoom` },
			chart: null,
			statusLine: false,
			status: null,
			actions: input.canCreate
				? [{ key: "create", control: "button", tier: 4, label: `New ${copy.noun}` }]
				: [],
			holds: "create",
		};
	}

	const people = input.module === "members" && isPeopleReading(input.view);
	const charted = people && input.view === MEMBERS_CHART;
	const editing = editorOpen(input);
	const pending = editing && input.dirty;
	const actions: RigAction[] = [];

	if (input.canInvite) {
		// The invite modal is mounted by the Members screen, so there it opens in place; everywhere else
		// the action is a link that lands on Members with the modal open.
		actions.push(
			input.module === "members" || input.module === "invitations"
				? { key: "invite", control: "button", tier: 4, label: "Invite members" }
				: {
					key: "invite",
					control: "link",
					label: "Invite members",
					href: `${workspaceHref(input.kind, input.handle, "members")}?invite=1`,
				},
		);
	}
	if (input.canManageSettings && input.module !== "settings") {
		actions.push({
			key: "settings",
			control: "link",
			label: "Settings",
			href: workspaceHref(input.kind, input.handle, "settings"),
		});
	}
	if (pending) {
		const saving = input.saveState === "saving";
		// "Save", not "Save changes": the status line beside it already says "Unsaved changes", and the
		// shorter commit keeps the status whole in a 390px phone's rig.
		actions.push(
			{ key: "discard", control: "button", tier: 5, label: "Discard", disabled: saving },
			{ key: "save", control: "button", tier: 3, label: "Save", busy: saving },
		);
	}

	return {
		zoom: people && !charted ? { label: "People view zoom" } : null,
		chart: people
			? {
				label: "Org chart",
				pressed: charted,
				next: charted ? MEMBERS_PEOPLE : MEMBERS_CHART,
			}
			: null,
		statusLine: editing,
		status: editing ? saveStatus(input.dirty, input.saveState) : null,
		actions,
		holds: pending ? "commit" : editing ? "editor" : "utilities",
	};
}

/**
 * Whether the open module's body is an editor this viewer may save: a money-policy editor for the
 * money right, a team's Settings identity editor for `edit_profile`. Only a team's Settings mounts that
 * editor (`TeamSettingsScreen`); a business's is still a placeholder, so its rig stays the utilities.
 */
export function editorOpen(
	input: Pick<RigInput, "kind" | "module" | "canManageMoney" | "canEditProfile">,
): boolean {
	const module = input.module ?? "";
	return (input.canManageMoney && POLICY_MODULES.includes(module)) ||
		(input.kind === "team" && input.canEditProfile && module === PROFILE_EDITOR_MODULE);
}

/** What the policy editor's save state says, or `null` when there is nothing to say. */
export function saveStatus(dirty: boolean, state: SaveState): RigStatus | null {
	if (dirty) {
		if (state === "saving") return { text: "Saving…", tone: "saving" };
		if (state === "error") return { text: "Could not save", tone: "error" };
		return { text: "Unsaved changes", tone: "unsaved" };
	}
	return state === "saved" ? { text: "Saved", tone: "saved" } : null;
}

/** The tier of a trailing control; a link is navigation, not a button tier. */
function tierOf(action: RigAction): ButtonTier | null {
	return action.control === "button" ? action.tier : null;
}

/** How many filled controls the rig draws — never more than one (§B.8.1). */
export function rigFilledCount(model: RigModel): number {
	return model.actions.filter((a) => {
		const tier = tierOf(a);
		return tier !== null && isFilledTier(tier);
	}).length;
}
// #endregion
