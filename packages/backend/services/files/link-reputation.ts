import { serverEnv } from "../../core/env.ts";

/**
 * link-reputation — a link's standing on a threat list: Google Safe Browsing, v4 Lookup API
 * (`threatMatches:find`). The provider was named by the link-safety brief; the key is
 * `LINK_SAFETY_API_KEY`, read at call time and never inlined.
 *
 * The Lookup API sends the URL itself to Google. That is the price of a reputation check without a
 * local hash-prefix database (the Update API), and it is paid only for links somebody posted into a
 * conversation — never for page loads.
 */

/** The answer a reputation check gives. */
export type Reputation =
	| { status: "clean" }
	| { status: "listed"; threat: string }
	| { status: "unavailable" };

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const TIMEOUT_MS = 2_500;
const PLACEHOLDER = "XXXX-XXXX";

const THREAT_LABELS: Record<string, string> = {
	MALWARE: "malware",
	SOCIAL_ENGINEERING: "phishing",
	UNWANTED_SOFTWARE: "unwanted software",
	POTENTIALLY_HARMFUL_APPLICATION: "a harmful app",
};

/** The configured key, or null when absent or still the placeholder. */
export function linkSafetyKey(): string | null {
	const key = serverEnv().linkSafetyApiKey?.trim();
	if (!key || key === PLACEHOLDER || key.length < 20) return null;
	return key;
}

/** The request body Safe Browsing expects for one URL. */
export function lookupBody(url: string): unknown {
	return {
		client: { clientId: "projective", clientVersion: "1.0" },
		threatInfo: {
			threatTypes: Object.keys(THREAT_LABELS),
			platformTypes: ["ANY_PLATFORM"],
			threatEntryTypes: ["URL"],
			threatEntries: [{ url }],
		},
	};
}

/** Read a `threatMatches:find` answer: `{}` is clean, `{ matches: [...] }` is listed. */
export function readLookup(json: unknown): Reputation {
	if (!json || typeof json !== "object") return { status: "unavailable" };
	const matches = (json as { matches?: { threatType?: string }[] }).matches;
	if (!Array.isArray(matches) || matches.length === 0) return { status: "clean" };
	const type = matches[0]?.threatType ?? "";
	return { status: "listed", threat: THREAT_LABELS[type] ?? "a known threat" };
}

/** Check one URL. Never throws: no key, a timeout or an error answer is `unavailable`. */
export async function checkReputation(url: string): Promise<Reputation> {
	const key = linkSafetyKey();
	if (!key) return { status: "unavailable" };
	try {
		const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(lookupBody(url)),
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
