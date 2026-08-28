import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * The transport shape every `/api/services/*` route answers in, and the single mapper that produces
 * it.
 *
 * Mirrors the projects, scheduling and files features' own `respond.ts`: one place decides how a fat
 * {@link ServiceResult} becomes an HTTP body, so a refusal from the booking service and a refusal
 * from a Zod parse are the same shape on the wire and the client has one branch rather than two.
 */

/** A soft result — a failure is a body with `ok: false`, never a thrown network error. */
export interface BookingResult<T> {
	ok: boolean;
	message?: string;
	/** Field-keyed reasons, so a refusal names the control that refused it. */
	errors?: Record<string, string>;
	data?: T;
}

/** Fold a fat-service result into the HTTP body and echo its suggested status. */
export function toBookingResponse<T>(result: ServiceResult<T>): Response {
	const body: BookingResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}

/**
 * Fold a Zod failure into the flat `{ field: message }` map {@link BookingResult} carries.
 *
 * Typed structurally rather than against `z.ZodError`, so this transport shim stays independent of
 * whichever Zod major the SSOT happens to be on — the same shape the calendar and files features use.
 */
export function toFieldErrors(
	error: {
		issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>;
	},
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return errors;
}

/** The 422 a failed parse answers with. One shape, so every route refuses identically. */
export function invalidPayload(
	error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }> },
): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(error) },
		{ status: 422 },
	);
}
