import type { JSX } from "preact";
import {
	MiddleNavSplitter as Splitter,
	type MiddleNavSplitterProps,
} from "@projective/ui/navigation";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";

/**
 * Hydration wrapper for the package's drag-resizable Blue-lane Splitter (DESIGN_SYSTEM.md Part D.2).
 * Supplies the app's registered lane-width storage key so the portable package never hardcodes an
 * app key literal, and wires the shared collapse event so a lane's own footer toggle can shut/open the
 * rail. Callers may still override either via props.
 */
export default function MiddleNavSplitter(props: MiddleNavSplitterProps): JSX.Element {
	return (
		<Splitter
			storageKey={LocalKeys.MIDDLE_LANE_WIDTH}
			collapseEventName={MIDDLE_LANE_TOGGLE_EVENT}
			{...props}
		/>
	);
}
