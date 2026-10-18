import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import { TEAM_PROPOSAL_MIN_MEMBERS } from "@projective/types/finance";
import {
	type ArchiveBlocker,
	type ArchiveBlockerCode,
	kindCopy,
	type RestoreTarget,
	walletHrefFor,
	WORKSPACE_NAME_MAX,
	WORKSPACE_NAME_MIN,
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceStatus,
	type WorkspaceVisibility,
} from "@projective/types/workspace";
import type { FilledTier } from "./header-model.ts";

/**
 * settings-model — the Settings module as a pure function of the entity and the viewer (Teams work
 * order C6): three sections — Identity, Visibility, Lifecycle — and which control each one offers for
 * a (status, capabilities, archive blockers) triple.
 *
 * The rules it holds, each pinned by `settings-model.test.ts`:
 *
 *   - **Identity and Visibility** are editable by an `edit_profile` holder (`org.update_workspace`'s
 *     right) and save through the footer rig's tier-3 Save; the `@handle` is read-only — handles are
 *     immutable.
 *   - **Lifecycle** shows the status as a `Tag` and offers ONE control: while `draft`, Publish is the
 *     header band's filled commit (tier 3, `manage_settings`) and this section says what publishing
 *     does; an `archive_entity` holder on a draft or active entity gets "Archive …" (danger, outlined,
 *     confirmed) — or, while the server lists anything that would refuse it (a held escrow, live work),
 *     the blockers instead, each with the link that leads to clearing it, never a button that would
 *     fail; an archived entity offers its holder Restore (tier 3), named for where the server says it
 *     lands (`restoreTarget`, Decision #250 (c)).
 *
 * Teams and Businesses share it (Decision #61): every sentence takes the kind's noun, and a
 * business's blocker codes are worded too, so the same screen can serve a business's Settings.
 * Pure: no signals, no DOM, no stylesheet, so `deno test` loads it.
 */

// #region Vocabulary
/** What the Settings screen renders from — every field straight off `WorkspaceDetail`. */
export interface SettingsInput {
	kind: WorkspaceKind;
	/** The entity's id — the wallet link addresses it. */
	id: string;
	name: string;
	handle: string;
	status: WorkspaceStatus;
	visibility: WorkspaceVisibility;
	/** The viewer's server-resolved effective capabilities. */
	capabilities: readonly WorkspaceCapability[];
	/** What would refuse an archive now (`WorkspaceDetail.archiveBlockers`). */
	archiveBlockers: readonly ArchiveBlocker[];
	/** Where a restore lands while archived (`WorkspaceDetail.restoreTarget`). */
	restoreTarget: RestoreTarget | null;
	/** Active members — a team applies only from {@link TEAM_PROPOSAL_MIN_MEMBERS}. */
	memberCount: number;
}

/** One blocker, worded, with the place it is cleared. */
export interface BlockerLine {
	code: ArchiveBlockerCode;
	/** The sentence the InlineNotice states. */
	text: string;
	/** Where it is cleared: a console module, or the entity's wallet. */
	link: { label: string; href: string };
}

/** The confirm an archive asks before anything changes. */
export interface ArchiveConfirm {
	header: string;
	message: string;
	accept: string;
	reject: string;
}

/** The Lifecycle section's one control. */
export type LifecycleControl =
	| {
		kind: "archive";
		/** "Archive team…" — a danger outlined Button that opens {@link confirm}. */
		label: string;
		/** What archiving does, said beside the button before it is pressed. */
		facts: MetaLineEntry[];
		confirm: ArchiveConfirm;
	}
	| {
		kind: "blocked";
		/** Each blocker in the server's order — they replace the archive control. */
		blockers: BlockerLine[];
	}
	| {
		kind: "restore";
		/** "Restore as active" / "Restore as a draft" — tier 3. */
		label: string;
		tier: FilledTier;
		/** Where it lands, or `null` when the read did not say (the server still decides). */
		target: RestoreTarget | null;
	}
	| {
		kind: "none";
		/** Why there is nothing to press, or `null` when nothing needs saying. */
		note: string | null;
	};

/** The lifecycle status as a `Tag`'s words and tone. */
export interface StatusTag {
	label: string;
	severity: "warning" | "success" | "secondary";
}

/** One option of the visibility SelectButton. */
export interface VisibilityOption {
	value: WorkspaceVisibility;
	label: string;
}

/** The Settings screen. */
export interface SettingsModel {
	identity: {
		/** Whether the name field takes input (`edit_profile`). */
		editable: boolean;
		/** `@handle`. */
		handleText: string;
		/** Why it cannot be changed. */
		handleNote: string;
	};
	visibility: {
		editable: boolean;
		options: VisibilityOption[];
		/** What the current choice means, as a sentence. */
		hint: string;
		/** Why nobody outside sees it yet whatever the choice says, while not active; else `null`. */
		statusNote: string | null;
	};
	lifecycle: {
		tag: StatusTag;
		/** What the status means — for a draft, what publishing would do. */
		facts: MetaLineEntry[];
		control: LifecycleControl;
	};
	/**
	 * The header band's ONE filled action: Publish while `draft`, for a `manage_settings` holder
	 * (`org.set_workspace_status`'s right) — supplied through `useModuleCommit`; `null` otherwise.
	 */
	commit: { key: "publish"; label: string; tier: FilledTier } | null;
}
// #endregion

// #region Identity
/** What the handle row says beside `@handle`. */
export const HANDLE_NOTE = "Handles can't change";

/** The name the field holds, judged as `org.update_workspace` judges it — `null` when it passes. */
export function nameError(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed.length < WORKSPACE_NAME_MIN) {
		return `Give it a name of at least ${WORKSPACE_NAME_MIN} characters.`;
	}
	if (trimmed.length > WORKSPACE_NAME_MAX) {
		return `Keep the name to ${WORKSPACE_NAME_MAX} characters.`;
	}
	return null;
}

/** The saved identity, and the one being edited. */
export interface IdentityDraft {
	name: string;
	visibility: WorkspaceVisibility;
}

/**
 * The patch a save sends: only the keys that moved (`UpdateWorkspaceInput` is a patch; a key present
 * is a change), the name trimmed. Empty when nothing moved.
 */
export function identityPatch(
	saved: IdentityDraft,
	draft: IdentityDraft,
): Partial<IdentityDraft> {
	const patch: Partial<IdentityDraft> = {};
	const name = draft.name.trim();
	if (name !== saved.name) patch.name = name;
	if (draft.visibility !== saved.visibility) patch.visibility = draft.visibility;
	return patch;
}

/** Whether the editor holds unsaved changes — Save and Discard ride the footer rig only then. */
export function identityDirty(saved: IdentityDraft, draft: IdentityDraft): boolean {
	return Object.keys(identityPatch(saved, draft)).length > 0;
}
// #endregion

// #region Visibility
/** The three directory visibilities, in the order the SelectButton offers them. */
export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
	{ value: "public", label: "Public" },
	{ value: "unlisted", label: "Unlisted" },
	{ value: "invite_only", label: "Invite only" },
];

/** What a visibility means for the entity's public page, `/@handle`. */
export function visibilityHint(visibility: WorkspaceVisibility, handle: string): string {
	switch (visibility) {
		case "public":
			return `Listed in the directory, and anyone can open /@${handle}.`;
		case "unlisted":
			return `Kept out of the directory — anyone with the link can open /@${handle}.`;
		case "invite_only":
			return `Only members can open /@${handle}.`;
	}
}

/** Why the choice does not reach visitors yet: only an active entity is ever shown to them. */
function visibilityStatusNote(kind: WorkspaceKind, status: WorkspaceStatus): string | null {
	const noun = kindCopy(kind).noun;
	if (status === "draft") return `Until the ${noun} is published, only members see it.`;
	if (status === "archived") return `While the ${noun} is archived, only members see it.`;
	return null;
}
// #endregion

// #region Blockers
/** `1 escrow` / `3 escrows`. */
function counted(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * One blocker as the reader meets it: what it is (with its count when the read gave one — a refusal
 * that raced the read names the code alone) and where it is cleared. Projects live in the console's
 * Projects module; money in the entity's wallet; spend requests in Spend; invoices and what is owed
 * on account in Billing.
 */
export function blockerLine(
	input: Pick<SettingsInput, "kind" | "id" | "handle">,
	code: ArchiveBlockerCode,
	count: number | null,
): BlockerLine {
	const copy = kindCopy(input.kind);
	const projects = {
		label: "Open Projects",
		href: workspaceHref(input.kind, input.handle, "projects"),
	};
	const wallet = { label: `Open the ${copy.moneyNoun}`, href: walletHrefFor(input.kind, input.id) };
	const module = (key: string, label: string) => ({
		label,
		href: workspaceHref(input.kind, input.handle, key),
	});
	const one = count === null || count === 1;
	switch (code) {
		case "escrow_held":
			return {
				code,
				text: count === null
					? `Money is held in escrow for this ${copy.noun}'s work — archiving waits until it releases.`
					: `${counted(count, "escrow is", "escrows are")} held for this ${copy.noun}'s work — ` +
						`archiving waits until ${one ? "it releases" : "they release"}.`,
				link: wallet,
			};
		case "live_assignments":
			return {
				code,
				text: count === null
					? `This ${copy.noun} is still assigned to live work — finish it or hand it back first.`
					: `This ${copy.noun} is assigned to ${counted(count, "live stage", "live stages")} — ` +
						`finish ${one ? "it" : "them"} or hand ${one ? "it" : "them"} back first.`,
				link: projects,
			};
		case "live_projects":
			return {
				code,
				text: count === null
					? `This ${copy.noun} still has live projects — complete or archive them first.`
					: `This ${copy.noun} has ${counted(count, "live project", "live projects")} — ` +
						`complete or archive ${one ? "it" : "them"} first.`,
				link: projects,
			};
		case "pending_approvals":
			return {
				code,
				text: count === null
					? "Spend requests are still waiting for a decision — decide them first."
					: `${
						counted(count, "spend request is", "spend requests are")
					} waiting for a decision — ` +
						`decide ${one ? "it" : "them"} first.`,
				link: module("spend", "Open Spend"),
			};
		case "unpaid_invoices":
			return {
				code,
				text: count === null
					? `This ${copy.noun} has unpaid invoices — pay them first.`
					: `${counted(count, "invoice is", "invoices are")} unpaid — pay ${
						one ? "it" : "them"
					} first.`,
				link: module("billing", "Open Billing"),
			};
		case "on_account_owed":
			return {
				code,
				text: `This ${copy.noun} still owes on account — settle it first.`,
				link: module("billing", "Open Billing"),
			};
		case "wallet_balance":
			return {
				code,
				text: `The ${copy.moneyNoun} still holds money — withdraw or move it first.`,
				link: wallet,
			};
		case "pending_payouts":
			return {
				code,
				text: count === null || count === 1
					? "A withdrawal is still in flight — let it settle first."
					: `${
						counted(count, "withdrawal is", "withdrawals are")
					} still in flight — let them settle first.`,
				link: wallet,
			};
	}
}

/**
 * The blocker codes a refused archive's `details.blockers` names (comma-joined, the server's order),
 * kept to the codes this screen words. A refusal that raced the read is shown the same way.
 */
export function refusedBlockers(raw: unknown): ArchiveBlockerCode[] {
	if (typeof raw !== "string") return [];
	return raw.split(",").map((c) => c.trim()).filter(isBlockerCode);
}

const BLOCKER_CODES: readonly ArchiveBlockerCode[] = [
	"escrow_held",
	"live_assignments",
	"live_projects",
	"pending_approvals",
	"unpaid_invoices",
	"on_account_owed",
	"wallet_balance",
	"pending_payouts",
];

function isBlockerCode(code: string): code is ArchiveBlockerCode {
	return (BLOCKER_CODES as readonly string[]).includes(code);
}
// #endregion

// #region Lifecycle
/**
 * The status `Tag` — the same words and tone as the lane's header strip (`lane-model.ts`
 * `statusTag`, which reaches the glyph registry and so cannot be imported here; the test pins the
 * two together).
 */
export function lifecycleTag(status: WorkspaceStatus): StatusTag {
	if (status === "draft") return { label: "Draft", severity: "warning" };
	if (status === "archived") return { label: "Archived", severity: "secondary" };
	return { label: "Active", severity: "success" };
}

/**
 * What being live lets the entity do: a team applies for work from two active members (the apply
 * doors refuse fewer, Decision #228 (E)); a business starts projects and spends (#236 (A)).
 */
function workFact(input: SettingsInput, lead: string): MetaLineEntry {
	if (input.kind === "business") return `${lead} start projects and spend`;
	return input.memberCount >= TEAM_PROPOSAL_MIN_MEMBERS
		? `${lead} apply for work`
		: { text: `${lead} apply once it has ${TEAM_PROPOSAL_MIN_MEMBERS} members`, tabular: true };
}

/** What a draft's publish would do, as MetaLine facts — the page it opens follows its visibility. */
function publishFacts(input: SettingsInput): MetaLineEntry[] {
	const copy = kindCopy(input.kind);
	const page = input.visibility === "public"
		? `Publishing lists it on /@${input.handle}`
		: input.visibility === "unlisted"
		? `Publishing opens /@${input.handle} to anyone with the link`
		: `Publishing keeps /@${input.handle} members-only while it is invite only`;
	return [page, workFact(input, "lets it"), `a published ${copy.noun} never returns to draft`];
}

/** The confirm an archive asks, worded for where a later restore would land. */
function archiveConfirm(input: SettingsInput): ArchiveConfirm {
	const copy = kindCopy(input.kind);
	const back = input.status === "active" ? "live" : "as a draft";
	return {
		header: `Archive ${input.name}?`,
		message:
			`It leaves your active ${copy.plural} and stops taking new work. Nothing is deleted — ` +
			`restoring it brings it back ${back}.`,
		accept: "Archive",
		reject: "Keep it",
	};
}

/** The Lifecycle section's control for a viewer — see the module header. */
export function lifecycleControl(input: SettingsInput): LifecycleControl {
	const copy = kindCopy(input.kind);
	const mayArchive = input.capabilities.includes("archive_entity");
	if (input.status === "archived") {
		if (!mayArchive) {
			return { kind: "none", note: `Restoring is for members who may archive the ${copy.noun}.` };
		}
		return {
			kind: "restore",
			label: input.restoreTarget === "active"
				? "Restore as active"
				: input.restoreTarget === "draft"
				? "Restore as a draft"
				: "Restore",
			tier: 3,
			target: input.restoreTarget,
		};
	}
	if (!mayArchive) {
		return { kind: "none", note: `Archiving is for members who may archive the ${copy.noun}.` };
	}
	if (input.archiveBlockers.length > 0) {
		return {
			kind: "blocked",
			blockers: input.archiveBlockers.map((b) => blockerLine(input, b.code, b.count)),
		};
	}
	return {
		kind: "archive",
		label: `Archive ${copy.noun}…`,
		facts: [`Leaves your active ${copy.plural}`, "Stops taking new work", "Restorable"],
		confirm: archiveConfirm(input),
	};
}

/** What the status means, as MetaLine facts. */
function lifecycleFacts(input: SettingsInput): MetaLineEntry[] {
	if (input.status === "draft") return publishFacts(input);
	if (input.status === "active") return ["Published", workFact(input, "Can")];
	if (input.restoreTarget === "active") {
		return ["It was published, so a restore brings it back live"];
	}
	if (input.restoreTarget === "draft") {
		return ["It was never published, so a restore brings it back as a draft"];
	}
	return ["Hidden from your roster and from visitors"];
}
// #endregion

// #region Composition
/** The Settings screen for an entity and a viewer. Total: every input yields a model. */
export function settingsModel(input: SettingsInput): SettingsModel {
	const copy = kindCopy(input.kind);
	const editable = input.capabilities.includes("edit_profile");
	const publishes = input.status === "draft" && input.capabilities.includes("manage_settings");
	return {
		identity: { editable, handleText: `@${input.handle}`, handleNote: HANDLE_NOTE },
		visibility: {
			editable,
			options: [...VISIBILITY_OPTIONS],
			hint: visibilityHint(input.visibility, input.handle),
			statusNote: visibilityStatusNote(input.kind, input.status),
		},
		lifecycle: {
			tag: lifecycleTag(input.status),
			facts: lifecycleFacts(input),
			control: lifecycleControl(input),
		},
		commit: publishes ? { key: "publish", label: `Publish ${copy.noun}`, tier: 3 } : null,
	};
}

/**
 * How many filled controls the Settings BODY draws — Restore is its only filled one; Publish fills
 * the header band, Save the footer rig (one filled per region, §B.8.1).
 */
export function settingsBodyFilledCount(model: SettingsModel): number {
	return model.lifecycle.control.kind === "restore" ? 1 : 0;
}
// #endregion

// #region Dev Context Switcher
/**
 * The positions of the Dev Context Switcher's `teamSettings` axis — `DevTeamSettings` in
 * `@web/utils/dev-seam.ts`, spelled out here because that module reads the DOM and cannot load under
 * `deno test`. The island passes the seam's value straight in.
 */
export type SettingsSimulation =
	| "auto"
	| "draft"
	| "active"
	| "escrow_held"
	| "live_assignments"
	| "archived_published"
	| "archived_draft";

/**
 * The lifecycle the `teamSettings` axis substitutes — every seeded team is active with nothing in
 * flight, so this is the only route to a draft, a blocked archive or either restore. `auto` (or no
 * override) is the server's read unchanged. Client-side only: Publish, Archive and Restore still go to
 * the server, which answers with its own truth.
 */
export function simulateSettings(
	input: SettingsInput,
	sim: SettingsSimulation | undefined,
): SettingsInput {
	switch (sim) {
		case undefined:
		case "auto":
			return input;
		case "draft":
			return { ...input, status: "draft", archiveBlockers: [], restoreTarget: null };
		case "active":
			return { ...input, status: "active", archiveBlockers: [], restoreTarget: null };
		case "escrow_held":
			return {
				...input,
				status: "active",
				archiveBlockers: [{ code: "escrow_held", count: 1 }],
				restoreTarget: null,
			};
		case "live_assignments":
			return {
				...input,
				status: "active",
				archiveBlockers: [{ code: "live_assignments", count: 2 }],
				restoreTarget: null,
			};
		case "archived_published":
			return { ...input, status: "archived", archiveBlockers: [], restoreTarget: "active" };
		case "archived_draft":
			return { ...input, status: "archived", archiveBlockers: [], restoreTarget: "draft" };
	}
}
// #endregion
