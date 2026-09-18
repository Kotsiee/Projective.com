import { z } from "zod";
import { CurrencyCode } from "./create.ts";
import { ProjectFormat, ProjectPartySchema, ProjectStatus } from "./summary.ts";
import type { MemberRosterPage } from "./members.ts";
import { MemberRole } from "./members.ts";
import { hasStages, pricedAtProjectLevel, type ProjectSetup, ProjectStructure } from "./setup.ts";
import { flattenRichText } from "../richtext/plain-text.ts";

/**
 * projects.hire — the Zod SSOT behind a client's "Hire" control on a seller's `/[handle]` page: the
 * READ the invitation modal opens on ({@link HireBriefSchema}) and the WRITE it sends
 * ({@link HireInvitationSchema}).
 *
 * The brief is a COMPOSITION, not a fourth read of the project. It is assembled by
 * {@link buildHireBrief} from the two projections the owner already has — the configuration
 * ({@link ProjectSetup}: stages and their prices, the format and structure) and the roster
 * ({@link MemberRosterPage}: who is on the engagement and which stages they contribute to) — so the
 * stage a client invites somebody to and the price they offer for it are the stage and price the
 * setup form shows, and the members listed are the members the roster shows. A second corpus for the
 * modal would be a second answer to both.
 *
 * ## The pricing model is DERIVED from the engagement's shape
 *
 * Three ways a client compensates a freelancer, decided by the format and structure they already
 * chose when they configured the project — never by a control in the modal:
 *
 *  - a **pipeline** pays PER TICKET, PER STAGE (`per_ticket_stage`): each selected stage carries the
 *    rate a ticket on it will hold in escrow;
 *  - a **multi-stage one-off** pays PER STAGE (`per_stage`): each selected stage is a milestone with
 *    a whole fee;
 *  - a **single-stage one-off** — including a Direct Deliverable — pays ONE task price (`task`) for
 *    the whole engagement, which is its one and only stage.
 *
 * The prices are SEEDED from the stage's configured `unitPriceCents` (the rate `fn_hold_ticket_escrow`
 * reads), so an invitation defaults to the terms the project already states; the client may adjust
 * the offer per invitation. What is typed here is an OFFER, not a ledger figure — the client never
 * totals money the server owns, but a sum of the numbers a person just typed is the form's own
 * arithmetic, and {@link hireInvitationTotalCents} is its one implementation.
 */

// #region Pricing model
/** How the invitation compensates the freelancer — derived, see the module docblock. */
export const HirePricingModel = z.enum(["per_ticket_stage", "per_stage", "task"]);
export type HirePricingModel = z.infer<typeof HirePricingModel>;

/** The pricing model an engagement's shape implies. */
export function hirePricingModelFor(
	format: ProjectFormat,
	structure: ProjectStructure,
): HirePricingModel {
	if (!hasStages(structure)) return "task";
	return format === "pipeline" ? "per_ticket_stage" : "per_stage";
}

/** The label the price field carries under each model. */
export const HIRE_PRICE_LABEL: Record<HirePricingModel, string> = {
	per_ticket_stage: "Per-ticket price",
	per_stage: "Stage price",
	task: "Task price",
};

/** The one-line explanation of what the figure means, per model. */
export const HIRE_PRICE_NOTE: Record<HirePricingModel, string> = {
	per_ticket_stage:
		"What each ticket on this stage pays — held in escrow when a ticket is claimed.",
	per_stage: "The whole fee for delivering this stage.",
	task: "The whole fee for the engagement — it has a single stage of work.",
};
// #endregion

// #region Brief (the read)
/** One stage a freelancer can be invited onto. */
export const HireStageSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	order: z.number().int().min(0),
	/** The stage's scope as PLAIN text (the setup holds semantic HTML), trimmed to a preview. */
	summary: z.string().max(240),
	/** The configured price in minor units — the seed for the offer; `null` = unpriced. */
	unitPriceCents: z.number().int().min(0).nullable(),
	/** Names of the members already contributing to this stage (from the roster). */
	memberNames: z.array(z.string().max(120)),
	/** How many providers have taken a seat here — the stage may already be staffed. */
	onboardedCount: z.number().int().min(0),
});
export type HireStage = z.infer<typeof HireStageSchema>;

/** One existing member, as the modal's roster row renders them. */
export const HireMemberSchema = z.object({
	id: z.string().min(1).max(120),
	party: ProjectPartySchema,
	role: MemberRole,
	/** Names of the stages this member contributes to (project-scope summary). */
	assignedStages: z.array(z.string().max(120)),
});
export type HireMember = z.infer<typeof HireMemberSchema>;

/** Everything the invitation modal renders and validates against. */
export const HireBriefSchema = z.object({
	/** The engagement's route slug — the address the invitation is sent to. */
	projectId: z.string().min(1).max(120),
	title: z.string().max(160),
	/** The description as PLAIN text, trimmed to an overview. */
	summary: z.string().max(400),
	status: ProjectStatus,
	format: ProjectFormat,
	structure: ProjectStructure,
	pricingModel: HirePricingModel,
	currency: CurrencyCode,
	/**
	 * The seed for a `task` model's single price: the root stage's configured price, or — for a
	 * role-staffed Direct Deliverable, which is priced at the project level — the project budget.
	 * `null` = not priced yet.
	 */
	taskPriceCents: z.number().int().min(0).nullable(),
	/** Every stage of the engagement, in order. A `task` model carries its one root stage. */
	stages: z.array(HireStageSchema).max(50),
	members: z.array(HireMemberSchema),
	/** Whether the viewer may send invitations here — re-derived server-side from the roster caps. */
	canInvite: z.boolean(),
});
export type HireBrief = z.infer<typeof HireBriefSchema>;

/** The character budget of a plain-text preview, per field. */
const SUMMARY_MAX = 400;
const STAGE_SUMMARY_MAX = 240;

/** Flatten rich text to one trimmed line, capped, with an ellipsis when it was cut. */
function preview(html: string, max: number): string {
	const flat = flattenRichText(html).replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Compose the brief from the two projections the owner already has.
 *
 * Members are matched to stages by NAME, because that is what the roster carries (`assignedStages`
 * is a list of stage names — the roster's own summary column), and the stage list's names are
 * unique within one engagement. A `task` model exposes exactly its root stage so the invitation's
 * stage id is still a real stage the live path can assign to.
 */
export function buildHireBrief(setup: ProjectSetup, roster: MemberRosterPage): HireBrief {
	const pricingModel = hirePricingModelFor(setup.format, setup.structure);
	const ordered = [...setup.stages].sort((a, b) => a.order - b.order);
	const root = ordered[0];
	const stages: HireStage[] = (pricingModel === "task" ? ordered.slice(0, 1) : ordered).map(
		(stage) => ({
			id: stage.id,
			name: stage.name,
			order: stage.order,
			summary: preview(stage.description, STAGE_SUMMARY_MAX),
			unitPriceCents: stage.unitPriceCents,
			memberNames: roster.members
				.filter((m) => m.assignedStages.includes(stage.name))
				.map((m) => m.party.name),
			onboardedCount: stage.onboardedCount,
		}),
	);
	const taskPriceCents = pricingModel !== "task"
		? null
		: pricedAtProjectLevel(setup.structure)
		? setup.budget.amountCents
		: root?.unitPriceCents ?? setup.budget.amountCents;
	return {
		projectId: setup.slug,
		title: setup.title,
		summary: preview(setup.description, SUMMARY_MAX),
		status: setup.status,
		format: setup.format,
		structure: setup.structure,
		pricingModel,
		currency: setup.budget.currency,
		taskPriceCents,
		stages,
		members: roster.members.map((m) => ({
			id: m.id,
			party: m.party,
			role: m.role,
			assignedStages: m.assignedStages,
		})),
		canInvite: roster.viewerCaps.canInvite,
	};
}
// #endregion

// #region Invitation (the write)
/** The message ceiling — the same bound a chat message body carries. */
export const HIRE_MESSAGE_MAX = 4000;

/** One selected stage with the price offered for it (minor units). */
export const HireStageOfferSchema = z.object({
	stageId: z.string().min(1).max(80),
	priceCents: z.number().int().min(0),
});
export type HireStageOffer = z.infer<typeof HireStageOfferSchema>;

/**
 * The invitation a client sends from a seller's profile.
 *
 * `stages` and `taskPriceCents` are the two halves of one offer, and which half applies is decided
 * by the engagement's pricing model rather than by the caller: a stage model carries at least one
 * stage offer and no task price; a `task` model carries the task price and no stage offers. The
 * shape admits both so ONE schema validates either, and {@link hireInvitationRefusal} — the rule the
 * modal and the service both call — refuses the mismatch.
 */
export const HireInvitationSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** The seller's `@handle` (with or without the `@`). */
	handle: z.string().trim().min(1).max(41),
	/** The intro message, plain text. Empty is allowed: the invitation itself is the message. */
	message: z.string().max(HIRE_MESSAGE_MAX).default(""),
	stages: z.array(HireStageOfferSchema).max(50).default([]),
	taskPriceCents: z.number().int().min(0).nullable().default(null),
});
export type HireInvitation = z.infer<typeof HireInvitationSchema>;

/** A refusal the invitation rule produces — field-keyed so a form can pin it to a control. */
export interface HireRefusal {
	message: string;
	errors: Record<string, string>;
}

/**
 * Why an invitation cannot be sent against this brief, or `null` when it can.
 *
 * The ONE implementation of the rule: the modal calls it to gate its Send control and to explain a
 * refusal in place, and the fat service calls it again on the way in, so a form that lets something
 * through is not a form that gets it accepted. Every stage offered must be a stage of the project,
 * offered once, and priced; a `task` model needs its single price and nothing else.
 */
export function hireInvitationRefusal(brief: HireBrief, input: HireInvitation): HireRefusal | null {
	if (!brief.canInvite) {
		return {
			message: "You cannot invite people to this project.",
			errors: { projectId: "not_invitable" },
		};
	}
	if (brief.pricingModel === "task") {
		if (input.taskPriceCents === null) {
			return {
				message: "Set the task price before sending.",
				errors: { taskPriceCents: "required" },
			};
		}
		if (input.stages.length > 0) {
			return {
				message: "A single-stage project takes one task price, not stage prices.",
				errors: { stages: "not_applicable" },
			};
		}
		return null;
	}
	if (input.taskPriceCents !== null) {
		return {
			message: "This project is priced per stage.",
			errors: { taskPriceCents: "not_applicable" },
		};
	}
	if (input.stages.length === 0) {
		return {
			message: "Pick at least one stage to invite them to.",
			errors: { stages: "required" },
		};
	}
	const known = new Map(brief.stages.map((s) => [s.id, s]));
	const seen = new Set<string>();
	for (const offer of input.stages) {
		if (!known.has(offer.stageId)) {
			return {
				message: "One of the selected stages is not part of this project.",
				errors: { stages: "unknown_stage" },
			};
		}
		if (seen.has(offer.stageId)) {
			return {
				message: "A stage was selected twice.",
				errors: { stages: "duplicate_stage" },
			};
		}
		seen.add(offer.stageId);
	}
	return null;
}

/**
 * The sum of everything offered, in minor units — the figure the modal's footer prints.
 *
 * A pipeline's per-ticket rates are summed as ONE ticket per selected stage, which is what "the
 * cost of one pass through the selected stages" means; how many tickets a client eventually
 * commissions is not known at invitation time and is not pretended to be.
 */
export function hireInvitationTotalCents(input: HireInvitation): number {
	if (input.taskPriceCents !== null) return input.taskPriceCents;
	return input.stages.reduce((sum, offer) => sum + offer.priceCents, 0);
}
// #endregion
