import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { WalletResult } from "../types/results.ts";

/**
 * Fold a fat-service {@link ServiceResult} into the client {@link WalletResult} HTTP body and echo its
 * suggested status. The single mapper every `/api/wallet/*` route uses (mirrors the catalogue/projects
 * `respond.ts`), so the transport shape stays consistent and defined in one place.
 */
export function toWalletResponse<T>(result: ServiceResult<T>): Response {
	const body: WalletResult<T> = {
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
