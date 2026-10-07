import type { ReadActor } from "../read-actor.ts";

/**
 * request store — the PER-PROCESS record of the hiring handshake while `PROJECTS_BACKEND_LIVE` is
 * off: the answer a request got (an invitation accepted or declined from the conversation drawer, an
 * application confirmed) and the applications made from the stub path. The stub twin of
 * `projects.project_invitations.status` / `project_applications`; a restart forgets it, like every
 * sibling store.
 */

/** What a request became. */
export type RequestDecision = "accepted" | "declined";

const decisions = new Map<string, RequestDecision>();

/** Record the answer to an invitation or application, by its id. */
export function recordRequestDecision(id: string, decision: RequestDecision): void {
	decisions.set(id, decision);
}

/** The recorded answer to a request, or null while it is open. */
export function requestDecisionOf(id: string): RequestDecision | null {
	return decisions.get(id) ?? null;
}

/** An application made on the stub path. */
export interface StubApplication {
	id: string;
	owner: string;
	projectId: string;
	stageId: string;
	roleId: string | null;
	/** The team applied for, or null for a personal application. */
	teamId: string | null;
	message: string | null;
	createdAt: string;
}

const applications: StubApplication[] = [];

/**
 * Applications their applicant took back. Kept apart from {@link decisions} on purpose: those are the
 * OTHER side's answers, which the conversation fixtures render, and a withdrawal is not an answer.
 */
const withdrawn = new Set<string>();

/** Record an application; returns it. */
export function recordStubApplication(
	actor: ReadActor,
	input: Omit<StubApplication, "id" | "owner" | "createdAt">,
	now: number,
): StubApplication {
	const owner = actor.userId || "anonymous";
	const row: StubApplication = {
		id: `app-${input.projectId}-${applications.length + 1}`,
		owner,
		createdAt: new Date(now).toISOString(),
		...input,
	};
	applications.push(row);
	return row;
}

/** Whether this viewer already has an open stub application to that stage (or role). */
export function hasOpenStubApplication(
	actor: ReadActor,
	projectId: string,
	stageId: string,
	roleId: string | null,
): boolean {
	const owner = actor.userId || "anonymous";
	return applications.some((a) =>
		a.owner === owner && a.projectId === projectId && a.stageId === stageId &&
		a.roleId === roleId &&
		requestDecisionOf(a.id) === null && !withdrawn.has(a.id)
	);
}

/** The status a stub application reads as now. */
export function stubApplicationStatus(
	id: string,
): "pending" | "accepted" | "rejected" | "withdrawn" {
	if (withdrawn.has(id)) return "withdrawn";
	const decision = requestDecisionOf(id);
	if (decision === "accepted") return "accepted";
	if (decision === "declined") return "rejected";
	return "pending";
}

/** This viewer's stub applications, newest first, optionally narrowed to one project. */
export function listStubApplications(actor: ReadActor, projectId?: string): StubApplication[] {
	const owner = actor.userId || "anonymous";
	return applications
		.filter((a) => a.owner === owner && (!projectId || a.projectId === projectId))
		.reverse();
}

/**
 * Withdraw one of this viewer's pending stub applications. Returns the row it withdrew, `null` when
 * the viewer has no such application, or `"not_pending"` when it has already been answered.
 */
export function withdrawStubApplication(
	actor: ReadActor,
	id: string,
): StubApplication | null | "not_pending" {
	const owner = actor.userId || "anonymous";
	const row = applications.find((a) => a.id === id && a.owner === owner);
	if (!row) return null;
	if (stubApplicationStatus(id) !== "pending") return "not_pending";
	withdrawn.add(id);
	return row;
}

/** Forget everything (tests). */
export function clearRequestStore(): void {
	decisions.clear();
	applications.length = 0;
	withdrawn.clear();
}
