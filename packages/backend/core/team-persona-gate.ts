import {
	TEAM_PERSONA_DB_REASON,
	TEAM_PERSONA_REASON,
	TEAM_PERSONA_REFUSAL,
	TEAM_PERSONA_SQLSTATE,
	TeamPersonaActor,
	type TeamPersonaDetails,
	TeamPersonaSide,
} from "@projective/types/workspace";

/** The parts of a PostgREST error the persona gate fills. */
export interface TeamPersonaError {
	code?: string;
	message?: string;
	details?: string | null;
	hint?: string | null;
}

/** The envelope every door answers a persona refusal with. */
export interface TeamPersonaRefusal {
	status: 403;
	message: string;
	details: TeamPersonaDetails;
}

const PREFIX = new RegExp(`^(?:ERROR:\\s*)?${TEAM_PERSONA_DB_REASON}:\\s*`, "i");

/**
 * Whether a database refusal is the Teams persona gate's — `org.fn_assert_team_persona` refusing a
 * client or operator-mode account (SQLSTATE `PK403`, message `persona_not_freelancer: …`, Decision
 * #228 (A)). Other PK403s (the earning gate, KYB) are not.
 */
export function isTeamPersonaRefused(error: TeamPersonaError | null | undefined): boolean {
	return error?.code === TEAM_PERSONA_SQLSTATE && PREFIX.test(error.message ?? "");
}

/**
 * Map the gate's refusal onto a 403 whose `details.reason` is the `persona` code, with whose persona it
 * was (HINT) and which side they are on (DETAIL), so a form can word its own sentence.
 */
export function teamPersonaRefusal(error: TeamPersonaError): TeamPersonaRefusal {
	const actor = TeamPersonaActor.catch("self").parse(error.hint ?? undefined);
	const persona = TeamPersonaSide.catch("client").parse(error.details?.trim() || undefined);
	const reason = (error.message ?? "").replace(PREFIX, "").replace(/\s+/g, " ").trim();
	return {
		status: 403,
		message: reason ? sentence(reason) : TEAM_PERSONA_REFUSAL,
		details: { reason: TEAM_PERSONA_REASON, actor, persona },
	};
}

function sentence(reason: string): string {
	const capital = reason[0].toUpperCase() + reason.slice(1);
	return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
