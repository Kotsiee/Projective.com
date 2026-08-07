import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link CheckoutResponse} HTTP body and echo
 * its suggested status. The single mapper every `/api/basket/*`, `/api/checkout/*` and `/api/cards/*`
 * route uses (mirrors the wallet / catalogue / projects features' `respond.ts`), so the transport shape
 * stays consistent and defined in one place.
 */
export function toCheckoutResponse<T>(result: ServiceResult<T>): Response {
	const body: CheckoutResponse<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, { status: result.status });
}

/** Fold a Zod `safeParse` error into a field-keyed error map (first message per path wins). */
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

/** A 422 carrying field-keyed validation errors from a failed parse. */
export function invalidPayload(error: Parameters<typeof toFieldErrors>[0]): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(error) },
		{ status: 422 },
	);
}

/** A 400 for a body that was not JSON at all. */
export function malformedBody(): Response {
	return Response.json({ ok: false, message: "Malformed request body." }, { status: 400 });
}
