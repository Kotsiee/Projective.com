/**
 * review-client — the one way the review islands call `/api/reviews/*` (Decision #487). Islands are
 * dumb: they post JSON to the thin routes and show the database's own sentence when it refuses.
 */

/** What a review write answered: success, or the refusal's message. */
export type ReviewWriteResult = { ok: true; id: string | null } | { ok: false; message: string };

const UNREACHABLE = "We couldn't reach reviews just now. Try again in a moment.";

/** POST or PATCH a review write and fold the answer into a {@link ReviewWriteResult}. */
export async function sendReviewWrite(
	url: string,
	method: "POST" | "PATCH",
	body: unknown,
): Promise<ReviewWriteResult> {
	try {
		const res = await fetch(url, {
			method,
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body ?? {}),
		});
		const json = await res.json().catch(() => null) as
			| {
				ok?: boolean;
				message?: string;
				errors?: Record<string, string>;
				data?: { id?: string } | null;
			}
			| null;
		if (res.ok && json?.ok) return { ok: true, id: json.data?.id ?? null };
		const field = json?.errors ? Object.values(json.errors)[0] : undefined;
		return { ok: false, message: field ?? json?.message ?? UNREACHABLE };
	} catch {
		return { ok: false, message: UNREACHABLE };
	}
}
