import type { Option } from "@projective/ui/fields";

/**
 * Static option data for the onboarding wizard — kept out of the island so the same lists feed the
 * step form, the summary panel, and (where relevant) server validation.
 */

/** "What are you here to do?" — optional purpose chips (individual + org share the pool). */
export const PURPOSES: readonly Option[] = [
	{ value: "find-work", label: "Find freelance work" },
	{ value: "hire-talent", label: "Hire talent" },
	{ value: "build-team", label: "Build a team" },
	{ value: "sell-services", label: "Sell productised services" },
	{ value: "manage-projects", label: "Manage projects & escrow" },
	{ value: "explore", label: "Just exploring" },
];

/** Skills & interests — shown only when the person is onboarding as a Freelancer. */
export const SKILLS: readonly Option[] = [
	{ value: "ui-design", label: "UI Design" },
	{ value: "ux-research", label: "UX Research" },
	{ value: "brand", label: "Brand & Identity" },
	{ value: "illustration", label: "Illustration" },
	{ value: "motion", label: "Motion & Animation" },
	{ value: "frontend", label: "Frontend Engineering" },
	{ value: "backend", label: "Backend Engineering" },
	{ value: "mobile", label: "Mobile Development" },
	{ value: "data", label: "Data & ML" },
	{ value: "devops", label: "DevOps & Cloud" },
	{ value: "product", label: "Product Management" },
	{ value: "copywriting", label: "Copywriting" },
	{ value: "content", label: "Content & SEO" },
	{ value: "marketing", label: "Growth Marketing" },
	{ value: "video", label: "Video & Audio" },
	{ value: "3d", label: "3D & Game Art" },
];

/** Purpose value → label lookup for the summary card. */
export const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(
	PURPOSES.map((p) => [p.value, p.label]),
);
export const SKILL_LABELS: Record<string, string> = Object.fromEntries(
	SKILLS.map((s) => [s.value, s.label]),
);
