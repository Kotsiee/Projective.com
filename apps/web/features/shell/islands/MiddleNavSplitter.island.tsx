import type { JSX } from "preact";
import {
	MiddleNavSplitter as Splitter,
	type MiddleNavSplitterProps,
} from "@projective/ui/navigation";

/** Hydration wrapper for the package's drag-resizable Blue-lane Splitter (DESIGN_SYSTEM.md Part D.2). */
export default function MiddleNavSplitter(props: MiddleNavSplitterProps): JSX.Element {
	return <Splitter {...props} />;
}
