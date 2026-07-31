import type { JSX } from "preact";
import "../styles/inbox.css";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { LocalKeys, writeStored } from "@web/utils/storage-keys.ts";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { openNewConversation, settingsModalOpen } from "../core/messaging-state.ts";
import { type InboxDensity, inboxDensity } from "../core/inbox-state.ts";

/**
 * InboxFooter — the `/messages` ROOT footer band: **actions and density**, per the region contract.
 *
 * "New message" is a real, labelled primary button here rather than a 34px unlabelled icon in the
 * corner of the lane. That matters twice over: the surface's one primary action now reads as one, and
 * the body's empty state can point at something the viewer can actually see (it also offers its own
 * copy of the action, so the instruction and the control are never separated).
 *
 * Dumb: writes to `inbox-state` and the shared messaging-state signals; owns no data.
 */

const DENSITIES: ReadonlyArray<{ key: InboxDensity; label: string }> = [
	{ key: "comfortable", label: "Comfortable" },
	{ key: "compact", label: "Compact" },
];

export default function InboxFooter(): JSX.Element {
	function setDensity(next: InboxDensity): void {
		inboxDensity.value = next;
		writeStored("local", LocalKeys.MESSAGES_DENSITY, next);
	}

	return (
		<div class="inbox-foot">
			<div class="inbox-foot__density" role="group" aria-label="Row density">
				{DENSITIES.map((d) => (
					<button
						key={d.key}
						type="button"
						class="inbox-foot__density-opt"
						data-active={inboxDensity.value === d.key ? "true" : undefined}
						aria-pressed={inboxDensity.value === d.key}
						onClick={() => setDensity(d.key)}
					>
						{d.label}
					</button>
				))}
			</div>

			<div class="inbox-foot__actions">
				<Tooltip content="Message settings" placement="top">
					<Button
						variant="text"
						severity="secondary"
						iconOnly
						icon={<MessagingIcon name="settings" />}
						aria-label="Message settings"
						onClick={() => (settingsModalOpen.value = true)}
					/>
				</Tooltip>
				<Button
					label="New message"
					icon={<MessagingIcon name="compose" />}
					onClick={openNewConversation}
				/>
			</div>
		</div>
	);
}
