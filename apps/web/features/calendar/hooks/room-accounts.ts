import { signal } from "@preact/signals";
import type { MeetingProvider } from "@projective/types/scheduling";
import type { ConnectionsView } from "@projective/types/integrations";
import { IntegrationsService } from "@web/features/files/core/IntegrationsService.ts";
import { readDevSeam } from "@web/utils/dev-seam.ts";
import { canMintOn } from "../core/meeting-link.ts";

/** Read on the first room section that asks. */
const view = signal<ConnectionsView | null>(null);
let asked = false;

function read(): void {
	void IntegrationsService.connections().then((res) => {
		if (res.ok && res.data) view.value = res.data;
	});
}

/**
 * Whether the viewer can have a room made on this provider. `unknown` until the read lands, or if it
 * fails: the composer then promises nothing either way. Reading `view` here re-renders the caller.
 */
export function roomAccount(provider: MeetingProvider): "unknown" | "connected" | "missing" {
	const forced = readDevSeam()?.conferencingConnection ?? "auto";
	if (forced !== "auto") return forced;
	if (!asked && globalThis.document) {
		asked = true;
		read();
		// A person connects in Settings, in another tab, so coming back has to notice.
		globalThis.addEventListener("focus", read);
	}
	const known = view.value;
	return !known ? "unknown" : canMintOn(provider, known) ? "connected" : "missing";
}
