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

/**
 * Fold Zod issues into a `{ "path.to.field": message }` record (`form` for a whole-object refusal).
 * First issue per key wins — a form shows one message per input and the rest would never be read.
 */
export function fieldErrors(
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return errors;
}

/** The field-keyed 422 a malformed body earns. */
export function invalidFields(
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors: fieldErrors(issues) },
		{ status: 422 },
	);
}
