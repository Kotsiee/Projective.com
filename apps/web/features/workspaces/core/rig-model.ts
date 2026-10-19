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
 * policies (Payouts, Spend, Billing), a team's Settings name and visibility (Teams C6) and the Roles
 * matrix's custom-role columns (Teams C3).
 *
 * On the roster index the rig's New is that tier-4 utility only while the lane is on the canvas, whose
 * `LaneCreateButton` is then the page's tier-2 create. Below `--bp-md` the frame takes the lane
 * off-canvas, and the lane's duty moves into the rig (Decision #245 (k)): New becomes the tier-2
 * structural create, or, where the plan admits none, the rig says the lane's reason. The collapsed
 * rail keeps the lane's create but has no room for its reason, so beside the rail the rig says that
 * too. The viewport and the splitter decide which, and no server read knows either, so
 * {@link rigLayouts} answers for every layout and the stylesheet paints the one that holds. The page
 * never shows two tier-2 creates.
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

/**
 * The module whose body is the custom-role editor (the `PermissionMatrix`'s custom-role columns,
 * `org.upsert_workspace_role`) answering the same Save and Discard — Roles (Teams C3), for a
 * `manage_roles` holder, on both kinds: a business's roles share the screen (Decision #61).
 */
export const ROLES_EDITOR_MODULE = "roles";

/**
 * Where the middle-nav lane is, beside the rig (Decision #245 (k)): `expanded`, the lane with its
 * footer's `LaneCreateButton` or its reason line; `rail`, the splitter collapsed to `WorkspaceRail`,
 * which keeps the create but says no reason; `off-canvas`, below `--bp-md`, where the frame hides the
 * lane (`middle-nav.css`) and the lane's create and reason go with it.
 */
export type RigLane = "expanded" | "rail" | "off-canvas";

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
	/**
	 * The roster's `createBlockedReason`: the plan's words for why `canCreate` is false. The rig says
	 * them only while the expanded lane, which otherwise says them, is not on the canvas.
	 */
	createBlockedReason?: string | null;
	/**
	 * The roster's first run (`roster-model.ts` `isFirstRun`): no entity of this kind and nothing to
	 * answer. The canvas's empty state then carries the page's one create, so the rig offers no New.
	 */
	firstRun?: boolean;
	/**
	 * Where the lane is beside the rig ({@link RigLane}); absent means `expanded`. Only the roster index
	 * reads it (Decision #245 (k)).
	 */
	lane?: RigLane;
	canInvite: boolean;
	canManageMoney: boolean;
	canManageSettings: boolean;
	/** Whether the viewer may edit the entity's identity (`edit_profile`) — a team's Settings' Save. */
	canEditProfile: boolean;
	/** Whether the viewer may edit custom roles (`manage_roles`) — the Roles matrix's Save. */
	canManageRoles?: boolean;
	/** Whether the open policy editor holds unsaved changes (`policyDirty`). */
	dirty: boolean;
	saveState: SaveState;
}

/**
 * One trailing control. The roster's New is a tier-4 utility beside the lane or its rail, and the
 * tier-2 structural create when the lane is off-canvas ({@link RigInput.lane}).
 */
export type RigAction =
	| { key: "create"; control: "button"; tier: 2 | 4; label: string }
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
 * New, absent in first run and when the plan admits none, or the plan's reason in its place while the
 * expanded lane is not on the canvas), `utilities` (Invite and Settings), `editor` (a policy editor at rest: its status line — empty,
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
	/**
	 * Why the roster offers no create: the lane's own line ({@link rosterCreateNote}), said by the rig
	 * only beside the collapsed rail or with the lane off-canvas, where the expanded lane that says it
	 * is not drawn, so the reason is on screen in one place in every layout. It is `null` beside the
	 * expanded lane, in first run (the canvas's empty state says it) and in every console.
	 */
	note: string | null;
	/** What the trailing side holds — the width its words need before the utilities fold. */
	holds: RigHolds;
}

/**
 * The rig in each layout the frame can take: `withLane` beside the expanded lane, `withRail` beside
 * the collapsed rail, `withoutLane` below `--bp-md` with the lane off-canvas. `withRail` holds
 * `withLane`'s controls (the rail keeps the lane's create) and adds only the reason the rail cannot
 * say. Both are `null` where the lane's state changes nothing the rig holds, which is every console.
 */
export interface RigLayouts {
	withLane: RigModel;
	withRail: RigModel | null;
	withoutLane: RigModel | null;
}
// #endregion

// #region Composition
/**
 * Whether a console module's screen mounts the invite modal, so an Invite there opens in place: the
 * Members screen (and its invitation queue), and a team's Projects, whose allowance band offers Invite
 * member to a team short of members (Teams C5). A business's Projects hands off and mounts none.
 * Everywhere else an Invite is a link that lands on Members with the modal open. The footer rig and the
 * lane's create action both ask this, so the controls on one page never disagree.
 */
export function inviteOpensInPlace(kind: WorkspaceKind, module: string | null): boolean {
	return module === "members" || module === "invitations" ||
		(kind === "team" && module === "projects");
}

/**
 * What the roster says in place of a create the plan refuses: the server's reason (it carries the
 * plan's number), or the kind's own words when the projection sent none. The lane's footer and the
 * rig both ask this, so the line reads the same wherever it is drawn.
 */
export function rosterCreateNote(kind: WorkspaceKind, reason: string | null | undefined): string {
	const text = reason?.trim();
	return text ? text : `Your plan does not include another ${kindCopy(kind).noun}.`;
}

/** The footer rig for what the viewer is looking at. Total: every input yields a model. */
export function rigModel(input: RigInput): RigModel {
	const copy = kindCopy(input.kind);

	if (!input.handle) {
		const lane = input.lane ?? "expanded";
		// In first run the canvas's tier-2 create is the page's one, and its empty state says the plan's
		// reason; a New or a note here would be a second.
		const offered = !input.firstRun;
		return {
			zoom: { label: `${copy.Plural} view zoom` },
			chart: null,
			statusLine: false,
			status: null,
			// Beside the lane or its rail, their LaneCreateButton is the region's tier-2 create, so New is
			// a utility. Without the lane, New is the create.
			actions: offered && input.canCreate
				? [{
					key: "create",
					control: "button",
					tier: lane === "off-canvas" ? 2 : 4,
					label: `New ${copy.noun}`,
				}]
				: [],
			// Only the expanded lane says the reason itself; the rail has no room for it.
			note: offered && !input.canCreate && lane !== "expanded"
				? rosterCreateNote(input.kind, input.createBlockedReason)
				: null,
			holds: "create",
		};
	}

	const people = input.module === "members" && isPeopleReading(input.view);
	const charted = people && input.view === MEMBERS_CHART;
	const editing = editorOpen(input);
	const pending = editing && input.dirty;
	const actions: RigAction[] = [];

	if (input.canInvite) {
		actions.push(
			inviteOpensInPlace(input.kind, input.module)
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
		note: null,
		holds: pending ? "commit" : editing ? "editor" : "utilities",
	};
}

/**
 * The rig for every layout of the page, for the island to draw them and the stylesheet to paint one.
 * Only the roster index differs between them. A console's lane holds Invite member, and moving that
 * onto the phone rig is not part of Decision #245 (k), so a console has one layout.
 */
export function rigLayouts(input: RigInput): RigLayouts {
	const roster = !input.handle;
	return {
		withLane: rigModel({ ...input, lane: "expanded" }),
		withRail: roster ? rigModel({ ...input, lane: "rail" }) : null,
		withoutLane: roster ? rigModel({ ...input, lane: "off-canvas" }) : null,
	};
}

/**
 * Whether the open module's body is an editor this viewer may save: a money-policy editor for the
 * money right, a team's Settings identity editor for `edit_profile`, the Roles matrix for
 * `manage_roles`. Only a team's Settings mounts the identity editor (`TeamSettingsScreen`); a
 * business's is still a placeholder, so its rig stays the utilities. Both kinds mount the Roles
 * matrix (`RolesMatrix`).
 */
export function editorOpen(
	input: Pick<RigInput, "kind" | "module" | "canManageMoney" | "canEditProfile" | "canManageRoles">,
): boolean {
	const module = input.module ?? "";
	return (input.canManageMoney && POLICY_MODULES.includes(module)) ||
		(input.kind === "team" && input.canEditProfile && module === PROFILE_EDITOR_MODULE) ||
		(input.canManageRoles === true && module === ROLES_EDITOR_MODULE);
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
