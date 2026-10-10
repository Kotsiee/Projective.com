import type { Signal } from "@preact/signals";
import type { JSX, Ref } from "preact";
import { Kbd } from "@projective/ui/utils";
import type { ViewerShortcut } from "../viewers/viewer.ts";

/** Props for {@link ShortcutsDisclosure}. */
export interface ShortcutsDisclosureProps {
	shortcuts: readonly ViewerShortcut[];
	open: Signal<boolean>;
	summaryRef: Ref<HTMLElement>;
}

/** The keyboard shortcuts, folded away until asked for (`?` opens and focuses it). */
export function ShortcutsDisclosure(props: ShortcutsDisclosureProps): JSX.Element | null {
	const { shortcuts, open, summaryRef } = props;
	if (shortcuts.length === 0) return null;
	return (
		<details
			class="ins-shortcuts"
			open={open.value}
			onToggle={(e) => (open.value = e.currentTarget.open)}
		>
			<summary ref={summaryRef} class="ins-shortcuts__summary">
				<span>Keyboard shortcuts</span>
			</summary>
			<dl class="ins-shortcuts__list">
				{shortcuts.map((s) => (
					<div class="ins-shortcuts__row" key={`${s.keys.join("+")}-${s.label}`}>
						<dt class="ins-shortcuts__keys">
							<Kbd keys={s.keys} size="sm" />
						</dt>
						<dd class="ins-shortcuts__label">{s.label}</dd>
					</div>
				))}
			</dl>
		</details>
	);
}
