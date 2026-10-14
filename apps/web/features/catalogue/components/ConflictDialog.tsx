import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { conflictPrompt, overwriteWithMine, reloadTheirs } from "../core/workspace-store.ts";

/**
 * ConflictDialog — the choice a stale save forces: this listing was saved somewhere else since this
 * tab loaded it. "Reload theirs" discards the edits here; "Overwrite with mine" saves them over the
 * other copy. Both lose someone's work, so dismissing (Escape, the backdrop, ×) chooses neither:
 * the conflict stays, nothing saves, and the header offers the choice again.
 */
export function ConflictDialog(): JSX.Element {
	const busy = useSignal<"theirs" | "mine" | null>(null);

	async function choose(which: "theirs" | "mine"): Promise<void> {
		if (busy.peek()) return;
		busy.value = which;
		try {
			await (which === "theirs" ? reloadTheirs() : overwriteWithMine());
			conflictPrompt.value = false;
		} finally {
			busy.value = null;
		}
	}

	return (
		<Dialog
			visible={conflictPrompt}
			role="alertdialog"
			header="This listing changed somewhere else"
			width="min(30rem, calc(100vw - 2rem))"
			footer={
				<div class="cat-ws__dialog-actions">
					<Button
						label="Reload theirs"
						severity="neutral"
						variant="outlined"
						loading={busy.value === "theirs"}
						disabled={busy.value !== null}
						onClick={() => void choose("theirs")}
					/>
					<Button
						label="Overwrite with mine"
						loading={busy.value === "mine"}
						disabled={busy.value !== null}
						onClick={() => void choose("mine")}
					/>
				</div>
			}
		>
			<p class="cat-ws__dialog-text">
				It was saved in another tab or by someone else after you opened it. Reload to see their
				version and lose your unsaved changes here, or overwrite it with yours.
			</p>
		</Dialog>
	);
}
