import {
	PLAN_GATE_REASON,
	PLAN_GATE_SQLSTATE,
	PLAN_GATES_OVERRIDE_HEADER,
	type PlanGateDetails,
	type PlanGatesOverride,
} from "@projective/types/finance";

/** The parts of a PostgREST error a plan gate fills. */
export interface PlanGateError {
	code?: string;
	message?: string;
	hint?: string | null;
}

/** The envelope every door answers a plan-gate refusal with. */
export interface PlanGateRefusal {
	status: 402;
	message: string;
	details: PlanGateDetails;
}

const PREFIX = new RegExp(`^(?:ERROR:\\s*)?${PLAN_GATE_REASON}:\\s*`, "i");
const KEYED = /^([a-z][a-z0-9_]*):\s*([\s\S]+)$/;

/** Whether a database refusal is a plan gate's (SQLSTATE `PK402`). */
export function isPlanGateRefusal(error: PlanGateError | null | undefined): boolean {
	return error?.code === PLAN_GATE_SQLSTATE;
}

/**
 * Map a plan gate's refusal onto a 402 whose `details.entitlement` names what the plan lacks.
 *
 * The business gates write `entitlement: <key>: <reason>` (Decision #230 (e)); the older team gate
 * writes `entitlement: <reason>` with the key only in HINT. Either way the key is read, and the reader
 * gets only the reason.
 */
export function planGateRefusal(error: PlanGateError): PlanGateRefusal {
	const rest = (error.message ?? "").replace(PREFIX, "").replace(/\s+/g, " ").trim();
	const keyed = KEYED.exec(rest);
	const entitlement = keyed?.[1] ?? error.hint?.trim() ?? null;
	const reason = keyed ? keyed[2] : rest;
	return {
		status: 402,
		message: reason ? sentence(reason) : "That is part of a paid plan.",
		details: { reason: PLAN_GATE_REASON, entitlement: entitlement || null },
	};
}

/**
 * The PostgREST headers that carry a Dev Context Switcher plan-gates override to the database
 * (`finance.fn_dev_plan_gates`), or none. The override can only make a gate stricter.
 */
export function planGateHeaders(
	override: PlanGatesOverride | null | undefined,
): Record<string, string> {
	return override ? { [PLAN_GATES_OVERRIDE_HEADER]: override } : {};
}

function sentence(reason: string): string {
	const capital = reason[0].toUpperCase() + reason.slice(1);
	return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
