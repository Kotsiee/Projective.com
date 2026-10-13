import type {
	DisputeCase,
	DisputeQueue,
	DisputeResolveInput,
	DisputeStatus,
} from "@projective/types/finance";
import { apiFetch } from "@web/utils/api-client.ts";

/** The soft envelope every desk call resolves to — a failure is a sentence, never a throw. */
export interface DeskResult<T> {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	data?: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<DeskResult<T>> {
	try {
		const res = await apiFetch(path, {
			...init,
			headers: {
				accept: "application/json",
				...(init?.body ? { "content-type": "application/json" } : {}),
			},
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as DeskResult<T>;
		return { ok: false, message: "Unexpected response from the disputes service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/**
 * DisputeDeskService — the dumb client service behind the operator dispute desk (Decision #212). It
 * builds a URL or a JSON body and calls the `/api/finance/disputes` routes; who may read the queue or
 * rule, and what a ruling moves, are the database's (`security.is_admin()` in every operator door).
 */
export const DisputeDeskService = {
	/** The live queue, oldest-due first, with the counts over every live case. */
	queue(): Promise<DeskResult<DisputeQueue>> {
		return call<DisputeQueue>("/api/finance/disputes");
	},

	/** One case as the operator reads it (statements, evidence, the audit, `canResolve`). */
	get(disputeId: string): Promise<DeskResult<{ dispute: DisputeCase }>> {
		return call(`/api/finance/disputes/${encodeURIComponent(disputeId)}`);
	},

	/** Rule on a live case — final. */
	resolve(
		disputeId: string,
		input: DisputeResolveInput,
	): Promise<DeskResult<{ status: DisputeStatus }>> {
		return call(`/api/finance/disputes/${encodeURIComponent(disputeId)}/resolve`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	},
};
