import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { LaneSearch, type LaneSearchProps } from "@projective/ui/navigation";
import { useSearchTarget } from "../hooks/useSearchTarget.ts";

/** Props for {@link LaneSearchField}: a {@link LaneSearch} whose ref the field supplies. */
export type LaneSearchFieldProps = Omit<LaneSearchProps, "inputRef">;

/**
 * LaneSearchField — a middle-nav lane's {@link LaneSearch}, offered to Ctrl/Cmd+Shift+/ (Decision
 * #418). Every lane renders its search through this rather than `LaneSearch` directly.
 */
export function LaneSearchField(props: LaneSearchFieldProps): JSX.Element {
	const inputRef = useRef<HTMLInputElement>(null);
	useSearchTarget({ role: "lane", scopeRef: inputRef });

	return <LaneSearch {...props} inputRef={inputRef} />;
}
