import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * respond — the one transport mapper every `/api/finance/{escrow,topup,connect,identity}/*` route
 * uses, so the payments surface answers in the same envelope as the wallet and checkout routes
 * (`{ ok, message, errors, data }` with the service's suggested status).
 *
 * The payments feature owns the processor-facing endpoints of the Stripe fiat rails (root CLAUDE.md
 * §8 Decision #125). Its islands — the Payment Element, the Identity modal, the payout-onboarding
 * button — land in Phase 2; the routes and this mapper are the contract they will call.
 */

/** The client-facing envelope of a payments route. */
export interface PaymentsResponse<T> {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	data?: T;
}

/** Fold a fat-service result into the HTTP response, echoing its suggested status. */
export function toPaymentsResponse<T>(result: ServiceResult<T>): Response {
	const body: PaymentsResponse<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		data: result.data,
	};
	return Response.json(body, {
		status: result.status,
		// A client secret or a single-use onboarding link must never be cached by anything in between.
		headers: { "cache-control": "no-store" },
	});
}

/**
 * A rendered document as a download: `application/pdf`, attachment, never cached by anything in
 * between (a financial document is private). A refusal answers as JSON with its status.
 */
export function pdfResponse(result: ServiceResult<{ filename: string; bytes: Uint8Array<ArrayBuffer> }>): Response {
	if (!result.ok || !result.data) {
		return Response.json({ ok: false, message: result.message }, { status: result.status });
	}
	const safeName = result.data.filename.replace(/[^A-Za-z0-9._-]/g, "_");
	return new Response(result.data.bytes, {
		status: 200,
		headers: {
			"content-type": "application/pdf",
			"content-disposition": `attachment; filename="${safeName}"`,
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff",
		},
	});
}

/** Fold a Zod `safeParse` error into a field-keyed map (first message per path wins). */
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

/** A 422 for a request body that failed its schema. */
export function invalidBody(error: Parameters<typeof toFieldErrors>[0]): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(error) },
		{ status: 422, headers: { "cache-control": "no-store" } },
	);
}

/** Read a JSON body, or `null` when it is missing or not JSON. */
export async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return null;
	}
}
