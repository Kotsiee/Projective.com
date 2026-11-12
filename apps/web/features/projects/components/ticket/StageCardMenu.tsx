import type { JSX, RefObject } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { ActionMenu } from "@projective/ui/navigation";
import type { MenuItem } from "@ui/types/mod.ts";

/**
 * StageCardMenu — a stage card's `…` and its right-click menu: one {@link ActionMenu} for both, so
 * the two never offer different rows (Decision #222). It portals through `BodyPortal` and claims its
 * layer from `useOverlayStack`, which puts it above the ticket modal. The trigger stops its own press
 * and click, so opening the menu never starts a drag or selects the stage.
 */
export interface StageCardMenuProps {
	model: MenuItem[];
	/** The card the right-click opens on. */
	surface: RefObject<HTMLElement>;
	/** The menu's accessible name, e.g. "Actions for Design". */
	label: string;
}

const stop = (e: Event): void => e.stopPropagation();

export function StageCardMenu(props: StageCardMenuProps): JSX.Element {
	return (
		<div class="tkc-stage__menuslot">
			<ActionMenu
				model={props.model}
				surface={props.surface}
				placement="bottom-end"
				aria-label={props.label}
				trigger={(api) => (
					<Tooltip content={api.expanded ? "" : "Stage actions"}>
						<button
							type="button"
							ref={(el: HTMLButtonElement | null) => {
								api.ref.current = el;
							}}
							class="tkc-stage__menu"
							data-open={api.expanded ? "true" : undefined}
							aria-label={props.label}
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onPointerDown={stop}
							onClick={(e) => {
								stop(e);
								api.toggle();
							}}
						>
							<Icon name="kebab-horizontal" size="sm" />
						</button>
					</Tooltip>
				)}
			/>
		</div>
	);
}
