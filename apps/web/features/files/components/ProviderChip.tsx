import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import { connectionIsRecoverable, type ConnectionStatus } from "@projective/types/integrations";
import type { AssetSource } from "../types/file-types.ts";
import { SourceMark } from "./file-hub-glyphs.tsx";
import "../styles/share-drive.css";

/**
 * ProviderChip — one connected service, rendered as a MARK rather than a sentence.
 *
 * The drive picker's rail can hold four or five connections, and the fact a person needs from each at
 * a glance is not its name — they know which services they linked — but whether it can be browsed
 * right now. So the chip is the provider's brand mark with a state pip on it, and the words live in
 * the portal `Tooltip` every icon-only control carries (§B.6 icon-first, and never a native `title`,
 * which is unreachable by keyboard and unstyleable).
 *
 * ## Three redundant channels, so tone is never the only one
 *
 * The pip's SHAPE distinguishes the states before its tone does — a tick, a clock, a warning
 * triangle, a refresh arrow, a lock, a dash, an error mark — and the Tooltip sentence states it in
 * words. A reader who cannot separate green from amber still gets the answer from either of the
 * other two. The chip has no visible text, so that same sentence is its `aria-label`: the accessible
 * name and the tooltip say the same thing, which is what keeps voice control able to address it.
 *
 * ## Why `none` is a member and `disconnected` is not enough
 *
 * `integrations.connection_status` has no value for "this provider was never connected" —
 * `disconnected` means the user removed one that existed. Those two are a different offer (connect
 * for the first time, versus connect again after removing it), so {@link ProviderChipStatus} widens
 * the enum by exactly one member. The files SSOT's `SimConnectionState` widens it the same way for
 * the same reason, which is the precedent this follows rather than inventing a second vocabulary.
 *
 * ## Recoverable is the axis, not the status name
 *
 * `degraded` and `expired` are refreshable, so the offer is "reconnect"; `revoked`, `disconnected`
 * and `error` need a fresh consent. {@link providerConsent} routes on the SSOT's own
 * `connectionIsRecoverable` rather than on a local list of status names, so this surface and
 * `IntegrationsBackendService.browse` — which branches on exactly that predicate when it refuses —
 * cannot come to disagree about which failures are worth offering a retry for.
 *
 * Dumb: no data access, no fetching, no state. Every action is the host's callback.
 */

// #region Vocabulary

/**
 * A connection's state as this surface needs it: the stored `connection_status`, plus `none` for a
 * provider that has never been connected (see the module note).
 */
export type ProviderChipStatus = ConnectionStatus | "none";

/** How the connection reads to a PERSON, rather than to the state machine. */
export function providerStatusLabel(status: ProviderChipStatus): string {
	switch (status) {
		case "none":
			return "Not connected";
		case "pending":
			return "Finishing…";
		case "active":
			return "Connected";
		case "degraded":
			return "Needs attention";
		case "expired":
			return "Sign-in expired";
		case "revoked":
			return "Revoked";
		case "disconnected":
			return "Disconnected";
		case "error":
			return "Not working";
	}
}

/** The tone the pip is drawn in. One of three, resolved here so every consumer agrees. */
export function providerStatusTone(status: ProviderChipStatus): "ok" | "warn" | "off" {
	if (status === "none") return "off";
	if (status === "active") return "ok";
	if (status === "pending") return "warn";
	return connectionIsRecoverable(status) ? "warn" : "off";
}

/**
 * The pip's glyph.
 *
 * Every state gets a distinct SHAPE — including the two that share the warn tone, because a person
 * who cannot separate the tones would otherwise be told "amber" twice and nothing more. `expired`
 * takes the refresh arrow specifically: the shape names the fix.
 */
export function providerStatusMark(status: ProviderChipStatus): IconName {
	switch (status) {
		case "none":
			return "plus";
		case "pending":
			return "clock";
		case "active":
			return "check";
		case "degraded":
			return "warning";
		case "expired":
			return "refresh";
		case "revoked":
			return "lock";
		case "disconnected":
			return "minus";
		case "error":
			return "error";
	}
}

/** What kind of consent, if any, would put this connection back to work. */
export type ProviderConsent = "none" | "reconnect" | "connect";

/**
 * Which offer a state deserves.
 *
 * `reconnect` for the refreshable states and `connect` for the terminal ones — offering "reconnect"
 * on a revoked grant would imply a stored authorization that no longer exists, and the retry would
 * fail with nothing to explain it. `pending` gets neither: a consent already in flight is not helped
 * by starting a second one.
 */
export function providerConsent(status: ProviderChipStatus): ProviderConsent {
	if (status === "none") return "connect";
	if (status === "active" || status === "pending") return "none";
	return connectionIsRecoverable(status) ? "reconnect" : "connect";
}

/**
 * The one sentence that is BOTH the tooltip and the accessible name.
 *
 * One function rather than two strings, because a chip whose tooltip and `aria-label` drift is a
 * control that says one thing to a sighted reader and another to a voice-control user (WCAG 2.5.3).
 */
export function providerStatusSentence(
	label: string,
	status: ProviderChipStatus,
	accountLabel?: string | null,
): string {
	const who = accountLabel ? `${label} · ${accountLabel}` : label;
	return `${who} — ${providerStatusLabel(status)}`;
}

/**
 * The storage source a provider slug maps to, or `null` for a provider that stores no files.
 *
 * A mapping rather than a cast: `AssetSource` and the provider catalogue are deliberately separate
 * vocabularies (the catalogue is a DATA table so a new connector is a seed row, while the source
 * enum is a closed set the asset row is persisted with), and a provider with no matching source is a
 * real, expected case — `notion` advertises `docs`, `zoom` advertises `conferencing`, and neither
 * belongs in a drive picker.
 */
export function sourceForProvider(providerSlug: string): AssetSource | null {
	switch (providerSlug) {
		case "google_drive":
			return "google_drive";
		case "dropbox":
			return "dropbox";
		case "frameio":
			return "frameio";
		case "s3":
			return "s3";
		default:
			return null;
	}
}

// #endregion

// #region Props
export interface ProviderChipProps {
	/** The provider's human label, as the catalogue gives it ("Google Drive"). */
	label: string;
	/** The storage source whose brand mark is drawn; `null` falls back to the generic drive glyph. */
	source: AssetSource | null;
	status: ProviderChipStatus;
	/** Which account at the far end this is — one user may link several per provider. */
	accountLabel?: string | null;
	/** Whether this chip is the one currently being browsed. */
	selected?: boolean;
	disabled?: boolean;
	/**
	 * Choose this connection. Supplying it makes the chip a real toggle button; omitting it renders a
	 * non-interactive mark, because a control that does nothing when pressed is worse than a label.
	 */
	onSelect?: () => void;
	class?: string;
}
// #endregion

/** One connected service as an icon-first chip. */
export function ProviderChip(props: ProviderChipProps): JSX.Element {
	const {
		label,
		source,
		status,
		accountLabel = null,
		selected = false,
		disabled = false,
		onSelect,
		class: className,
	} = props;

	const sentence = providerStatusSentence(label, status, accountLabel);
	const tone = providerStatusTone(status);

	const inner = (
		<>
			<span class="prov-chip__mark" aria-hidden="true">
				{source ? <SourceMark source={source} size={22} /> : <Icon name="box" size="sm" />}
			</span>
			<span class="prov-chip__pip" aria-hidden="true">
				<Icon name={providerStatusMark(status)} size="2xs" />
			</span>
		</>
	);

	const chip = onSelect
		? (
			<button
				type="button"
				class={className ? `prov-chip ${className}` : "prov-chip"}
				data-tone={tone}
				// Preact DROPS `aria-pressed={false}` entirely, so a chip that was never selected would
				// ship without the attribute and read as a plain button. The string is rendered in both
				// states.
				aria-pressed={selected ? "true" : "false"}
				aria-label={sentence}
				disabled={disabled}
				onClick={onSelect}
			>
				{inner}
			</button>
		)
		: (
			<span
				class={className
					? `prov-chip prov-chip--static ${className}`
					: "prov-chip prov-chip--static"}
				data-tone={tone}
				role="img"
				aria-label={sentence}
			>
				{inner}
			</span>
		);

	return <Tooltip content={sentence}>{chip}</Tooltip>;
}
