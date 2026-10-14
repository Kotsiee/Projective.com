import type { JSX } from "preact";
import { Dialog } from "../../../feedback/islands/Dialog.tsx";
import { useScheduler } from "./context.ts";
import { SHORTCUTS } from "./keymap.ts";

/** The keyboard and pointer map (plan §5.4) in a `Dialog`; `?` opens it. */
export function ShortcutSheet(): JSX.Element {
	const { store } = useScheduler();
	return (
		<Dialog
			visible={store.shortcutsOpen}
			header="Scheduler shortcuts"
			width="32rem"
			class="ui-avsched__sheet"
		>
			<dl class="ui-avsched__keys">
				{SHORTCUTS.map((row) => (
					<div class="ui-avsched__key" key={row.keys}>
						<dt class="ui-avsched__key-combo">{row.keys}</dt>
						<dd class="ui-avsched__key-action">{row.action}</dd>
					</div>
				))}
			</dl>
		</Dialog>
	);
}
