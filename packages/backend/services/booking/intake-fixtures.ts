import type { ServiceItem } from "@projective/types/explore";
import type { IntakeField } from "@projective/types/services";
import { IntakeFieldSchema } from "@projective/types/services";
import { hash } from "../scheduling/derive.ts";

/**
 * intake fixtures — the seller-authored questions behind the two split modals on a `/[handle]`
 * page, derived deterministically.
 *
 * Two lists, two owners. A LISTING's intake ({@link serviceIntakeFor}) is what a buyer answers in
 * the service modal before a purchase is staged; a SELLER's intake ({@link hireIntakeFor}) is what
 * a client answers before bringing them into a project. Both are DATA the seller would author in
 * their own settings; until that surface lands they derive from the id / handle, unsigned-hashed
 * (`>>>`, the documented hash-index gotcha) so a listing asks the same questions on every load and
 * across a resume.
 *
 * The pools are deliberately uneven across the corpus. Every control kind the renderer supports
 * appears somewhere, at least one seller asks NOTHING (so the modal's no-questions shape is
 * reachable), and required and optional fields are mixed — the renderer's required gate is the part
 * most likely to be wrong and least likely to be looked at on a corpus where everything is optional.
 */

// #region Pools
/** Questions a listing may ask, by the shape of work it is. */
const SERVICE_POOL: Record<"scoped" | "session" | "any", readonly IntakeField[]> = {
	scoped: [
		IntakeFieldSchema.parse({
			id: "goal",
			kind: "textarea",
			label: "What outcome are you after?",
			hint: "One or two sentences is plenty — the brief below carries the detail.",
			required: true,
			maxLength: 600,
		}),
		IntakeFieldSchema.parse({
			id: "deadline",
			kind: "select",
			label: "When do you need it?",
			required: true,
			options: [
				{ value: "asap", label: "As soon as possible" },
				{ value: "2w", label: "Within two weeks" },
				{ value: "1m", label: "Within a month" },
				{ value: "flex", label: "Flexible" },
			],
		}),
		IntakeFieldSchema.parse({
			id: "screens",
			kind: "number",
			label: "Screens or pages",
			hint: "A rough count is fine.",
			min: 1,
			max: 40,
			step: 1,
			unit: "screens",
			slider: true,
		}),
		IntakeFieldSchema.parse({
			id: "platforms",
			kind: "pills",
			label: "Target platforms",
			multiple: true,
			maxSelections: 3,
			options: [
				{ value: "web", label: "Web" },
				{ value: "ios", label: "iOS" },
				{ value: "android", label: "Android" },
				{ value: "print", label: "Print" },
			],
		}),
		IntakeFieldSchema.parse({
			id: "depth",
			kind: "radio",
			label: "How deep should this go?",
			required: true,
			options: [
				{ value: "light", label: "Light touch", hint: "Polish what exists." },
				{ value: "standard", label: "Standard", hint: "A proper pass with revisions." },
				{ value: "deep", label: "Deep", hint: "Rethink it from the ground up." },
			],
		}),
		IntakeFieldSchema.parse({
			id: "formats",
			kind: "checkboxes",
			label: "Formats you need back",
			options: [
				{ value: "figma", label: "Figma file" },
				{ value: "pdf", label: "PDF export" },
				{ value: "source", label: "Source files" },
			],
		}),
	],
	session: [
		IntakeFieldSchema.parse({
			id: "topics",
			kind: "multiselect",
			label: "What should we cover?",
			required: true,
			maxSelections: 3,
			options: [
				{ value: "portfolio", label: "Portfolio review" },
				{ value: "process", label: "Process and tooling" },
				{ value: "career", label: "Career direction" },
				{ value: "critique", label: "Critique of one piece" },
			],
		}),
		IntakeFieldSchema.parse({
			id: "level",
			kind: "select",
			label: "Your experience level",
			options: [
				{ value: "beginner", label: "Just starting" },
				{ value: "mid", label: "A few years in" },
				{ value: "senior", label: "Senior" },
			],
		}),
		IntakeFieldSchema.parse({
			id: "recording",
			kind: "boolean",
			label: "Record the session for me",
			hint: "You get the recording afterwards; it is never shared.",
		}),
	],
	any: [
		IntakeFieldSchema.parse({
			id: "brand",
			kind: "boolean",
			label: "Do you have brand guidelines?",
		}),
		IntakeFieldSchema.parse({
			id: "reference",
			kind: "text",
			label: "A link to your current site or file",
			placeholder: "https://…",
			maxLength: 300,
		}),
	],
};

/** Questions a seller may ask before joining a project. */
const HIRE_POOL: readonly IntakeField[] = [
	IntakeFieldSchema.parse({
		id: "scope",
		kind: "textarea",
		label: "What would you like me to take on?",
		hint: "The stage names tell me where; this tells me what.",
		required: true,
		maxLength: 800,
	}),
	IntakeFieldSchema.parse({
		id: "start",
		kind: "radio",
		label: "When should work start?",
		required: true,
		options: [
			{ value: "now", label: "Right away" },
			{ value: "month", label: "Within the month" },
			{ value: "flex", label: "Flexible" },
		],
	}),
	IntakeFieldSchema.parse({
		id: "hours",
		kind: "number",
		label: "Hours a week you expect",
		min: 2,
		max: 40,
		step: 1,
		unit: "hrs / week",
		slider: true,
	}),
	IntakeFieldSchema.parse({
		id: "nda",
		kind: "boolean",
		label: "Will you need an NDA signed?",
	}),
	IntakeFieldSchema.parse({
		id: "tools",
		kind: "pills",
		label: "Tools your team works in",
		multiple: true,
		options: [
			{ value: "figma", label: "Figma" },
			{ value: "notion", label: "Notion" },
			{ value: "jira", label: "Jira" },
			{ value: "slack", label: "Slack" },
			{ value: "github", label: "GitHub" },
		],
	}),
	IntakeFieldSchema.parse({
		id: "brief",
		kind: "text",
		label: "A link to the brief or a reference",
		placeholder: "https://…",
		maxLength: 300,
	}),
];
// #endregion

// #region Derivations
/** Pick `n` distinct entries from a pool, stepping from an unsigned seed. */
function pickFrom<T>(pool: readonly T[], n: number, seed: number): T[] {
	const out: T[] = [];
	for (let i = 0; out.length < Math.min(n, pool.length) && i < pool.length * 2; i++) {
		const candidate = pool[(seed + i * 5) % pool.length];
		if (!out.includes(candidate)) out.push(candidate);
	}
	return out;
}

/**
 * A listing's intake. Scoped work asks about the outcome and the deadline; a session asks what to
 * cover; every kind may add one of the generic questions. One listing in five asks nothing.
 */
export function serviceIntakeFor(service: Pick<ServiceItem, "id" | "serviceType">): IntakeField[] {
	const seed = hash(`intake:${service.id}`);
	if (seed % 5 === 0) return [];
	const session = service.serviceType === "Session" || service.serviceType === "Group Session";
	const pool = session ? SERVICE_POOL.session : SERVICE_POOL.scoped;
	const count = session ? 1 + (seed % 3) : 2 + (seed % 3);
	const picked = pickFrom(pool, count, seed >>> 3);
	if ((seed >>> 7) % 2 === 0) picked.push(SERVICE_POOL.any[(seed >>> 9) % SERVICE_POOL.any.length]);
	// Pool order, so two listings asking the same questions ask them in the same order.
	return [...pool, ...SERVICE_POOL.any].filter((f) => picked.includes(f));
}

/**
 * A seller's intake for joining a project. Sellers only — a buyer entity is never hired, so it
 * asks nothing — and one seller in four asks nothing at all.
 */
export function hireIntakeFor(handle: string, seller: boolean): IntakeField[] {
	if (!seller) return [];
	const bare = handle.replace(/^@+/, "");
	const seed = hash(`hire-intake:${bare}`);
	if (seed % 4 === 0) return [];
	const picked = pickFrom(HIRE_POOL, 2 + (seed % 2), seed >>> 3);
	return HIRE_POOL.filter((f) => picked.includes(f));
}
// #endregion
