/**
 * The error page a failed article read becomes (P6): a 404 stays a 404 (a page past the last, a
 * slug that names nothing visible), an unreachable content store is a 503 (the error page offers
 * "Try again"), and anything else — a row that failed its schema — is a 500.
 */
export function readFailureStatus(status: number): 404 | 500 | 503 {
	if (status === 404) return 404;
	if (status === 503) return 503;
	return 500;
}
