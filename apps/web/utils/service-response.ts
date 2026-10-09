import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * Map a {@link ServiceResult} to the flat JSON envelope the app's thin routes answer with:
 * `{ ok, message, errors, details, ...data }` at the service's suggested status.
 */
export function serviceResponse<T extends object>(result: ServiceResult<T>): Response {
	return Response.json(
		{
			ok: result.ok,
			message: result.message,
			errors: result.errors,
			details: result.details,
			...(result.data ?? {}),
		},
		{ status: result.status },
	);
}

/** The 422 a route answers when its body fails validation, keyed to one field. */
export function invalidBody(field: string, message: string): Response {
	return Response.json({ ok: false, message, errors: { [field]: message } }, { status: 422 });
}
