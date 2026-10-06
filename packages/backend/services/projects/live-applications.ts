import type { ApplyToProject } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/**
 * live-applications — the hiring handshake's RLS-scoped writes, each one DEFINER RPC that records the
 * request (or its answer) and notifies the other side through `comms.fn_notify` in the same
 * transaction:
 *
 * - **apply** → `projects.apply_to_project` (masks the cover note while the project is protected,
 *   notifies the owner with `application.received`);
 * - **answer an invitation** → `projects.respond_to_project_invitation` (the invitee's own door onto
 *   `fn_apply_invitation_decision`);
 * - **confirm an applicant's seat** → `projects.assign_from_application` (owner-side, conflict-guarded,
 *   notifies the applicant with `application.accepted`);
 * - **decline an applicant** → `projects.reject_application` (owner-side, notifies the applicant with
 *   `application.declined`).
 *
 * Each raises its refusals with SQLSTATEs and sentences written for a reader, mapped here to the
 * envelope; anything unexpected throws for the fat service to report as a 502.
 */

/** What `apply_to_project` returns. */
export interface AppliedRow {
	id: string;
	projectId: string;
	projectSlug: string;
	ownerUserId: string;
	stageId: string;
	roleId: string | null;
	status: "pending";
	message: string | null;
}

/**
 * Map a handshake RPC's refusal onto the envelope by its SQLSTATE; anything else goes through the
 * shared `refusalFrom`, which never passes an internal message through.
 */
export function handshakeRefusal(
	error: { code?: string; message: string },
	field: string,
): WriteRefusal {
	const message = error.message.replace(/^ERROR:\s*/i, "").trim();
	if (error.code === "23505") return { status: 409, message, errors: { [field]: "duplicate" } };
	if (error.code === "23514" || error.code === "22023") {
		return { status: 422, message, errors: { [field]: "refused" } };
	}
	if (error.code === "42501") return { status: 403, message, errors: { [field]: "not_permitted" } };
	return refusalFrom(error.message, field);
}

/** Apply to a stage (optionally one of its roles) as the caller. */
export async function applyLive(
	actor: ReadActor & { accessToken: string },
	input: ApplyToProject,
): Promise<WriteOutcome<AppliedRow>> {
	const { data, error } = await projectsDb(actor).rpc("apply_to_project", {
		p_project: input.projectId,
		p_stage: input.stageId,
		p_role_id: input.roleId,
		p_message: input.message.trim() || null,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: handshakeRefusal(error, "stageId") };
	}
	return { data: data as AppliedRow };
}

/** Answer one invitation addressed to the caller. */
export async function respondLive(
	actor: ReadActor & { accessToken: string },
	invitationId: string,
	accept: boolean,
): Promise<WriteOutcome<{ id: string; status: "accepted" | "declined" }>> {
	const { data, error } = await projectsDb(actor).rpc("respond_to_project_invitation", {
		p_invitation_id: invitationId,
		p_accept: accept,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: handshakeRefusal(error, "invitationIds") };
	}
	const row = data as { id: string; status: "accepted" | "declined" };
	return { data: { id: row.id, status: row.status } };
}

/** Confirm an applicant's seat as the project's owner. */
export async function acceptApplicationLive(
	actor: ReadActor & { accessToken: string },
	applicationId: string,
): Promise<WriteOutcome<{ id: string; status: "accepted" }>> {
	const { data, error } = await projectsDb(actor).rpc("assign_from_application", {
		p_application_id: applicationId,
	});
	if (error) {
		if (error.code === "P0002") return null;
		if (error.code === "23P01" || error.code === "23505") {
			return {
				refusal: {
					status: 409,
					message: error.message.replace(/^ERROR:\s*/i, "").trim(),
					errors: { applicationId: "conflict" },
				},
			};
		}
		return { refusal: handshakeRefusal(error, "applicationId") };
	}
	const row = data as { id: string };
	return { data: { id: row.id, status: "accepted" } };
}

/** Decline an applicant as the project's owner. */
export async function rejectApplicationLive(
	actor: ReadActor & { accessToken: string },
	applicationId: string,
): Promise<WriteOutcome<{ id: string; status: "rejected" }>> {
	const { data, error } = await projectsDb(actor).rpc("reject_application", {
		p_application_id: applicationId,
	});
	if (error) {
		if (error.code === "P0002") return null;
		return { refusal: handshakeRefusal(error, "applicationId") };
	}
	const row = data as { id: string };
	return { data: { id: row.id, status: "rejected" } };
}
