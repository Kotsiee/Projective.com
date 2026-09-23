import type { z } from "zod";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { ProfileResult } from "../types/results.ts";

/**
 * The HTTP half of every `/api/profile/*` and `/api/media/*` route: one body shape, one status echo,
 * one way a malformed request is refused — defined here once so the routes stay thin.
 */

/** Fold a fat-service {@link ServiceResult} into the client {@link ProfileResult} body. */
export function toProfileBody<T>(result: ServiceResult<T>): ProfileResult<T> {
	return {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
}

/** The same body as a `Response`, echoing the service's suggested status. */
export function toProfileResponse<T>(result: ServiceResult<T>): Response {
	return Response.json(toProfileBody(result), { status: result.status });
}

/**
 * Parse a JSON request body against a schema. Answers with the parsed value, or a 422 `Response`
 * keyed by field path (the first issue per field) — the shape every form's field errors read.
 */
export async function parseBody<S extends z.ZodType>(
	req: Request,
	schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
	const raw = await req.json().catch(() => undefined);
	if (raw === undefined) {
		return {
			ok: false,
			response: Response.json({ ok: false, message: "Expected a JSON body." }, { status: 400 }),
		};
	}
	const parsed = schema.safeParse(raw);
	if (parsed.success) return { ok: true, data: parsed.data };
	const errors: Record<string, string> = {};
	for (const issue of parsed.error.issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return {
		ok: false,
		response: Response.json(
			{ ok: false, message: Object.values(errors)[0] ?? "Check the highlighted fields.", errors },
			{ status: 422 },
		),
	};
}
