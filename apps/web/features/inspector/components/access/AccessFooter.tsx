import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { AccessSaveStatus } from "../../core/access-store.ts";

/** Props for {@link AccessFooter}. */
export interface AccessFooterProps {
	dirty: boolean;
	status: AccessSaveStatus;
	onSave: () => void;
	onRevert: () => void;
}

/**
 * The Access tab's last stop: what the last save did (a polite live region, assertive on a refusal),
 * whether anything is unsaved, Revert and Save changes. Pinned to the bottom of the panel while there is
 * something to save, so Save never scrolls out of view and a clean tab keeps the whole sheet.
 */
export function AccessFooter({ dirty, status, onSave, onRevert }: AccessFooterProps): JSX.Element {
	const busy = status.tone === "busy";
	const failed = status.tone === "error";
	return (
		<div
			class="ins-access__footer"
			role="group"
			aria-label="Save access changes"
			data-dirty={dirty ? "true" : undefined}
			data-tone={status.tone}
		>
			<div class="ins-access__footline">
				<p
					class="ins-access__status"
					data-tone={status.tone}
					role={failed ? "alert" : "status"}
					aria-live={failed ? "assertive" : "polite"}
				>
					{status.tone === "saved" ? <Icon name="check" size="xs" aria-hidden="true" /> : null}
					{failed ? <Icon name="warning" size="xs" aria-hidden="true" /> : null}
					{status.text}
				</p>
				<span class="ins-access__dirty">{dirty ? "Unsaved changes" : ""}</span>
			</div>
			<div class="ins-access__actions">
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					label="Revert"
					disabled={!dirty || busy}
					onClick={onRevert}
				/>
				<Button size="sm" label="Save changes" loading={busy} disabled={!dirty} onClick={onSave} />
			</div>
		</div>
	);
}
