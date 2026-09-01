import { z } from "zod";
import { MoneyViewSchema } from "../finance/wallet.ts";
import { ChannelKind } from "./detail.ts";
import { SystemActivityType } from "./messages.ts";
import { TicketStatus } from "./board.ts";
import { ProjectPartySchema, ProjectStatus } from "./summary.ts";

/**
 * projects.overview — the Zod SSOT for the freelancer's `/projects/[projectId]` dashboard.
 *
 * `/projects/[projectId]` is a role dispatcher: an owner gets the setup surface
 * ({@link ProjectSetupSchema}), and everyone else gets this. The two reads are separate because they
 * answer different questions — setup asks "is this engagement ready to hire against", overview asks
 * "what does this engagement want from ME" — and one projection serving both would hand a freelancer
 * the owner's budget fields and hand the owner an assignment list that is always empty.
 *
 * **Every field is viewer-pertinent by construction.** {@link ProjectOverviewFinanceSchema} carries
 * the viewer's own escrow position, never the project's books: a freelancer on a stage is owed a
 * truthful account of their own money and is owed nothing at all about what the client is paying
 * anyone else. Widening it later is a disclosure decision, not a schema convenience.
 *
 * Money arrives as {@link MoneyViewSchema} — server-summed, server-converted, server-formatted — so
 * the client never totals, splits or converts (Decision #55). The vocabularies are reused rather than
 * forked: an update's `kind` is the {@link SystemActivityType} a channel's inline notice already
 * speaks, so the dashboard rail and the chat feed report the same event with the same word.
 *
 * Like its siblings this is a READ projection, not a table row — derived deterministically from the
 * fixtures while `PROJECTS_BACKEND_LIVE` is off, with the live path slotting in behind the same gate.
 * Only enum/array/string/number/boolean primitives plus shallow nested objects are used so the schema
 * stays stable across Zod majors.
 */

// #region Hero
/**
 * The identity band: who owns the engagement, what it is called, and the facts about it.
 *
 * `meta` is an ordered array of pre-formatted strings because the surface renders them as inline
 * middot-separated `--text-secondary` text (DESIGN_SYSTEM §B.11 — non-actionable metadata is never a
 * chip). Pre-formatted server-side for the same reason the feed pre-formats `budgetLabel`: a date or
 * a currency assembled in the browser renders a different string from the one SSR sent.
 *
 * {@link status} is carried as a value rather than folded into `meta` because a lifecycle state is the
 * one fact on this row that DOES earn a container — it changes, which is precisely the §B.11 test that
 * separates a status from a category.
 */
export const ProjectOverviewHeroSchema = z.object({
	title: z.string().min(1).max(160),
	/** The engagement owner — the avatar and name the band leads with. */
	owner: ProjectPartySchema,
	/**
	 * The owner's public handle, hoisted out of {@link owner} so the hero's profile link has one
	 * unambiguous source and its absence is a first-class state. Links to the canonical `/[handle]`
	 * (root CLAUDE.md §8 Decision #3), never `/profile/…`. `null` = no public profile to link to.
	 */
	handle: z.string().max(40).nullable(),
	status: ProjectStatus,
	/** The lifecycle state in words, for the one containered element on the row. */
	statusLabel: z.string().min(1).max(40),
	/** Pre-formatted facts, in display order. */
	meta: z.array(z.string().max(80)).max(8),
	/** Completed vs total stages for the progress meter; `null` on a format that has no stage run. */
	completedStages: z.number().int().min(0).nullable(),
	totalStages: z.number().int().min(0).nullable(),
});
export type ProjectOverviewHero = z.infer<typeof ProjectOverviewHeroSchema>;
// #endregion

// #region Recent updates
/**
 * One entry in the Recent updates rail.
 *
 * `text` is the whole rendered line rather than a template plus arguments, because the sentence is
 * assembled where the names, the stage and the clock all resolve — the same reason
 * {@link SystemActivitySchema} carries its line ready-made. `href` is `null` when the event has
 * nowhere to go; an entry that looks clickable and reaches nothing is the defect class root
 * CLAUDE.md §3 gate 11 exists to prevent.
 */
export const ProjectUpdateSchema = z.object({
	id: z.string().min(1).max(80),
	kind: SystemActivityType,
	/** Who acted; `null` for a system transition nobody performed. */
	actor: ProjectPartySchema.nullable(),
	text: z.string().min(1).max(240),
	/** ISO instant — the ordering key. */
	at: z.string(),
	/** Pre-formatted relative/absolute label, so SSR and the island print the same clock. */
	atLabel: z.string().max(28),
	href: z.string().max(300).nullable(),
});
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
// #endregion

// #region Channels
/**
 * One quick-entry row in the Messages block.
 *
 * A NARROWER shape than {@link ProjectChannelSchema}: the dashboard lists a handful of rooms worth
 * opening, so it carries the preview line the sidebar tree has no space for and drops the unified
 * `chatId` the tree needs to reconcile a DM against the global inbox. `unread` stays a boolean because
 * this surface draws a pulsing dot, never a count (DESIGN_SYSTEM Part D).
 */
export const ProjectOverviewChannelSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	kind: ChannelKind,
	unread: z.boolean(),
	/** The last line in the room, truncated server-side; `""` when the room is empty. */
	lastMessagePreview: z.string().max(200),
	/** `/projects/[projectId]/[channelId]` — built server-side so the row cannot address a stale slug. */
	href: z.string().min(1).max(300),
});
export type ProjectOverviewChannel = z.infer<typeof ProjectOverviewChannelSchema>;
// #endregion

// #region Assignments
/** One ticket assigned to the viewer — the Your work block. */
export const ProjectAssignmentSchema = z.object({
	ticketId: z.string().min(1).max(80),
	title: z.string().min(1).max(200),
	/** The stage the ticket runs in; `null` for a ticket sitting in the backlog. */
	stageName: z.string().max(120).nullable(),
	status: TicketStatus,
	/** Pre-formatted due label ("Due Fri, 12 Sep"); `null` = undated, which is not the same as overdue. */
	dueLabel: z.string().max(40).nullable(),
	href: z.string().min(1).max(300),
});
export type ProjectAssignment = z.infer<typeof ProjectAssignmentSchema>;
// #endregion

// #region Finance
/**
 * The viewer's own money on THIS engagement, and nothing else.
 *
 * Three states, mirroring the wallet's capital vocabulary so a freelancer reading one surface and then
 * the other is reading the same words: `escrowed` is committed by the client but not yet anybody's,
 * `released` has been paid out, `pending` has been released and is inside the clearing window. All
 * three are server-summed — the client never adds two of them together to produce a fourth.
 */
export const ProjectOverviewFinanceSchema = z.object({
	escrowed: MoneyViewSchema,
	released: MoneyViewSchema,
	pending: MoneyViewSchema,
});
export type ProjectOverviewFinance = z.infer<typeof ProjectOverviewFinanceSchema>;
// #endregion

// #region Page envelope
/** The whole freelancer dashboard read for one engagement. */
export const ProjectOverviewSchema = z.object({
	/** Route slug — the surface's own address, and the root every `href` below was built from. */
	slug: z.string().min(1).max(120),
	hero: ProjectOverviewHeroSchema,
	/** Newest first. */
	updates: z.array(ProjectUpdateSchema).max(50),
	channels: z.array(ProjectOverviewChannelSchema).max(50),
	assignments: z.array(ProjectAssignmentSchema).max(100),
	finance: ProjectOverviewFinanceSchema,
});
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;
// #endregion
