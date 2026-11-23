import {
	COMMIT_LEGAL_DOCUMENTS,
	LEGAL_GATE_SQLSTATE,
	type LegalAcceptanceRequired,
	LegalAcceptanceRequiredSchema,
} from "@projective/types/legal";

/** The parts of a PostgREST error the first-commit gate fills. */
export interface LegalGateError {
	code?: string;
	message?: string;
	details?: string | null;
}

/** The envelope every claim and funding door answers the gate with. */
export interface LegalGateRefusal {
	status: 409;
	message: string;
	details: LegalAcceptanceRequired;
}

/**
 * The first-commit gate's refusal, or `null` for any other error: `org.fn_require_legal_acceptance`
 * asking for the IP Transfer Deed at a first paid claim or the Escrow Terms at a first funding (SQLSTATE
 * `PN409`, DETAIL `{document, version}`, LG3). The 409's `details` name the document and the version in
 * effect, which the dialog shows and sends back as `legalAcceptance`.
 */
export function legalAcceptanceRefusal(
	error: LegalGateError | null | undefined,
): LegalGateRefusal | null {
	if (error?.code !== LEGAL_GATE_SQLSTATE) return null;
	let detail: unknown;
	try {
		detail = JSON.parse(error.details ?? "");
	} catch {
		return null;
	}
	const parsed = LegalAcceptanceRequiredSchema.safeParse({
		reason: "legal_acceptance_required",
		...(detail as object),
	});
	if (!parsed.success) return null;
	const { title } = COMMIT_LEGAL_DOCUMENTS[parsed.data.document];
	return {
		status: 409,
		message: `Accept the ${title} (version ${parsed.data.version}) to continue.`,
		details: parsed.data,
	};
}
