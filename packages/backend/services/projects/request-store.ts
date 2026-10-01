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
	message: string | null;
	createdAt: string;
}

const applications: StubApplication[] = [];

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
		requestDecisionOf(a.id) === null
	);
}

/** Forget everything (tests). */
export function clearRequestStore(): void {
	decisions.clear();
	applications.length = 0;
}
