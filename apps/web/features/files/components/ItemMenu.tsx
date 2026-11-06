import type { JSX, Ref } from "preact";
import { ActionMenu, type ContextSurfaceSource, type MenuItem } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";

export interface ItemMenuProps {
	model: MenuItem[];
	/** The item's name, for the menu's accessible label. */
	label: string;
	/** The card these rows belong to: right-click on it opens the same menu. */
	surface: ContextSurfaceSource;
}

/** ItemMenu — a grid item's kebab and right-click menu, the card twin of a table row's. */
export function ItemMenu({ model, label, surface }: ItemMenuProps): JSX.Element {
	return (
		<ActionMenu
			model={model}
			aria-label={`Actions for ${label}`}
			surface={surface}
			trigger={(api) => (
				<button
					ref={api.ref as Ref<HTMLButtonElement>}
					type="button"
					class="fh-kebab"
					data-fh-nodrag=""
					aria-label={`Actions for ${label}`}
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.expanded ? api.panelId : undefined}
					onClick={api.toggle}
				>
					<Icon name="kebab" size="sm" />
				</button>
			)}
		/>
	);
}
