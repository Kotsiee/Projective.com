import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { SourceMark } from "./file-hub-glyphs.tsx";
import { IntegrationsService } from "../core/IntegrationsService.ts";
import { providerSource } from "../core/asset-model.ts";
import { postFiles } from "../core/api.ts";
import type { AssetSource } from "../types/file-types.ts";

/** One storage provider this account can connect right now, as the catalogue describes it. */
interface DriveOffer {
	slug: string;
	label: string;
	source: AssetSource;
}

/** Props for {@link ConnectDriveDialog}. */
export interface ConnectDriveDialogProps {
	visible: Signal<boolean>;
	/** The same-origin path the consent screen returns to. */
	returnTo: string;
}

/**
 * ConnectDriveDialog — the `/files` footer rig's "Connect a drive" step: the enabled storage providers
 * this account has not connected yet, each starting its own OAuth consent.
 *
 * The catalogue is read on OPEN, not on mount: the rig renders on every `/files` route, and reading
 * someone's stored authorizations to fill a dialog they may never open is a request nobody asked for.
 * Connecting is a SEPARATE grant from signing in with Google — GoTrue's sign-in retains no third-party
 * token — and `returnTo` is validated server-side so the consent screen cannot become an open redirect.
 */
export function ConnectDriveDialog({ visible, returnTo }: ConnectDriveDialogProps): JSX.Element {
	/**
	 * `null` until the catalogue has answered, then the offers plus whether the catalogue offers ANY —
	 * an empty list means "all connected" or "none offered", and the dialog must not say one when the
	 * other is true.
	 */
	const drives = useSignal<{ offers: DriveOffer[]; anyOffered: boolean } | null>(null);
	const notice = useSignal<string | null>(null);
	const busy = useSignal(false);

	useSignalEffect(() => {
		if (!visible.value || drives.peek()) return;
		let cancelled = false;
		notice.value = null;
		void (async () => {
			const res = await IntegrationsService.connections();
			if (cancelled) return;
			if (!res.ok || !res.data) {
				notice.value = res.message ?? "The drives you can connect could not be loaded.";
				return;
			}
			const connected = new Set(
				res.data.connections.filter((c) => c.status !== "revoked" && c.status !== "disconnected")
					.map((c) => c.providerSlug),
			);
			const storage = res.data.providers.filter((p) =>
				p.isEnabled && p.capabilities.includes("storage")
			);
			drives.value = {
				anyOffered: storage.length > 0,
				offers: storage.filter((p) => !connected.has(p.slug))
					.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
					.map((p) => ({ slug: p.slug, label: p.label, source: providerSource(p.slug) })),
			};
		})();
		return () => {
			cancelled = true;
		};
	});

	async function connect(slug: string): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		const res = await postFiles<{ state: string; authorizeUrl: string; expiresAt: string }>(
			"/api/integrations/start",
			{ providerSlug: slug, returnTo },
		);
		busy.value = false;
		if (res.ok && res.data?.authorizeUrl) {
			globalThis.location.assign(res.data.authorizeUrl);
		} else {
			notice.value = res.message ?? "That drive could not be connected right now.";
		}
	}

	const offered = drives.value;

	return (
		<Dialog visible={visible} header="Connect a drive" width="28rem">
			<p class="fh-rig__hint">
				Connecting is a separate permission from signing in — signing in with Google grants no
				access to your Drive. A connected drive is browsable here and stays read-only.
			</p>
			{offered && offered.offers.length > 0
				? (
					<div class="fh-rig__providers">
						{offered.offers.map((p) => (
							<button
								key={p.slug}
								type="button"
								class="fh-rig__provider"
								disabled={busy.value}
								onClick={() => void connect(p.slug)}
							>
								<span class="fh-rig__provider-mark" aria-hidden="true">
									<SourceMark source={p.source} size={20} />
								</span>
								<span class="fh-rig__provider-label">{p.label}</span>
								<Icon name="chevron-right" class="fh-rig__provider-caret" />
							</button>
						))}
					</div>
				)
				: (
					<p class="fh-rig__hint" role="status">
						{offered === null
							? notice.value ? null : "Loading the drives you can connect…"
							: offered.anyOffered
							? "Every drive this account can connect is already connected."
							: "No drives can be connected yet."}
					</p>
				)}
			{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
		</Dialog>
	);
}
