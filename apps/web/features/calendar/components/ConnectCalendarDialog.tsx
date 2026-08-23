import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ConnectionsView, UserConnection } from "@projective/types/integrations";
import { connectionIsRecoverable } from "@projective/types/integrations";
import { IntegrationsService } from "@web/features/files/core/IntegrationsService.ts";
import { simFromSeam as filesSimFromSeam } from "@web/features/files/core/files-seam.ts";
import {
	providerConsent,
	providerStatusSentence,
	providerStatusTone,
} from "@web/features/files/components/ProviderChip.tsx";
import { ProviderMark } from "./provider-marks.tsx";
import "../styles/calendar-chrome.css";

/**
 * ConnectCalendarDialog — the ONE place a calendar connection is started, and a deliberate mirror of
 * the `Connect a drive` dialog in `features/files/islands/FilesFooterRig.island.tsx`.
 *
 * Same structure, same words about the same distinction, the same
 * mark · label · chevron row — because they ARE the same act at two different capabilities, and a
 * second design for it would teach a reader that connecting a calendar is a different kind of thing
 * from connecting a drive. The connector substrate underneath is the shared one
 * (`IntegrationsService` → `/api/integrations/*` → `IntegrationsBackendService`); nothing here is
 * calendar-specific except the capability it filters on.
 *
 * Three rules carried over verbatim from that dialog, each of which cost something to learn:
 *
 *  - **Connect NAVIGATES, it never fetches.** A consent screen is something a person reads and
 *    agrees to; requesting it in the background asks the provider to authorise a grant the user
 *    never saw.
 *  - **A disabled provider is absent, not greyed out.** An affordance that cannot work is a promise
 *    the page cannot keep.
 *  - **The offer follows {@link connectionIsRecoverable}, not the status name.** `degraded` and
 *    `expired` offer *Reconnect*; `revoked`, `disconnected` and `error` offer a fresh *Connect*.
 *    Offering "reconnect" on a revoked grant implies a stored authorization that no longer exists
 *    and the retry then fails with nothing to explain it.
 */
export interface ConnectCalendarDialogProps {
	open: Signal<boolean>;
	/** Same-origin path the consent returns to. */
	returnTo: string;
}

export function ConnectCalendarDialog(props: ConnectCalendarDialogProps): JSX.Element {
	const view = useSignal<ConnectionsView | null>(null);
	const busy = useSignal(false);
	const notice = useSignal<string | null>(null);

	// Loaded on OPEN rather than on mount: the dialog is mounted by the footer rig on every
	// `/calendar` route, and fetching somebody's stored authorizations on every page load to fill a
	// modal they may never open is a request nobody asked for.
	useEffect(() => {
		if (!props.open.value || view.value) return;
		let cancelled = false;
		void (async () => {
			// The connector subsystem's own dev axis (`connectionState`) travels with the read. It is
			// the FILES seam because the connections domain belongs to `/files` — reading it here is
			// what lets a developer reach the degraded, expired and revoked branches of this dialog
			// without revoking a real grant. In production the seam tree-shakes out and this is
			// `undefined`, so the request is byte-identical to one from before it existed.
			const res = await IntegrationsService.connections(filesSimFromSeam());
			if (cancelled) return;
			if (res.ok && res.data) view.value = res.data;
			else notice.value = res.message ?? "Your connected calendars could not be loaded.";
		})();
		return () => {
			cancelled = true;
		};
	}, [props.open.value]);

	/**
	 * Begin an OAuth consent for a calendar connector.
	 *
	 * This is a SEPARATE grant from signing in with Google: GoTrue's sign-in retains no third-party
	 * API token, so somebody who signed in with Google has granted this platform no access to their
	 * calendar at all. `returnTo` is a same-origin PATH and is validated server-side — an
	 * attacker-chosen return URL would turn a consent screen into an open redirect wearing this
	 * domain's credibility.
	 */
	async function connect(slug: string): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		notice.value = null;
		const res = await IntegrationsService.start({ providerSlug: slug, returnTo: props.returnTo });
		busy.value = false;
		if (res.ok && res.data?.authorizeUrl) globalThis.location.assign(res.data.authorizeUrl);
		else notice.value = res.message ?? "That calendar could not be connected right now.";
	}

	const data = view.value;
	const connections: UserConnection[] = (data?.connections ?? []).filter((c) =>
		c.providerCapabilities.includes("calendar") || c.grantedKinds.includes("calendar")
	);
	const connectedSlugs = new Set(connections.map((c) => c.providerSlug));
	const available = (data?.providers ?? [])
		.filter((p) =>
			p.isEnabled && p.capabilities.includes("calendar") && !connectedSlugs.has(p.slug)
		)
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

	return (
		<Dialog visible={props.open} header="Connect a calendar" width="28rem">
			<p class="cal-connect__hint">
				Connecting is a separate permission from signing in — signing in with Google grants no
				access to your calendar. A connected calendar shows here as Busy or Available only, and what
				you have on it is never published.
			</p>

			{connections.length > 0
				? (
					<div class="cal-connect__group">
						<h3 class="cal-connect__grouptitle">Connected</h3>
						<ul class="cal-connect__list">
							{connections.map((c) => {
								const offer = providerConsent(c.status);
								return (
									<li class="cal-connect__row" key={c.id} data-tone={providerStatusTone(c.status)}>
										<span class="cal-connect__mark" aria-hidden="true">
											<ProviderMark source={c.providerSlug} size={20} />
										</span>
										<span class="cal-connect__body">
											<span class="cal-connect__name">{c.providerLabel}</span>
											<span class="cal-connect__state">
												{providerStatusSentence(
													c.providerLabel,
													c.status,
													c.externalAccountLabel,
												)}
											</span>
										</span>
										{offer === "none" ? null : (
											<button
												type="button"
												class="cal-connect__action"
												disabled={busy.value}
												onClick={() => void connect(c.providerSlug)}
											>
												{connectionIsRecoverable(c.status) ? "Reconnect" : "Connect again"}
											</button>
										)}
									</li>
								);
							})}
						</ul>
					</div>
				)
				: null}

			<div class="cal-connect__group">
				<h3 class="cal-connect__grouptitle">Available</h3>
				{available.length === 0
					? (
						<p class="cal-connect__empty" role="status">
							{data
								? "Every calendar this account can connect is already connected."
								: "Loading the calendars you can connect…"}
						</p>
					)
					: (
						<div class="cal-connect__providers">
							{available.map((p) => (
								<button
									key={p.slug}
									type="button"
									class="cal-connect__provider"
									disabled={busy.value}
									onClick={() => void connect(p.slug)}
								>
									<span class="cal-connect__mark" aria-hidden="true">
										<ProviderMark source={p.slug} size={20} />
									</span>
									<span class="cal-connect__providerlabel">{p.label}</span>
									{p.isBeta ? <span class="cal-connect__beta">Beta</span> : null}
									<Icon name="chevron-right" class="cal-connect__caret" />
								</button>
							))}
						</div>
					)}
			</div>

			{notice.value && <p class="cal-connect__error" role="status">{notice.value}</p>}
		</Dialog>
	);
}
