import { flattenRichText } from "@projective/types/richtext";
import {
	hasStagesFor,
	type ProjectDetail,
	type ProjectSetup,
	STAGE_ITEM_LABEL,
	type StageChannel,
} from "../types/projects-types.ts";

/**
 * The sidebar's live projection — the ONE place the owner's unsaved edits are folded onto the
 * engagement the middle-nav lane renders.
 *
 * The lane and the setup form are separate hydration roots reading one store (`core/setup-store.ts`),
 * so the only thing that could make them disagree is deriving the same fact twice. This module is
 * therefore pure and total: it takes the server's {@link ProjectDetail} and the working copy, and
 * returns what to draw. No fetching, no signals, no fallbacks invented at a call site.
 *
 * ## What the draft is allowed to override, and what it is not
 *
 * Only the fields the setup form actually edits: the title, the description, the engagement format
 * and the stage list. Everything else — the owner, the client, the roster, the teams, the DMs, the
 * viewer's own role — is the server's answer and stays the server's answer, because nothing on the
 * form can change it and overlaying it would be inventing a value.
 *
 * ## A stage without a channel is not a link
 *
 * A stage row in the lane navigates to its conversation, and a stage acquires that room server-side:
 * a stage the owner added a moment ago has none, and on the live path a saved stage whose `stage_all`
 * room has not been provisioned has none either — `buildStageChannels` omits it rather than inventing
 * one. So a row carries its channel or carries `null`, and the tree draws the second kind as a
 * non-navigable row. Rendering it as an anchor would be a control that reaches nothing (root
 * CLAUDE.md §3 gate 11); dropping it would be worse, because the owner just created it and would
 * watch the sidebar ignore the stage they added.
 *
 * @module
 */

// #region Display fallbacks
/**
 * What the lane calls an engagement with no name yet.
 *
 * A display fallback ONLY. An empty title is a transient state of a field somebody has just cleared —
 * the wire schema is `min(1)` and `firstBlocker` refuses the save in words — so this never stands in
 * for a value the server holds. It exists so a cleared field does not collapse the sidebar's heading
 * to nothing while the owner is typing the replacement.
 */
export const UNTITLED_PROJECT = "Untitled Project";

/**
 * What the lane calls a stage with no name yet: the engagement's own word for the unit, numbered from
 * its position — "Stage 1" on a pipeline, "Milestone 1" on a one-off, "Session 1" on a session.
 *
 * The vocabulary is the SSOT's {@link STAGE_ITEM_LABEL}, the same one the form's own row label and
 * every refusal message use, rather than a hardcoded "Stage": one word for the unit across the
 * surface, so the sidebar cannot call something a Stage while the section beside it calls it a
 * Milestone.
 */
export function fallbackStageName(format: ProjectSetup["format"], index: number): string {
	const item = STAGE_ITEM_LABEL[format];
	return `${item.charAt(0).toUpperCase()}${item.slice(1)} ${index + 1}`;
}
// #endregion

// #region The projection
/**
 * One stage as the lane draws it: a name, and the conversation it opens — or `null` when it has none
 * yet. The `id` is the STAGE's id (`projects.project_stages`), which is stable across a rename and
 * across the moment a channel is provisioned, so it is the honest key for the row.
 */
export interface SidebarStageRow {
	id: string;
	name: string;
	/** The provisioned conversation, or `null` — see the module note on gate 11. */
	channel: StageChannel | null;
	/**
	 * WHY there is no conversation to open — `null` when there is one.
	 *
	 * The two reasons look identical on screen and are different facts, so the row must not guess:
	 * `unsaved` is a stage the owner added and has not saved, which vanishes if they leave without
	 * saving; `unlinked` is a stage the server has, whose room is simply not provisioned yet
	 * (`comms` rooms are created on first open, so a saved stage nobody has visited has none).
	 *
	 * Told apart by the acknowledged BASELINE rather than by the shape of the id. The
	 * `stage-draft-…` prefix would answer it too, but it is a convention between the form and the
	 * write path, and reading it here would make a third party to an agreement that can change; the
	 * baseline IS the server's own answer to "do you know this stage".
	 */
	pending: "unsaved" | "unlinked" | null;
}

/** What the lane should draw right now. */
export interface SidebarProjection {
	/** The engagement with the draft's title, description and format folded in. */
	detail: ProjectDetail;
	/** The stage rows, in the draft's order. */
	stages: SidebarStageRow[];
	/**
	 * WHAT a fresh read of the engagement might resolve — `""` when there is nothing.
	 *
	 * Non-empty when a stage has no channel, or when the server holds a channel for a stage the draft
	 * no longer has. Deliberately NOT "the draft differs from the server": a rename or a reorder is
	 * fully expressible here, and re-reading for one would spend a round trip per keystroke-and-blur
	 * to fetch a name this projection already knows.
	 *
	 * It is a KEY rather than a boolean so a caller can tell "still unresolved" from "unresolved
	 * differently". A read that comes back and changes nothing leaves the key identical, which is the
	 * signal to stop asking — without it, an engagement whose two server projections disagree about
	 * its stage count would earn a pointless round trip on every single save.
	 */
	staleKey: string;
}

/** Whether a re-read might resolve something. Sugar over {@link SidebarProjection.staleKey}. */
export function isStale(projection: SidebarProjection): boolean {
	return projection.staleKey.length > 0;
}

/**
 * Fold the working copy onto the engagement.
 *
 * Total: with no draft — every project route but the owner's setup surface — it returns the server's
 * own answer, so the lane has one code path rather than a live one and a static one that could drift.
 *
 * The identity check is on the canonical uuid rather than the slug, because a slug is derived from
 * the title and the store keys on the uuid for the same reason: renaming a project must not make its
 * own draft look like a different engagement's.
 */
export function projectSidebarProjection(
	detail: ProjectDetail,
	setup: ProjectSetup | null,
	baseline: ProjectSetup | null = null,
): SidebarProjection {
	/** The server's own answer: every stage it holds a channel for, in its order. */
	const serverStages = (): SidebarStageRow[] =>
		detail.channels.stages.map((s) => ({ id: s.stageId, name: s.name, channel: s, pending: null }));

	if (!setup || setup.id !== detail.id) {
		return { detail, stages: serverStages(), staleKey: "" };
	}

	/*
	 * Which stages the server has acknowledged. Taken from the baseline when there is one for THIS
	 * engagement, and otherwise from the draft itself — before the first save the two are the same
	 * object, so treating every row as acknowledged is the truth rather than a fallback, and it is
	 * also the safer error: it says "no room yet" instead of telling somebody their saved work is
	 * unsaved.
	 */
	const acknowledged = new Set(
		(baseline && baseline.id === setup.id ? baseline : setup).stages.map((s) => s.id),
	);

	/*
	 * The draft governs the stage list only where the FORM shows one.
	 *
	 * A Direct Deliverable is staffed by named roles and carries no stages at all, so its draft says
	 * nothing about them — while the engagement still has the root stage every project has, because
	 * tickets, submissions and escrow have nowhere else to hang. Reading that silence as "the owner
	 * removed every stage" would delete real channels from the lane on an engagement whose form has no
	 * control that could have asked for it. `hasStagesFor` is the SSOT predicate the write path uses
	 * for the same question, so the two cannot drift.
	 */
	const draftGovernsStages = hasStagesFor(setup.structure);
	const channelsByStage = new Map(detail.channels.stages.map((s) => [s.stageId, s]));

	const stages: SidebarStageRow[] = draftGovernsStages
		? setup.stages.map((stage, index) => {
			const name = stage.name.trim() || fallbackStageName(setup.format, index);
			const channel = channelsByStage.get(stage.id) ?? null;
			return {
				id: stage.id,
				name,
				// The row's own name wins over the channel's: they are the same fact, and the draft is the
				// newer copy of it. `order` follows the draft's position, so a reorder moves the number too.
				channel: channel
					? { ...channel, name, order: index, channel: { ...channel.channel, name } }
					: null,
				pending: channel ? null : acknowledged.has(stage.id) ? "unlinked" : "unsaved",
			};
		})
		: serverStages();

	// What a re-read might resolve: stages the lane cannot link to yet, and channels for stages that
	// are gone. Sorted so the key describes the STATE rather than the order it was walked in.
	const unlinked = stages.filter((row) => row.channel === null).map((row) => row.id).sort();
	const drafted = new Set(stages.map((row) => row.id));
	const orphaned = detail.channels.stages
		.filter((s) => !drafted.has(s.stageId))
		.map((s) => s.stageId)
		.sort();

	return {
		detail: {
			...detail,
			title: setup.title.trim() || UNTITLED_PROJECT,
			/*
			 * The form's description is rich HTML and the lane's is the plain projection the server
			 * stores beside it (`projects.description_text`), so it is FLATTENED rather than passed
			 * through — a tag-stripping regex would splice words together at every formatting run,
			 * which is the defect `@projective/types/richtext` exists to remove.
			 */
			description: flattenRichText(setup.description),
			format: setup.format,
			channels: {
				...detail.channels,
				stages: stages.map((row) => row.channel).filter((c): c is StageChannel => c !== null),
			},
		},
		stages,
		staleKey: unlinked.length === 0 && orphaned.length === 0
			? ""
			: `${unlinked.join(",")}|${orphaned.join(",")}`,
	};
}
// #endregion
