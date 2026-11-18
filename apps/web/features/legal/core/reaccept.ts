import {
	LEGAL_VERSIONS,
	legalAcceptanceKind,
	SIGNUP_LEGAL_SLUGS,
	type SignupLegalSlug,
} from "@projective/types/legal";
import { currentVersion, legalFamily, legalToday } from "./registry.ts";

/** One document the re-accept step lists. */
export interface ReacceptDocument {
	slug: SignupLegalSlug;
	title: string;
	version: string;
	/** `YYYY-MM-DD`. */
	effectiveDate: string;
	changeSummary: string;
}

/**
 * The documents `/join?complete=terms` asks a person to accept (Decision #446): each accepted document
 * (the Terms, the Acceptable Use Policy) with a material version in effect, at today's version with
 * its change summary. When none is material the person has accepted nothing yet, so both are listed.
 */
export function reacceptDocuments(today: string = legalToday()): ReacceptDocument[] {
	const accepted = SIGNUP_LEGAL_SLUGS.filter((slug) => legalAcceptanceKind(slug) === "accepted");
	const material = accepted.filter((slug) =>
		LEGAL_VERSIONS[slug].some((v) => v.material && v.effectiveDate <= today)
	);
	return (material.length > 0 ? material : accepted).flatMap((slug) => {
		const family = legalFamily(slug);
		if (!family) return [];
		const doc = currentVersion(family, today);
		return [{
			slug,
			title: doc.title,
			version: doc.version,
			effectiveDate: doc.effectiveDate,
			changeSummary: doc.changeSummary,
		}];
	});
}
