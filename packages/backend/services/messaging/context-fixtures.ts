import type { ConversationContext, ConversationSummary } from "@projective/types/messaging";
import { requestDecisionOf } from "../projects/request-store.ts";
import {
	type ApplicationRow,
	buildConversationContext,
	type EngagementContextRow,
	type InvitationRow,
	type MilestoneRow,
} from "./context-model.ts";

/**
 * messaging context fixtures — what the conversation drawer reads while `MESSAGING_BACKEND_LIVE` is
 * off: the fixture twin of `projects.get_engagement_context` for the corpus conversations that carry
 * a request (an invitation the viewer received, an application they received, a seat they hired and
 * have not funded). Answers given from the drawer are folded in from the request store, so accepting
 * a fixture invitation shows it accepted on the next read.
 */

const INTAKE = [
	{
		id: "timeline",
		kind: "select",
		label: "When do you need this by?",
		options: [
			{ value: "asap", label: "As soon as possible" },
			{ value: "6-8w", label: "Within 6–8 weeks" },
		],
	},
	{ id: "assets", kind: "boolean", label: "Do you have brand assets ready?" },
	{ id: "notes", kind: "textarea", label: "Anything else we should know?" },
];

const ATLAS_STAGES: MilestoneRow[] = [
	{
		projectId: "pj-atlas",
		stageId: "stg-atlas-ux",
		name: "UX and prototype",
		milestone: "Clickable prototype of the client portal",
		status: "open",
		priceCents: 480000,
		sortOrder: 1,
	},
	{
		projectId: "pj-atlas",
		stageId: "stg-atlas-ui",
		name: "UI build",
		milestone: "",
		status: "open",
		priceCents: 920000,
		sortOrder: 2,
	},
	{
		projectId: "pj-atlas",
		stageId: "stg-atlas-qa",
		name: "QA and launch",
		milestone: "",
		status: "open",
		priceCents: 260000,
		sortOrder: 3,
	},
];

const ONBOARDING_STAGES: MilestoneRow[] = [
	{
		projectId: "pj-onboarding",
		stageId: "stg-onb-research",
		name: "Research",
		milestone: "Interviews and a findings memo",
		status: "in_progress",
		priceCents: 300000,
		sortOrder: 1,
	},
	{
		projectId: "pj-onboarding",
		stageId: "stg-onb-docs",
		name: "Documentation site",
		milestone: "Docs site with the new flows",
		status: "open",
		priceCents: 180000,
		sortOrder: 2,
	},
];

const LAUNCH_STAGES: MilestoneRow[] = [
	{
		projectId: "pj-launch",
		stageId: "stg-launch-audit",
		name: "Teardown audit",
		milestone: "A ranked list of fixes",
		status: "assigned",
		priceCents: 240000,
		sortOrder: 1,
	},
];

const base = {
	projectStatus: "active",
	format: "one_off",
	currency: "USD",
	stageSlug: null,
	assignmentStatus: null,
};

const FIXTURES: Record<string, () => EngagementContextRow> = {
	"dm-marcus": () => ({
		standing: null,
		invitations: [
			{
				...base,
				id: "inv-marcus-atlas",
				direction: "received",
				status: "pending",
				projectId: "pj-atlas",
				projectSlug: "prj-atpr2t4b7k",
				projectTitle: "Atlas client portal",
				projectVisibility: "invite_only",
				summary:
					"A self-serve portal for Atlas's investors: statements, documents and a quarterly update feed.",
				stageId: "stg-atlas-ux",
				stageName: "UX and prototype",
				stageStatus: "open",
				offerPriceCents: 480000,
				placeholder: false,
				message: "Hi Ahmed — I'd love you on the Atlas portal build. The brief is in the invite.",
				answers: {
					timeline: "6-8w",
					assets: true,
					notes: "We have a Figma kit from the marketing site.",
				},
				intake: INTAKE,
				createdAt: "2026-07-17T13:05:00Z",
				expiresAt: "2026-07-31T13:05:00Z",
				acceptedAt: null,
				declinedAt: null,
			} satisfies InvitationRow,
		],
		applications: [],
		milestones: ATLAS_STAGES,
	}),
	"dm-ivy": () => ({
		standing: { level: 3, label: "Trusted" },
		invitations: [],
		applications: [
			{
				...base,
				id: "app-ivy-docs",
				direction: "received",
				status: "pending",
				projectId: "pj-onboarding",
				projectSlug: "prj-tm2bjk9mdq",
				projectTitle: "Onboarding Revamp",
				projectVisibility: "public",
				summary:
					"Rework onboarding end to end: research the drop-off, redesign the flows, document them.",
				stageId: "stg-onb-docs",
				stageName: "Documentation site",
				stageStatus: "open",
				roleTitle: null,
				priceCents: 180000,
				message:
					"Hi! I've applied for the Documentation site stage. My case study is linked in the thread.",
				createdAt: "2026-07-16T20:40:00Z",
			} satisfies ApplicationRow,
		],
		milestones: ONBOARDING_STAGES,
	}),
	"dm-daniel-hired": () => ({
		standing: { level: 4, label: "Expert" },
		invitations: [
			{
				...base,
				id: "inv-daniel-launch",
				direction: "sent",
				status: "accepted",
				projectId: "pj-launch",
				projectSlug: "prj-cujw52gg3p",
				projectTitle: "Launch Teardown",
				projectVisibility: "public",
				summary: "An outside-in teardown of the launch: what confused buyers, ranked by cost.",
				stageId: "stg-launch-audit",
				stageName: "Teardown audit",
				stageStatus: "assigned",
				offerPriceCents: 240000,
				placeholder: false,
				message: "Daniel — would love your eyes on the launch.",
				answers: {},
				intake: [],
				createdAt: "2026-07-12T10:00:00Z",
				expiresAt: "2026-07-26T10:00:00Z",
				acceptedAt: "2026-07-13T09:00:00Z",
				declinedAt: null,
				assignmentStatus: "assigned",
			} satisfies InvitationRow,
		],
		applications: [],
		milestones: LAUNCH_STAGES,
	}),
};

/** Fold the answers given from the drawer onto a fixture row. */
function withDecisions(row: EngagementContextRow, now: number): EngagementContextRow {
	const at = new Date(now).toISOString();
	return {
		...row,
		invitations: row.invitations.map((inv) => {
			const decision = requestDecisionOf(inv.id);
			if (!decision || inv.status !== "pending") return inv;
			return decision === "accepted"
				? {
					...inv,
					status: "accepted",
					acceptedAt: at,
					assignmentStatus: "assigned",
					stageStatus: "assigned",
				}
				: { ...inv, status: "declined", declinedAt: at };
		}),
		applications: row.applications.map((app) => {
			const decision = requestDecisionOf(app.id);
			if (!decision || app.status !== "pending") return app;
			return decision === "accepted"
				? { ...app, status: "accepted", assignmentStatus: "assigned", stageStatus: "assigned" }
				: { ...app, status: "rejected" };
		}),
	};
}

/** The drawer's context for a corpus conversation. */
export function findConversationContext(
	summary: ConversationSummary,
	now: number,
): ConversationContext {
	const other = summary.kind === "group" ? null : summary.participants[0] ?? null;
	const fixture = FIXTURES[summary.id];
	return buildConversationContext({
		conversationId: summary.id,
		kind: summary.kind,
		counterpart: other
			? { id: other.id, name: other.name, handle: other.handle, avatar: other.avatar }
			: null,
		raw: fixture
			? withDecisions(fixture(), now)
			: { standing: null, invitations: [], applications: [], milestones: [] },
		now,
	});
}
