import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { findInThreadShortcutLabel, isAppleDevice } from "@features/shell/core/shortcuts.ts";
import { openFinder } from "@features/shortcuts/core/shortcut-host.ts";
import { shortcutOn } from "@features/shortcuts/core/shortcut-registry.ts";

interface FindKeys {
	label: string;
	aria: string;
}

/**
 * ChatFindButton — a chat header's Find control (Decision #418): opens the thread's message finder,
 * as Ctrl/Cmd+F does, so the finder is reachable without a keyboard. Shows its keys in the tooltip
 * once hydrated, unless the reader switched the shortcut off.
 */
export function ChatFindButton(): JSX.Element {
	const keys = useSignal<FindKeys | null>(null);

	useEffect(() => {
		if (!shortcutOn("find-in-conversation")) return;
		const nav = globalThis.navigator;
		const apple = isAppleDevice(nav.platform || nav.userAgent);
		keys.value = { label: findInThreadShortcutLabel(apple), aria: apple ? "Meta+F" : "Control+F" };
	}, []);

	return (
		<Tooltip content="Find in conversation" shortcut={keys.value?.label} placement="bottom">
			<button
				type="button"
				class="chan-action"
				aria-label="Find in conversation"
				aria-keyshortcuts={keys.value?.aria}
				onClick={() => openFinder()}
			>
				<Icon name="search" size="md" />
			</button>
		</Tooltip>
	);
}
