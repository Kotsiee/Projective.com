/**
 * submission-tasks — the pure, DOM-free model for the stage/ticket **Task Checklist** the client defines
 * for a stage (root task §5/§6). It is rendered in two places that share one checked state (owned by the
 * `SubmissionExplorer` island): the right-side Tasks panel (§6) and the freelancer's Pre-Submit modal
 * (§5, where the freelancer ticks tasks off before submitting). Like the sibling submission projections
 * this is DERIVED deterministically from a seed (a node/stage key) — no RNG — so the same stage always
 * shows the same checklist; the live path (RLS-scoped `projects.stage_tasks` reads) replaces the builder
 * with no shape churn.
 */

// #region Shapes
/** One checklist task — a client-defined item the freelancer ticks off. */
export interface ChecklistItem {
	id: string;
	label: string;
	done: boolean;
}

/** The task checklist for the active view — stage-level tasks + ticket-level tasks. */
export interface TaskChecklist {
	stage: ChecklistItem[];
	ticket: ChecklistItem[];
}
// #endregion

// #region Deterministic builder
/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const STAGE_TASK_POOL = [
	"Meets the agreed acceptance criteria",
	"All source files included",
	"Assets exported at the required resolutions",
	"Naming convention followed",
	"Reviewed against the brand guidelines",
	"No placeholder or lorem-ipsum content",
	"Responsive layouts checked",
];
const TICKET_TASK_POOL = [
	"Addresses every point in the ticket",
	"Linked the relevant references",
	"Self-reviewed the final export",
	"Ready for client hand-off",
];

/** Pick `n` distinct pool entries offset by the seed (stable, wraps). */
function pick(pool: readonly string[], n: number, seed: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(seed + i) % pool.length]);
	return out;
}

/**
 * Build the task checklist for a view. `seedKey` (project + path) keeps it stable per node; a one-off
 * engagement has no tickets, so `hasTickets` suppresses the ticket-level group. Every task starts
 * unticked (the freelancer's live state is layered on by the owning island).
 */
export function buildTaskChecklist(
	seedKey: string,
	opts: { hasTickets: boolean },
): TaskChecklist {
	const seed = hash(seedKey);
	const stageCount = 3 + (seed % 3); // 3–5 stage tasks
	const ticketCount = opts.hasTickets ? 2 + (seed % 2) : 0; // 2–3 ticket tasks

	const stage = pick(STAGE_TASK_POOL, stageCount, seed).map((label, i) => ({
		id: `${seedKey}:stage:${i}`,
		label,
		done: false,
	}));
	const ticket = pick(TICKET_TASK_POOL, ticketCount, seed + 3).map((label, i) => ({
		id: `${seedKey}:ticket:${i}`,
		label,
		done: false,
	}));
	return { stage, ticket };
}

/** Total tasks + completed tasks across both groups (progress caption / gating). */
export function checklistProgress(list: TaskChecklist): { total: number; done: number } {
	const all = [...list.stage, ...list.ticket];
	return { total: all.length, done: all.filter((t) => t.done).length };
}

/** Toggle one item by id, returning a new checklist (immutable update for the owning signal). */
export function toggleChecklistItem(list: TaskChecklist, id: string): TaskChecklist {
	const flip = (items: ChecklistItem[]) =>
		items.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
	return { stage: flip(list.stage), ticket: flip(list.ticket) };
}
// #endregion
