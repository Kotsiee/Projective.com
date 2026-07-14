/**
 * ServiceResult — the uniform return envelope for every fat service method.
 *
 * Services are transport-agnostic: they never touch `Request`/`Response`. Instead they return a
 * `ServiceResult<T>` describing the OUTCOME (success payload, or a failure with a suggested HTTP
 * status + human message + optional field errors). The thin route maps that envelope to an HTTP
 * response. This keeps the business logic reusable (a route, a cron job, or another service can all
 * call the same method) and keeps routes free of business decisions.
 */

/** Field-keyed validation messages, e.g. `{ email: "Enter a valid email address." }`. */
export type FieldErrors = Record<string, string>;

/**
 * The GoTrue tokens a successful sign-in yields. Carried on the envelope (NOT in `data`) so the thin
 * route mints HttpOnly session cookies from them and they never reach the JSON body.
 */
export interface SessionTokens {
	accessToken: string;
	refreshToken: string;
	/** Seconds until the access token expires. */
	expiresIn?: number;
}

/** The outcome of a service call. `ok` discriminates success (`data`) from failure. */
export interface ServiceResult<T> {
	/** Whether the operation succeeded. */
	ok: boolean;
	/** Suggested HTTP status for the thin route to echo (200/422/401/…). */
	status: number;
	/** Success payload; present when `ok`. */
	data?: T;
	/** Human-readable message (a success note, or a non-field error). */
	message?: string;
	/** Field-keyed validation errors (typically with a 422). */
	errors?: FieldErrors;
	/** When present, the route mints session cookies from these tokens (kept out of the JSON body). */
	session?: SessionTokens;
}

/** Build a success result. */
export function ok<T>(
	data: T,
	opts?: { status?: number; message?: string; session?: SessionTokens },
): ServiceResult<T> {
	return {
		ok: true,
		status: opts?.status ?? 200,
		data,
		message: opts?.message,
		session: opts?.session,
	};
}

/** Build a failure result. */
export function fail<T = never>(
	status: number,
	opts: { message?: string; errors?: FieldErrors },
): ServiceResult<T> {
	return { ok: false, status, message: opts.message, errors: opts.errors };
}
