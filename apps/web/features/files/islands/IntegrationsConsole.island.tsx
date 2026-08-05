import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carrier
import "../styles/integrations-console.css";
// #endregion

import { Button } from "@projective/ui/fields";
import { Alert } from "@projective/ui/feedback";
import { Dialog } from "@projective/ui/feedback";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";

import {
	connectionIsRecoverable,
	type ConnectionStatus,
	type ConnectionsView,
	type IntegrationProvider,
	type ProviderKind,
	type UserConnection,
} from "@projective/types/integrations";
import { IntegrationsService } from "../core/IntegrationsService.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import type { FilesSim } from "../types/file-types.ts";

/**
 * IntegrationsConsole — Settings → Integrations: what this account has authorized at other services,
 * and what it could.
 *
 * The first producer of the already-designed {@link ConnectionsView} shape, and the surface that makes
 * a connection a thing a person can see and take back. It reads the SSR payload as props and refines
 * through the thin {@link IntegrationsService}; it never touches Supabase and never sees a token.
 *
 * ## Authentication is not authorization, and the page says so
 *
 * Signing in with Google is not the same act as letting the platform read a Google Drive: the sign-in
 * OAuth keeps no API token, and a connection is a separate, revocable consent. So a provider the
 * person signs in WITH still appears here as unconnected until they connect it, and the copy does not
 * imply otherwise. Conflating the two is how a product ends up holding a scope nobody remembers
 * granting.
 *
 * ## Two capability axes, never one chip set
 *
 * Calendar sync and conferencing are separate: a person may sync a Google calendar and host on Zoom.
 * The service resolves `hasCalendar` and `hasConferencing` independently and this console shows them
 * independently, because a booking surface that assumed the calendar provider could mint a room would
 * offer a meeting link it cannot produce.
 *
 * ## Connect NAVIGATES; it does not fetch
 *
 * `start` answers with the provider's authorize URL, and the browser is sent there. A consent screen
 * is something a person reads and agrees to — fetching it in the background would be asking the
 * provider to authorise a grant the user never saw. The `returnTo` is a same-origin PATH, validated
 * server-side; an absolute URL is refused there rather than honoured, because an attacker-chosen
 * return target turns a consent screen into an open redirect wearing this domain's credibility.
 *
 * ## Disconnect is confirmed, and it is terminal
 *
 * Revocation cannot be undone by clicking again — reconnecting requires fresh consent — so it asks
 * first, and the confirm names the provider and the account rather than saying "this connection". The
 * server also revokes at the far end: leaving a token valid at the provider after the user asked us to
 * forget it is the one failure they would never find out about.
 */

// #region Props
export interface IntegrationsConsoleProps {
	/** The SSR-resolved payload — the catalogue, the caller's connections, the capability projections. */
	initial: ConnectionsView;
	/**
	 * The path a consent round trip returns to. Threaded from the route rather than read from
	 * `location` so the FIRST connect works identically before hydration settles.
	 */
	returnTo: string;
	/** The coarse consent marker the callback redirected with, if this page was arrived at that way. */
	outcome: "connected" | "failed" | null;
}
// #endregion

// #region Vocabulary
/**
 * What a status means to the PERSON, not to the state machine.
 *
 * `expired` and `degraded` are deliberately phrased as things they can fix, because they are: both
 * are recoverable by reconnecting. `revoked` and `disconnected` are phrased as finished, because
 * re-arming them needs fresh consent rather than a retry.
 */
function statusLabel(status: ConnectionStatus): string {
	switch (status) {
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

/** The tone a status is drawn in — `ok` · `warn` · `off`, resolved once so the chip and the row agree. */
function statusTone(status: ConnectionStatus): "ok" | "warn" | "off" {
	if (status === "active") return "ok";
	if (status === "pending" || connectionIsRecoverable(status)) return "warn";
	return "off";
}

/** Plain-language name for a capability. The enum member is a column name, not a sentence. */
function kindLabel(kind: ProviderKind): string {
	switch (kind) {
		case "calendar":
			return "Calendar";
		case "conferencing":
			return "Meetings";
		case "freebusy":
			return "Free/busy";
		case "storage":
			return "Files";
		case "docs":
			return "Documents";
		case "contacts":
			return "Contacts";
		case "code":
			return "Code";
		case "issues":
			return "Issues";
		case "crm":
			return "CRM";
		case "messaging":
			return "Messaging";
		case "identity":
			return "Sign-in";
		case "payments":
			return "Payments";
	}
}
// #endregion

export default function IntegrationsConsole(props: IntegrationsConsoleProps): JSX.Element {
	const { initial, returnTo, outcome } = props;

	// #region State
	/**
	 * The payload on screen.
	 *
	 * There is deliberately no `seeded` flag here, and this is the one surface where its absence is
	 * right: the SSR payload is a real answer rather than a placeholder, so this page is never in a
	 * "not loaded" state and has no emptiness to disambiguate. Zero connections is a fact, and it is
	 * the fact most accounts start with.
	 */
	const view = useSignal<ConnectionsView>(initial);
	/** A refresh or a revoke is in flight. */
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	/** The connection a disconnect has been asked about; `null` closes the confirm. */
	const pendingRevoke = useSignal<UserConnection | null>(null);
	const confirmOpen = useSignal(false);
	/** The provider slug a consent is being started for — disables just that row's button. */
	const starting = useSignal<string | null>(null);

	/**
	 * The developer simulation overlay.
	 *
	 * A `ref`, not a signal: it is read inside callbacks and never rendered, and a signal read during
	 * a later render would subscribe this component to a value that changes nothing about its output.
	 */
	const simRef = useRef<FilesSim | undefined>(undefined);
	// #endregion

	// #region Reads
	/** Re-read the payload. Never silent: a failure is reported beside the data it failed to refresh. */
	async function refresh(): Promise<void> {
		busy.value = true;
		const res = await IntegrationsService.connections(simRef.current);
		busy.value = false;
		if (res.ok && res.data) {
			view.value = res.data;
			error.value = null;
		} else {
			// No bare `if (ok)` — a refetch with no else leaves the previous payload on screen while the
			// person believes they are looking at the result of what they just did.
			error.value = res.message ?? "Your connections could not be refreshed.";
		}
	}

	useEffect(() => {
		simRef.current = simFromSeam();
		const unsubscribe = subscribeFilesSim((sim) => {
			simRef.current = sim;
			// The connection-state axis is SERVER-derived, so a re-render would only relabel the same rows.
			void refresh();
		});
		return unsubscribe;
	}, []);
	// #endregion

	// #region Actions
	/** Begin a consent and hand the browser to the provider (see the module note — this is not a fetch). */
	async function connect(slug: string): Promise<void> {
		if (starting.value) return;
		starting.value = slug;
		error.value = null;
		const res = await IntegrationsService.start({ providerSlug: slug, returnTo });
		if (res.ok && res.data) {
			globalThis.location.assign(res.data.authorizeUrl);
			// Deliberately NOT clearing `starting`: the page is navigating away, and re-enabling the
			// button in the frames before it does invites a second consent for the same provider.
			return;
		}
		starting.value = null;
		error.value = res.message ?? "That connection could not be started.";
	}

	async function revoke(connection: UserConnection): Promise<void> {
		confirmOpen.value = false;
		pendingRevoke.value = null;
		busy.value = true;
		const res = await IntegrationsService.revoke({ connectionId: connection.id });
		busy.value = false;
		if (!res.ok) {
			error.value = res.message ?? "That connection could not be revoked.";
			return;
		}
		error.value = null;
		// Re-read rather than splice the row out locally: revocation can cascade (a provider that carried
		// both calendar and conferencing changes two capability projections), and the server's answer is
		// the one that should be on screen.
		await refresh();
	}

	function askRevoke(connection: UserConnection): void {
		pendingRevoke.value = connection;
		confirmOpen.value = true;
	}
	// #endregion

	// #region Derived
	const connections = view.value.connections;
	const connectedSlugs = new Set(
		connections.filter((c) => c.status !== "revoked" && c.status !== "disconnected")
			.map((c) => c.providerSlug),
	);
	/**
	 * The catalogue rows worth offering.
	 *
	 * A disabled provider is hidden rather than shown greyed out: `isEnabled: false` means the platform
	 * has not finished wiring the adapter, and an affordance that cannot work is a promise the page
	 * cannot keep. A provider already connected is not re-offered — its row lives above.
	 */
	const available = view.value.providers
		.filter((p) => p.isEnabled && !connectedSlugs.has(p.slug))
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

	const target = pendingRevoke.value;
	// #endregion

	return (
		<div class="ints">
			<header class="ints__head">
				<h1 class="ints__title">Integrations</h1>
				<p class="ints__lede">
					Services you have given this account permission to use on your behalf. Signing in with a
					service is not the same as connecting it — a connection is granted here, and can be taken
					back here.
				</p>
			</header>

			{outcome === "connected"
				? (
					<Alert severity="success" variant="subtle" class="ints__banner">
						Connected. It may take a moment before everything it can reach shows up.
					</Alert>
				)
				: null}
			{outcome === "failed"
				? (
					<Alert severity="warning" variant="subtle" class="ints__banner">
						That connection was not completed. Nothing was changed — you can try again below.
					</Alert>
				)
				: null}

			{error.value
				? (
					<p class="ints__error" role="alert">
						<Icon name="warning" size="2xs" aria-hidden="true" />
						<span>{error.value}</span>
						<Button variant="text" size="sm" label="Retry" onClick={() => void refresh()} />
					</p>
				)
				: null}

			<section class="ints__section" aria-labelledby="ints-capabilities">
				<h2 class="ints__h" id="ints-capabilities">What this unlocks today</h2>
				<ul class="ints-caps">
					<CapabilityRow
						label="Calendar sync"
						on={view.value.hasCalendar}
						onNote="Your availability reads from a connected calendar."
						offNote="Connect a calendar and your working hours stop being guesswork."
					/>
					<CapabilityRow
						label="Meeting links"
						on={view.value.hasConferencing}
						onNote={view.value.activeConferencingProvider
							? `New sessions get a room from ${view.value.activeConferencingProvider}.`
							: "New sessions get a meeting room automatically."}
						offNote="Connect a conferencing service to have session rooms created for you."
					/>
				</ul>
			</section>

			<section class="ints__section" aria-labelledby="ints-connected">
				<h2 class="ints__h" id="ints-connected">
					Connected
					{connections.length > 0 ? <span class="ints__count">{connections.length}</span> : null}
				</h2>

				{connections.length === 0
					? (
						<p class="ints__empty" role="status">
							Nothing is connected yet. Everything below is optional — the platform works without
							any of it.
						</p>
					)
					: (
						<ul class="ints-list">
							{connections.map((connection) => (
								<li key={connection.id} class="ints-row" data-tone={statusTone(connection.status)}>
									<span class="ints-row__mark" aria-hidden="true">
										<Icon name="link" size="sm" />
									</span>

									<div class="ints-row__body">
										<p class="ints-row__name">
											{connection.providerLabel}
											<span class="ints-row__status" data-tone={statusTone(connection.status)}>
												{statusLabel(connection.status)}
											</span>
										</p>
										<p class="ints-row__account">
											{connection.externalAccountLabel ?? "Linked account"}
										</p>
										<ul class="ints-kinds" aria-label="What this connection can do">
											{connection.grantedKinds.map((kind) => (
												<li key={kind} class="ints-kind">{kindLabel(kind)}</li>
											))}
										</ul>
										{connection.lastError
											? (
												<p class="ints-row__why">
													{
														/* The provider's own words, not ours — a paraphrase of somebody
													    else's failure is how a person ends up debugging the wrong thing. */
													}
													{connection.lastError}
												</p>
											)
											: null}
									</div>

									<div class="ints-row__actions">
										{connectionIsRecoverable(connection.status)
											? (
												<Button
													variant="outlined"
													size="sm"
													label="Reconnect"
													disabled={starting.value !== null}
													onClick={() => void connect(connection.providerSlug)}
												/>
											)
											: null}
										<Tooltip content={`Disconnect ${connection.providerLabel}`}>
											<Button
												variant="text"
												size="sm"
												severity="danger"
												label="Disconnect"
												disabled={busy.value}
												onClick={() =>
													askRevoke(connection)}
											/>
										</Tooltip>
									</div>
								</li>
							))}
						</ul>
					)}
			</section>

			<section class="ints__section" aria-labelledby="ints-available">
				<h2 class="ints__h" id="ints-available">Available</h2>
				{available.length === 0
					? (
						<p class="ints__empty" role="status">
							Everything available is already connected.
						</p>
					)
					: (
						<ul class="ints-grid">
							{available.map((provider) => (
								<ProviderCard
									key={provider.slug}
									provider={provider}
									busy={starting.value === provider.slug}
									disabled={starting.value !== null}
									onConnect={() => void connect(provider.slug)}
								/>
							))}
						</ul>
					)}
			</section>

			<Dialog
				visible={confirmOpen}
				role="alertdialog"
				header="Disconnect this service?"
				width="min(28rem, 92vw)"
				onVisibleChange={(open) => {
					if (!open) pendingRevoke.value = null;
				}}
				footerTemplate={() => (
					<div class="ints-confirm__foot">
						<Button
							variant="text"
							label="Keep it"
							onClick={() => {
								confirmOpen.value = false;
								pendingRevoke.value = null;
							}}
						/>
						<Button
							variant="filled"
							severity="danger"
							label="Disconnect"
							onClick={() => {
								if (target) void revoke(target);
							}}
						/>
					</div>
				)}
			>
				<p class="ints-confirm__body">
					{target
						? `Projective will stop using ${target.providerLabel}${
							target.externalAccountLabel ? ` (${target.externalAccountLabel})` : ""
						}, and the permission is withdrawn at ${target.providerLabel} too. Connecting again later means granting it again.`
						: ""}
				</p>
			</Dialog>
		</div>
	);
}

// #region Pieces
interface CapabilityRowProps {
	label: string;
	on: boolean;
	onNote: string;
	offNote: string;
}

/**
 * One capability line.
 *
 * The state is carried by the WORD as well as the mark and the tone, so it survives a reader who
 * cannot separate the two colours — the mark is redundant, never the only channel.
 */
function CapabilityRow({ label, on, onNote, offNote }: CapabilityRowProps): JSX.Element {
	return (
		<li class="ints-cap" data-on={on || undefined}>
			<span class="ints-cap__mark" aria-hidden="true">
				<Icon name={on ? "success" : "minus"} size="xs" />
			</span>
			<div class="ints-cap__body">
				<p class="ints-cap__label">
					{label}
					<span class="ints-cap__state">{on ? "On" : "Off"}</span>
				</p>
				<p class="ints-cap__note">{on ? onNote : offNote}</p>
			</div>
		</li>
	);
}

interface ProviderCardProps {
	provider: IntegrationProvider;
	busy: boolean;
	disabled: boolean;
	onConnect: () => void;
}

/** One offerable provider. */
function ProviderCard({ provider, busy, disabled, onConnect }: ProviderCardProps): JSX.Element {
	return (
		<li class="ints-card">
			<div class="ints-card__head">
				<p class="ints-card__name">
					{provider.label}
					{provider.isBeta ? <span class="ints-card__beta">Beta</span> : null}
				</p>
				{provider.docsUrl
					? (
						<a
							class="ints-card__docs"
							href={provider.docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`About connecting ${provider.label} (opens in a new tab)`}
						>
							<Icon name="external-link" size="2xs" aria-hidden="true" />
						</a>
					)
					: null}
			</div>
			<ul class="ints-kinds" aria-label={`What ${provider.label} can do`}>
				{provider.capabilities.map((kind) => <li key={kind} class="ints-kind">{kindLabel(kind)}
				</li>)}
			</ul>
			<Button
				variant="outlined"
				size="sm"
				label={busy ? "Opening…" : "Connect"}
				disabled={disabled}
				onClick={onConnect}
			/>
		</li>
	);
}
// #endregion
