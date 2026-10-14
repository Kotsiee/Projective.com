import type { ConnectionsView } from "@projective/types/integrations";
import { MEETING_PROVIDER_LABEL, MeetingProvider } from "@projective/types/scheduling";

/**
 * conferencing-model — the room-provider choices a session listing offers (plan §4.3): the seller's
 * active conferencing connections, after a first "My default" choice that stores `null` and lets
 * `integrations.fn_conferencing_provider` pick at booking time. Calendar sync is a separate axis
 * (Decision #56) and never appears here.
 */

/** The `Select` value that stands for `null` ("use my default"). */
export const DEFAULT_PROVIDER = "default";

/** One choice in the provider picker. */
export interface ProviderOption {
	value: string;
	label: string;
}

/** What the picker offers, and whether there is anything to offer at all. */
export interface ProviderChoices {
	options: ProviderOption[];
	/** No conferencing connection is active: the seller is sent to connect one. */
	empty: boolean;
}

/**
 * The picker's choices for `view`. A provider the listing already names stays listed even if its
 * connection has lapsed, so the stored choice is shown rather than silently swapped.
 */
export function providerChoices(
	view: Pick<ConnectionsView, "connections" | "activeConferencingProvider">,
	current: MeetingProvider | null,
): ProviderChoices {
	const seen = new Set<string>();
	const connected: ProviderOption[] = [];
	for (const c of view.connections) {
		if (c.status !== "active" || !c.grantedKinds.includes("conferencing")) continue;
		const slug = MeetingProvider.safeParse(c.providerSlug);
		if (!slug.success || seen.has(slug.data)) continue;
		seen.add(slug.data);
		connected.push({ value: slug.data, label: MEETING_PROVIDER_LABEL[slug.data] });
	}
	if (current && !seen.has(current)) {
		connected.push({ value: current, label: `${MEETING_PROVIDER_LABEL[current]} (not connected)` });
	}
	const active = MeetingProvider.safeParse(view.activeConferencingProvider);
	const defaultLabel = active.success
		? `My default (${MEETING_PROVIDER_LABEL[active.data]})`
		: "My default";
	return {
		options: [{ value: DEFAULT_PROVIDER, label: defaultLabel }, ...connected],
		empty: connected.length === 0 && !active.success,
	};
}

/** A picker value as the offer stores it. */
export function providerOf(value: string): MeetingProvider | null {
	const parsed = MeetingProvider.safeParse(value);
	return parsed.success ? parsed.data : null;
}
