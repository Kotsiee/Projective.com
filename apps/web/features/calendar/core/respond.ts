import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { CalendarResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link CalendarResult} HTTP body and echo its
 * suggested status. The single mapper every `/api/scheduling/*` route uses (mirrors the projects
 * feature's `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toSchedulingResponse<T>(result: ServiceResult<T>): Response {
	const body: CalendarResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}

/**
 * Fold a Zod failure into the flat `{ field: message }` map {@link CalendarResult.errors} carries, so
 * a refused write names the field that refused it (mirrors the files feature's helper). Typed
 * structurally rather than against `z.ZodError` to keep this transport shim independent of the Zod
 * major the SSOT happens to be on.
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
