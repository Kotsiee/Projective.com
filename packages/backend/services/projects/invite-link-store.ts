import {
	inviteLinkPath,
	type MemberRequest,
	type StageInviteLink,
} from "@projective/types/projects";

/**
 * invite-link store — the PER-PROCESS stub twin of `projects.stage_invite_links` and of the requests a
 * redeemed link files, while `PROJECTS_BACKEND_LIVE` is off (Decision #145). Global rather than
 * per-viewer, because a link is opened by somebody other than the person who shared it. A restart
 * forgets it, like every sibling store.
 */

// #region Shapes
/** One stub link. */
interface StubLink {
	id: string;
	token: string;
	projectSlug: string;
	projectTitle: string;
	stageId: string;
	stageName: string;
	sharedBy: string;
	sharedByHandle: string | null;
	sharedById: string;
	createdAt: string;
	revoked: boolean;
}

/** Where a link leads, as recorded when it was minted. */
export interface StubLinkTarget {
	projectSlug: string;
	projectTitle: string;
	stageId: string;
	stageName: string;
	sharedBy: string;
	sharedByHandle: string | null;
	/** The user who shared it — the stub's stand-in for "manages this project". */
	sharedById: string;
}

/** A request a redeemed stub link filed. */
interface StubLinkRequest {
	request: MemberRequest;
	projectSlug: string;
	requesterId: string;
}
// #endregion

const activeByStage = new Map<string, StubLink>();
const byToken = new Map<string, StubLink>();
const linkRequests: StubLinkRequest[] = [];

function stageKey(projectSlug: string, stageId: string): string {
	return `${projectSlug}::${stageId}`;
}

function mintToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
}

function toLink(link: StubLink): StageInviteLink {
	return {
		id: link.id,
		token: link.token,
		stageId: link.stageId,
		path: inviteLinkPath(link.token),
		createdAt: link.createdAt,
	};
}

// #region Manager side
/** The stage's active stub link, or `null`. */
export function stubActiveLink(projectSlug: string, stageId: string): StageInviteLink | null {
	const link = activeByStage.get(stageKey(projectSlug, stageId));
	return link ? toLink(link) : null;
}

/** Mint the stage's link when it has none (`rotate` replaces an active one). */
export function stubEnsureLink(
	target: StubLinkTarget,
	rotate: boolean,
	now: number,
): StageInviteLink {
	const key = stageKey(target.projectSlug, target.stageId);
	const current = activeByStage.get(key);
	if (current && !rotate) return toLink(current);
	if (current) current.revoked = true;
	const link: StubLink = {
		...target,
		id: `link-${byToken.size + 1}`,
		token: mintToken(),
		createdAt: new Date(now).toISOString(),
		revoked: false,
	};
	activeByStage.set(key, link);
	byToken.set(link.token, link);
	return toLink(link);
}

/** Turn the stage's link off; `true` when one was active. */
export function stubRevokeLink(projectSlug: string, stageId: string): boolean {
	const key = stageKey(projectSlug, stageId);
	const current = activeByStage.get(key);
	if (!current) return false;
	current.revoked = true;
	activeByStage.delete(key);
	return true;
}
// #endregion

// #region Holder side
/** The stub link a token names, with whether it still works; `null` for an unknown token. */
export function stubLinkByToken(token: string): (StubLinkTarget & { revoked: boolean }) | null {
	const link = byToken.get(token);
	return link ? { ...link } : null;
}

/** Whether this person already has an open stub request on the stage. */
export function stubHasLinkRequest(
	projectSlug: string,
	stageId: string,
	requesterId: string,
): boolean {
	return linkRequests.some((entry) =>
		entry.projectSlug === projectSlug && entry.request.stageId === stageId &&
		entry.requesterId === requesterId
	);
}

/** Record the request a redeemed stub link filed. */
export function recordStubLinkRequest(
	projectSlug: string,
	requesterId: string,
	request: MemberRequest,
): void {
	linkRequests.push({ projectSlug, requesterId, request });
}

/** The stub request with this id and the project (slug) it was filed on, or `undefined`. */
export function findStubLinkRequest(
	id: string,
): { projectId: string; request: MemberRequest } | undefined {
	const entry = linkRequests.find((candidate) => candidate.request.id === id);
	return entry ? { projectId: entry.projectSlug, request: entry.request } : undefined;
}

/** The open requests stub links filed on a project, newest first. */
export function stubLinkRequests(projectSlug: string): MemberRequest[] {
	return linkRequests
		.filter((entry) => entry.projectSlug === projectSlug)
		.map((entry) => entry.request)
		.reverse();
}
// #endregion

/** Forget everything (tests). */
export function clearInviteLinkStore(): void {
	activeByStage.clear();
	byToken.clear();
	linkRequests.length = 0;
}
