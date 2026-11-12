import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { LaneSearch, type LaneSearchProps } from "@projective/ui/navigation";
import { isAppleDevice, laneSearchShortcutLabel } from "@features/shell/core/shortcuts.ts";
import { shortcutOn } from "../core/shortcut-registry.ts";
import { useSearchTarget } from "../hooks/useSearchTarget.ts";

/** Props for {@link LaneSearchField}: a {@link LaneSearch} whose ref and hint the field supplies. */
export type LaneSearchFieldProps = Omit<LaneSearchProps, "inputRef" | "hint">;

/**
 * LaneSearchField — a middle-nav lane's {@link LaneSearch}, offered to Ctrl/Cmd+Shift+/ (Decision
 * #418) with its key hint once hydrated, platform-spelled and dropped when the reader switched the
 * shortcut off. Every lane renders its search through this rather than `LaneSearch` directly.
 */
export function LaneSearchField(props: LaneSearchFieldProps): JSX.Element {
	const inputRef = useRef<HTMLInputElement>(null);
	const hint = useSignal<string | undefined>(undefined);
	useSearchTarget({ role: "lane", scopeRef: inputRef });

	useEffect(() => {
		if (!shortcutOn("focus-lane-search")) return;
		const nav = globalThis.navigator;
		hint.value = laneSearchShortcutLabel(isAppleDevice(nav.platform || nav.userAgent));
	}, []);

	return <LaneSearch {...props} inputRef={inputRef} hint={hint.value} />;
}
