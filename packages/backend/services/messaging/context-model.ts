import type {
	ContextAction,
	ConversationContext,
	ConversationCounterpart,
	ConversationEngagement,
	ConversationKind,
	EngagementMilestone,
	EngagementStatus,
} from "@projective/types/messaging";
import { formatMoney } from "@projective/types/finance";
import { INVITE_COOLDOWN_DAYS } from "@projective/types/projects";
import {
	type IntakeAnswer,
	intakeAnswered,
	type IntakeAnswers,
	intakeAnswerText,
	IntakeFieldsSchema,
} from "@projective/types/services";

/**
 * context-model — the ONE mapping from what two people are negotiating (the rows
 * `projects.get_engagement_context` returns, or the fixtures' twin of them) onto the drawer's
 * {@link ConversationContext}, including the actions it offers. Pure, so the live and stub paths
 * cannot disagree about which button a request earns.
 */

// #region Rows (the SQL read's JSON, camelCased by the function itself)
interface RequestRowBase {
	id: string;
	direction: "sent" | "received";
	status: string;
	projectId: string;
	projectSlug: string;
	projectTitle: string;
	projectStatus: string;
	projectVisibility: string;
	format: string;
	currency: string;
	summary: string | null;
	stageId: string | null;
	stageSlug: string | null;
	stageName: string | null;
	stageStatus: string | null;
	message: string | null;
	createdAt: string;
	assignmentStatus: string | null;
}

/** One invitation between the pair. */
export interface InvitationRow extends RequestRowBase {
	offerPriceCents: number | null;
	placeholder: boolean;
	answers: IntakeAnswers | null;
	intake: unknown;
	expiresAt: string | null;
	acceptedAt: string | null;
	declinedAt: string | null;
}

/** One application between the pair. */
export interface ApplicationRow extends RequestRowBase {
	roleTitle: string | null;
	priceCents: number | null;
}

/** One stage of a project either request names. */
export interface MilestoneRow {
	projectId: string;
	stageId: string;
	name: string;
	milestone: string;
	status: string;
	priceCents: number | null;
	sortOrder: number;
}

/** The whole read. */
export interface EngagementContextRow {
	standing: { level: number; label: string } | null;
	invitations: InvitationRow[];
	applications: ApplicationRow[];
	milestones: MilestoneRow[];
}
// #endregion

// #region Formatting
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `3 Oct 2026`, in UTC so SSR and hydration agree. */
export function shortDate(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return null;
	const d = new Date(at);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function priceLabel(cents: number | null, currency: string, format: string): string | null {
	if (cents === null || cents === undefined) return null;
	const money = formatMoney(cents, currency || "USD");
	return format === "pipeline" ? `${money} per ticket` : money;
}

function answersOf(
	intake: unknown,
	answers: IntakeAnswers | null,
): { label: string; value: string }[] {
	const fields = IntakeFieldsSchema.safeParse(intake);
	if (!fields.success || !answers) return [];
	const out: { label: string; value: string }[] = [];
	for (const field of fields.data) {
		const answer = answers[field.id];
		if (!intakeAnswered(field, answer)) continue;
		out.push({
			label: field.label,
			value: intakeAnswerText(field, answer as IntakeAnswer).slice(0, 2000),
		});
	}
	return out.slice(0, 12);
}
// #endregion

// #region Mapping
const ACCEPTED_SEAT = new Set(["assigned", "pending_funding", "accepted"]);

function invitationStatus(row: InvitationRow, now: number): EngagementStatus {
	if (row.status === "pending" && row.expiresAt && Date.parse(row.expiresAt) <= now) {
		return "expired";
	}
	if (row.status === "accepted" || row.status === "declined" || row.status === "expired") {
		return row.status;
	}
	return "pending";
}

function applicationStatus(row: ApplicationRow): EngagementStatus {
	if (row.status === "accepted" || row.status === "rejected" || row.status === "withdrawn") {
		return row.status;
	}
	return "pending";
}

/**
 * Where the viewer can open the project: the workspace when they own it or hold a seat on it, the
 * public view when it is live and discoverable, else nowhere — a pending invitee cannot open a
 * private project, and a link to a page that refuses them is a control reaching nothing.
 */
function projectHrefFor(
	row: RequestRowBase,
	viewerIsOwner: boolean,
	status: EngagementStatus,
): string | null {
	if (viewerIsOwner || status === "accepted") return `/projects/${row.projectSlug}`;
	if (
		row.projectStatus === "active" &&
		(row.projectVisibility === "public" || row.projectVisibility === "unlisted")
	) {
		return `/view/${row.projectSlug}`;
	}
	return null;
}

function milestonesFor(row: RequestRowBase, rows: MilestoneRow[]): EngagementMilestone[] {
	return rows
		.filter((m) => m.projectId === row.projectId)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.slice(0, 40)
		.map((m) => ({
			stageId: m.stageId,
			name: m.name,
			detail: (m.milestone ?? "").slice(0, 400),
			priceLabel: priceLabel(m.priceCents, row.currency, row.format),
			current: m.stageId === row.stageId,
		}));
}

function engagementOfInvitation(
	row: InvitationRow,
	raw: EngagementContextRow,
	now: number,
): ConversationEngagement {
	const status = invitationStatus(row, now);
	return {
		id: row.id,
		kind: "invitation",
		direction: row.direction,
		status,
		projectSlug: row.projectSlug,
		projectTitle: row.projectTitle,
		projectHref: projectHrefFor(row, row.direction === "sent", status),
		stageName: row.stageName,
		roleTitle: null,
		priceLabel: priceLabel(row.offerPriceCents, row.currency, row.format),
		placeholder: row.placeholder,
		message: row.message?.trim() ? row.message.trim().slice(0, 4000) : null,
		summary: row.summary?.trim() ? row.summary.trim().slice(0, 600) : null,
		answers: answersOf(row.intake, row.answers),
		milestones: milestonesFor(row, raw.milestones),
		sentLabel: `${row.direction === "sent" ? "Sent" : "Received"} ${shortDate(row.createdAt) ?? ""}`
			.trim(),
		expiresLabel: status === "pending" && row.expiresAt
			? `Expires ${shortDate(row.expiresAt)}`
			: null,
	};
}

function engagementOfApplication(
	row: ApplicationRow,
	raw: EngagementContextRow,
): ConversationEngagement {
	const status = applicationStatus(row);
	return {
		id: row.id,
		kind: "application",
		direction: row.direction,
		status,
		projectSlug: row.projectSlug,
		projectTitle: row.projectTitle,
		projectHref: projectHrefFor(row, row.direction === "received", status),
		stageName: row.stageName,
		roleTitle: row.roleTitle,
		priceLabel: priceLabel(row.priceCents, row.currency, row.format),
		placeholder: false,
		message: row.message?.trim() ? row.message.trim().slice(0, 4000) : null,
		summary: row.summary?.trim() ? row.summary.trim().slice(0, 600) : null,
		answers: [],
		milestones: milestonesFor(row, raw.milestones),
		sentLabel: `${row.direction === "sent" ? "Applied" : "Received"} ${
			shortDate(row.createdAt) ?? ""
		}`.trim(),
		expiresLabel: null,
	};
}
// #endregion

// #region Actions
/**
 * The actions the most recent open request earns. A freelancer answers a pending invitation — every
 * pending invitation on that project at once, because a multi-stage hire is one request to them; a
 * client confirms a pending applicant's seat, or funds a seat that is confirmed and waiting.
 */
export function deriveActions(
	raw: EngagementContextRow,
	counterpartName: string,
	now: number,
): ContextAction[] {
	const firstName = counterpartName.split(/\s+/)[0] || counterpartName;
	const pendingReceived = raw.invitations
		.filter((r) => r.direction === "received" && invitationStatus(r, now) === "pending")
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
	if (pendingReceived.length > 0) {
		const project = pendingReceived[0].projectId;
		const sameProject = pendingReceived.filter((r) => r.projectId === project);
		const ids = sameProject.map((r) => r.id).slice(0, 20);
		const stages = sameProject.map((r) => r.stageName).filter((s): s is string => !!s);
		const target = stages.length > 0 ? stages.join(", ") : sameProject[0].projectTitle;
		return [
			{
				kind: "accept_invitation",
				label: "Accept request",
				engagementIds: ids,
				href: null,
				note: `Joins you to ${target} on ${sameProject[0].projectTitle}.`,
			},
			{
				kind: "decline_invitation",
				label: "Decline",
				engagementIds: ids,
				href: null,
				note:
					`${firstName} can't invite you to this project again for ${INVITE_COOLDOWN_DAYS} days.`,
			},
		];
	}

	const pendingApplication = raw.applications
		.filter((r) => r.direction === "received" && applicationStatus(r) === "pending")
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
	if (pendingApplication) {
		const seat = pendingApplication.roleTitle ?? pendingApplication.stageName ??
			pendingApplication.projectTitle;
		return [{
			kind: "confirm_seat",
			label: "Fund escrow & confirm seat",
			engagementIds: [pendingApplication.id],
			href: "/wallet#upcoming",
			note: `Confirms ${firstName} on ${seat}, then takes you to fund its escrow.`,
		}];
	}

	const awaitingFunding = [
		...raw.invitations.filter((r) =>
			r.direction === "sent" && invitationStatus(r, now) === "accepted"
		),
		...raw.applications.filter((r) =>
			r.direction === "received" && applicationStatus(r) === "accepted"
		),
	]
		.filter((r) =>
			r.assignmentStatus !== null && ACCEPTED_SEAT.has(r.assignmentStatus) &&
			r.stageStatus === "assigned"
		)
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
	if (awaitingFunding) {
		const parked = awaitingFunding.assignmentStatus === "pending_funding";
		return [{
			kind: "fund_escrow",
			label: "Fund escrow & confirm seat",
			engagementIds: [awaitingFunding.id],
			href: parked ? `/projects/${awaitingFunding.projectSlug}` : "/wallet#upcoming",
			note: parked
				? "Price and publish the project, then fund the stage to confirm the seat."
				: `Funding ${
					awaitingFunding.stageName ?? "the stage"
				}'s escrow confirms ${firstName}'s seat — work can begin.`,
		}];
	}
	return [];
}
// #endregion

// #region Build
/** Everything {@link buildConversationContext} needs. */
export interface ContextInput {
	conversationId: string;
	kind: ConversationKind;
	/** The other person of a DM; null for a group. */
	counterpart: Omit<ConversationCounterpart, "standing"> | null;
	raw: EngagementContextRow | null;
	now: number;
}

/** Map the read onto the drawer's projection. */
export function buildConversationContext(input: ContextInput): ConversationContext {
	const { counterpart, raw, now } = input;
	if (!counterpart || !raw) {
		return {
			conversationId: input.conversationId,
			kind: input.kind,
			counterpart: counterpart ? { ...counterpart, standing: raw?.standing ?? null } : null,
			viewerRole: null,
			engagements: [],
			actions: [],
		};
	}
	const engagements = [
		...raw.invitations.map((row) => ({
			at: row.createdAt,
			e: engagementOfInvitation(row, raw, now),
		})),
		...raw.applications.map((row) => ({ at: row.createdAt, e: engagementOfApplication(row, raw) })),
	]
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
		.slice(0, 20)
		.map(({ e }) => e);

	const latest = engagements[0];
	const viewerRole = !latest
		? null
		: (latest.kind === "invitation") === (latest.direction === "sent")
		? "client"
		: "freelancer";

	return {
		conversationId: input.conversationId,
		kind: input.kind,
		counterpart: { ...counterpart, standing: raw.standing },
		viewerRole,
		engagements,
		actions: deriveActions(raw, counterpart.name, now),
	};
}
// #endregion
