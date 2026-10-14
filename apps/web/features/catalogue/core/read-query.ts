import {
	AnalyticsPeriod,
	ClientKey,
	ConsoleScope,
	isListingSlug,
} from "@projective/types/catalogue";

/**
 * read-query — the query string the catalogue's Analytics and Clients routes share: `?listing=` (one
 * listing's slug, the workspace), `?scope=` (a console scope), `?period=` and the dev axis `?sim=`.
 * Absent values take their defaults; a present value its schema refuses is a field error, so a typo
 * is a 422 rather than a silently different read.
 */

/** A parsed read query. */
export interface ReadQuery {
	listing?: string;
	scope: ConsoleScope;
	period: AnalyticsPeriod;
	sim: string | null;
}

/** The parsed query, or the field errors that refused it. */
export type ReadQueryResult =
	| { ok: true; query: ReadQuery }
	| { ok: false; errors: Record<string, string> };

/** Parse and validate the shared read query. */
export function parseReadQuery(params: URLSearchParams): ReadQueryResult {
	const errors: Record<string, string> = {};
	const listing = params.get("listing");
	if (listing !== null && !isListingSlug(listing)) errors.listing = "Not a listing address.";

	const scopeRaw = params.get("scope");
	const scope = ConsoleScope.safeParse(scopeRaw ?? "all");
	if (!scope.success) errors.scope = "Not a catalogue scope.";

	const periodRaw = params.get("period");
	const period = AnalyticsPeriod.safeParse(periodRaw ?? "30d");
	if (!period.success) errors.period = "Choose 7d, 30d, 90d or 12m.";

	if (!scope.success || !period.success || errors.listing) return { ok: false, errors };
	return {
		ok: true,
		query: {
			listing: listing ?? undefined,
			scope: scope.data,
			period: period.data,
			sim: params.get("sim"),
		},
	};
}

/** `@handle` from a path segment that carries the handle without its `@`, or `null`. */
export function clientKeyFromPath(segment: string | undefined): string | null {
	if (!segment) return null;
	const key = `@${decodeURIComponent(segment).replace(/^@/, "")}`;
	return ClientKey.safeParse(key).success ? key : null;
}

/** The 422 a read answers a refused query with, keyed by parameter. */
export function invalidQuery(errors: Record<string, string>): Response {
	return Response.json({ ok: false, message: "Check the request parameters.", errors }, {
		status: 422,
	});
}
