import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { CatalogueResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link CatalogueResult} HTTP body and echo
 * its suggested status. The single mapper every `/api/catalogue/*` route uses (mirrors the projects /
 * messaging features' `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toCatalogueResponse<T>(result: ServiceResult<T>): Response {
	const body: CatalogueResult<T> = {
		ok: result.ok,
		message: result.message,
		errors: result.errors,
		details: result.details,
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

/**
 * A write's JSON body, whatever it was labelled. `navigator.sendBeacon` sends a `text/plain` Blob,
 * so a body is parsed on its content, never its content type. Unparseable is `null`, which every
 * schema refuses.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
	const text = await req.text().catch(() => "");
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** The 401 a catalogue write answers a signed-out caller with, before its body is even read. */
export function signedOut(): Response {
	return Response.json({ ok: false, message: "Sign in to manage your catalogue." }, {
		status: 401,
	});
}

/** The 422 a catalogue write answers a body its schema refuses with, keyed by field path. */
export function invalid(
	error: Parameters<typeof toFieldErrors>[0],
	message = "Check the highlighted fields.",
): Response {
	return Response.json({ ok: false, message, errors: toFieldErrors(error) }, { status: 422 });
}
