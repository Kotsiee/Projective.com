import type { JSX } from "preact";
import type { InspectorShellHost } from "../core/inspector-shell.ts";

/** Props for {@link InspectorLiveRegion}. */
export interface InspectorLiveRegionProps {
	shell: InspectorShellHost;
}

/** The polite live region that speaks the shell's announcements (zoom level, page change…). */
export function InspectorLiveRegion({ shell }: InspectorLiveRegionProps): JSX.Element {
	const announcement = shell.announcement.value;
	return (
		<div class="ui-visually-hidden" aria-live="polite" aria-atomic="true">
			{announcement ? <span key={announcement.id}>{announcement.message}</span> : null}
		</div>
	);
}
