import type { HelpCentreCategory } from "@projective/types/editorial";

/**
 * The help centre's eight topics, in hub order (P2 work order §2 "Topics"). A slug is permanent once
 * seeded (Decision #274 (k)): retitle a category freely, never re-slug it. Each category's articles
 * live in `./<slug>.ts`.
 */
export const HELP_CATEGORIES: readonly HelpCentreCategory[] = [
	{
		slug: "getting-started",
		position: 0,
		title: "Getting started",
		description:
			"What Projective is, the three kinds of project, and your first hire or first job.",
		icon: "flag",
	},
	{
		slug: "projects-and-stages",
		position: 1,
		title: "Projects & stages",
		description: "Set up a project, break it into stages and tickets, and bring people onto it.",
		icon: "stages",
	},
	{
		slug: "escrow-and-payments",
		position: 2,
		title: "Escrow & payments",
		description:
			"How money is held before work starts, what it costs, and paying by card or wallet.",
		icon: "wallet",
	},
	{
		slug: "revisions-and-approvals",
		position: 3,
		title: "Revisions & approvals",
		description: "Submitting work, asking for changes, and accepting work so payment is released.",
		icon: "submission",
	},
	{
		slug: "disputes-and-fair-exit",
		position: 4,
		title: "Disputes & Fair Exit",
		description:
			"Ending a stage early, cancelling a session, and what happens when a session is missed.",
		icon: "shield",
	},
	{
		slug: "payouts-and-verification",
		position: 5,
		title: "Payouts & verification",
		description: "Verifying who you are, when earnings become available, and withdrawing them.",
		icon: "arrow-up-right",
	},
	{
		slug: "teams-and-businesses",
		position: 6,
		title: "Teams & businesses",
		description: "Working as a team of freelancers, or hiring as a business with a shared wallet.",
		icon: "members",
	},
	{
		slug: "account-and-security",
		position: 7,
		title: "Account & security",
		description:
			"Signing in, age rules, your handle, privacy in messages and closing your account.",
		icon: "lock",
	},
];
