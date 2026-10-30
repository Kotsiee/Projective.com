import { serverEnv } from "../../core/env.ts";

/**
 * link-reputation — a link's standing on a threat list: Google Web Risk, Lookup API (`uris:search`).
 * Safe Browsing v4 was dropped for its non-commercial licence (Decision #340, ruling T5). The key is
 * `LINK_SAFETY_API_KEY`, read at call time, sent only in the `x-goog-api-key` header — never in a
 * URL, where request logs would keep it — and never inlined.
 *
 * The Lookup API sends the URL itself to Google. That is the price of a reputation check without a
 * local hash-prefix database (the Update API), and it is paid only for links somebody posted into a
 * conversation — never for page loads.
 */

/** The answer a reputation check gives. */
export type Reputation =
	| { status: "clean" }
	| {
		status: "listed";
		threat: string;
		/** Web Risk's `expireTime` (epoch ms): the verdict must not be cached past it. */
		expiresAt?: number;
	}
	| { status: "unavailable" };

/** Seams for tests; production passes none. */
export interface ReputationDeps {
	key?: string;
	fetch?: typeof fetch;
}

const ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search";
const TIMEOUT_MS = 2_500;
const PLACEHOLDER = "XXXX-XXXX";

const THREAT_LABELS: Record<string, string> = {
	MALWARE: "malware",
	SOCIAL_ENGINEERING: "phishing",
	UNWANTED_SOFTWARE: "unwanted software",
};

/** The configured key, or null when absent or still the placeholder. */
export function linkSafetyKey(): string | null {
	const key = serverEnv().linkSafetyApiKey?.trim();
	if (!key || key === PLACEHOLDER || key.length < 20) return null;
	return key;
}

/** The `uris:search` address for one URL: the URL and the threat lists, never the key. */
export function lookupUrl(url: string): string {
	const query = new URLSearchParams({ uri: url });
	for (const type of Object.keys(THREAT_LABELS)) query.append("threatTypes", type);
	return `${ENDPOINT}?${query}`;
}

/** Read a `uris:search` answer: `{}` is clean, `{ threat: { threatTypes, expireTime } }` is listed. */
export function readLookup(json: unknown): Reputation {
	if (!json || typeof json !== "object") return { status: "unavailable" };
	const threat = (json as { threat?: { threatTypes?: string[]; expireTime?: string } }).threat;
	if (!threat) return { status: "clean" };
	const type = threat.threatTypes?.[0] ?? "";
	const expiresAt = Date.parse(threat.expireTime ?? "");
	return {
		status: "listed",
		threat: THREAT_LABELS[type] ?? "a known threat",
		...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
	};
}

/** Check one URL. Never throws: no key, a timeout or an error answer is `unavailable`. */
export async function checkReputation(url: string, deps: ReputationDeps = {}): Promise<Reputation> {
	const key = deps.key ?? linkSafetyKey();
	if (!key) return { status: "unavailable" };
	try {
		const response = await (deps.fetch ?? fetch)(lookupUrl(url), {
			headers: { "x-goog-api-key": key },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) {
			await response.body?.cancel();
			return { status: "unavailable" };
		}
		return readLookup(await response.json());
	} catch {
		return { status: "unavailable" };
	}
}
