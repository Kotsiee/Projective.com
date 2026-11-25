import type {
	ConnectionStatus,
	ConnectionsView,
	IntegrationProvider,
	ProviderKind,
	SaveS3Connection,
	UserConnection,
} from "@projective/types/integrations";
import { connectionIsRecoverable, connectionSupports } from "@projective/types/integrations";
import { withSettingsParam } from "./settings-url.ts";

/**
 * integrations-model — what Settings → Integrations shows and offers, decided without a DOM
 * (Decision #440). Every connection in the product starts here: the section groups the catalogue by
 * the capability a person came for, says what each provider's connection is, and offers the one
 * action that can work for it.
 *
 * A provider the catalogue switches off is absent rather than greyed out, unless a connection to it
 * still exists, which is kept so it can be taken back. A `revoked` or `disconnected` connection is
 * gone: its provider is offered as a fresh Connect.
 */

// #region Groups
/** The blocks of the section, each the anchor a trigger opens it on. */
export type IntegrationGroupKey = "storage" | "calendars" | "conferencing" | "other-services";

/** One block: which capability it lists, and the words above it. */
export interface IntegrationGroup {
	key: IntegrationGroupKey;
	/** The capability that places a provider here; `null` is every provider no other block lists. */
	kind: ProviderKind | null;
	title: string;
	description: string;
	/** What the block says when the catalogue offers nothing for it. */
	empty: string;
}

/** The blocks in reading order, matching the registry's `integrations.*` entries. */
export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = [
	{
		key: "storage",
		kind: "storage",
		title: "Cloud storage",
		description: "A connected drive is browsable in Files and stays read-only there.",
		empty: "No drive can be connected yet.",
	},
	{
		key: "calendars",
		kind: "calendar",
		title: "Calendars",
		description:
			"We read your main calendar and keep each event's title, times, repeat pattern, location, notes and meeting link, never its guests. Only you see those details, and they stay read-only here; anyone else who can see your calendar sees Busy. Turn on publishing and your Projective events also go to a separate Projective calendar there, which disconnecting removes, along with those details. Your own calendars are never changed, and an edit made on the Projective calendar is replaced by the next change here.",
		empty: "No calendar can be connected yet.",
	},
	{
		key: "conferencing",
		kind: "conferencing",
		title: "Video calls",
		description: "Sessions get their meeting room from the service connected here.",
		empty: "No video tool can be connected yet.",
	},
	{
		key: "other-services",
		kind: null,
		title: "Other services",
		description: "Services that are not a drive, a calendar or a video tool.",
		empty: "",
	},
];

const LISTED_KINDS: readonly ProviderKind[] = INTEGRATION_GROUPS
	.map((g) => g.kind)
	.filter((k): k is ProviderKind => k !== null);

function placedIn(capabilities: readonly ProviderKind[], group: IntegrationGroup): boolean {
	return group.kind === null
		? !capabilities.some((k) => LISTED_KINDS.includes(k))
		: capabilities.includes(group.kind);
}
// #endregion

// #region Rows
/** What a row's action button does: start a consent, start it again, or nothing (one is in flight). */
export type IntegrationConsent = "connect" | "reconnect" | "none";

/** A provider this account holds a live connection to. */
export interface ConnectedRow {
	state: "connected";
	connection: UserConnection;
	consent: IntegrationConsent;
	/** Whether this connection's separate Projective calendar can be switched here. */
	canPublish: boolean;
}

/** A provider this account can connect. */
export interface AvailableRow {
	state: "available";
	provider: IntegrationProvider;
}

export type IntegrationRow = ConnectedRow | AvailableRow;

function isGone(status: ConnectionStatus): boolean {
	return status === "revoked" || status === "disconnected";
}

/** The consent a connection's status allows. `pending` gets none: a second consent does not help. */
export function consentFor(status: ConnectionStatus): IntegrationConsent {
	if (status === "active" || status === "pending") return "none";
	return connectionIsRecoverable(status) ? "reconnect" : "connect";
}

function connectionCapabilities(c: UserConnection): ProviderKind[] {
	return [...new Set([...c.providerCapabilities, ...c.grantedKinds])];
}

/**
 * The rows one block lists: its live connections first, then the enabled providers it can still
 * connect, by the catalogue's order.
 *
 * `override` replaces the block's connections outright — the Dev Context Switcher's simulated
 * calendar — and its providers are not offered beside it.
 */
export function integrationRows(
	view: ConnectionsView,
	group: IntegrationGroup,
	override?: readonly UserConnection[] | null,
): IntegrationRow[] {
	const live = override ??
		view.connections.filter((c) => !isGone(c.status) && placedIn(connectionCapabilities(c), group));
	const held = new Set(live.map((c) => c.providerSlug));
	const connected: ConnectedRow[] = live.map((connection) => ({
		state: "connected",
		connection,
		// S3 has no consent screen: a pending row is a form left unfinished, so it offers the form again.
		consent: isUnfinishedS3(connection) ? "connect" : consentFor(connection.status),
		canPublish: group.kind === "calendar" && connectionSupports(connection, "calendar"),
	}));
	const available: AvailableRow[] = view.providers
		.filter((p) => p.isEnabled && placedIn(p.capabilities, group) && !held.has(p.slug))
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
		.map((provider) => ({ state: "available", provider }));
	return [...connected, ...available];
}

// #endregion

// #region S3 credential form
/** Whether a connection is an S3 connection whose credential form was opened and not finished. */
export function isUnfinishedS3(connection: UserConnection): boolean {
	return connection.providerSlug === "s3" && connection.status === "pending";
}

/** Where an S3 bucket lives: AWS, reached by assuming a role, or an S3-compatible endpoint, by key pair. */
export type S3Host = "aws" | "compatible";

/** The S3 credential form's fields, as typed. */
export interface S3Draft {
	host: S3Host;
	endpoint: string;
	region: string;
	bucket: string;
	prefix: string;
	pathStyle: boolean;
	roleArn: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/**
 * The save a draft makes (Decision #314): an AWS bucket names its role and sends no key; an
 * S3-compatible endpoint sends its key pair and names no role. The secret is sent as typed.
 */
export function s3SavePayload(connectionId: string, draft: S3Draft): SaveS3Connection {
	const aws = draft.host === "aws";
	return {
		connectionId,
		config: {
			endpoint: aws ? null : draft.endpoint.trim(),
			region: draft.region.trim(),
			bucket: draft.bucket.trim(),
			prefix: draft.prefix.trim(),
			pathStyle: !aws && draft.pathStyle,
			roleArn: aws ? draft.roleArn.trim() : null,
		},
		keys: aws
			? null
			: { accessKeyId: draft.accessKeyId.trim(), secretAccessKey: draft.secretAccessKey },
	};
}
// #endregion

// #region Consent round trip
/** The query parameter the consent callback marks its destination with. */
export const CONSENT_MARKER = "connect";

/** The longest return path the start door accepts (`StartConnectionSchema.returnTo`). */
export const RETURN_PATH_MAX = 400;

const CONSOLE_PATH = "/settings/integrations";

/**
 * Where a consent started from this section comes back to: the page it was started over, with the
 * modal reopened on Integrations, so closing it leaves the person where they were. On the console
 * the page itself is the section, so it comes back as it is.
 *
 * A same-origin PATH with no hash and no stale outcome marker. One too long for the start door
 * keeps only the page, then only the console.
 */
export function consentReturnPath(href: string, surface: "modal" | "page"): string {
	const url = new URL(href, "http://localhost");
	url.searchParams.delete(CONSENT_MARKER);
	const search = url.search;
	const here = `${url.pathname}${search}`;
	const full = surface === "modal" ? withSettingsParam(here, "integrations") : here;
	if (full.length <= RETURN_PATH_MAX) return full;
	const bare = surface === "modal" ? withSettingsParam(url.pathname, "integrations") : url.pathname;
	return bare.length <= RETURN_PATH_MAX ? bare : CONSOLE_PATH;
}

/** `href` (a `pathname?search#hash`) without the consent marker. */
export function withoutConsentMarker(href: string): string {
	const url = new URL(href, "http://localhost");
	url.searchParams.delete(CONSENT_MARKER);
	return `${url.pathname}${url.search}${url.hash}`;
}
// #endregion

// #region Words
/** The sentence a disconnect asks before it happens, naming what it takes away. */
export function disconnectWarning(connection: UserConnection): string {
	const at = connection.providerLabel;
	const calendar = connection.config?.outbound_calendar_id
		? " The separate Projective calendar there is deleted."
		: "";
	return `Projective stops using it and the permission is withdrawn at ${at} too.${calendar} Connecting again means granting it again.`;
}
// #endregion
