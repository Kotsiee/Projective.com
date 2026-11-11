import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";

/**
 * BoardEmptyColumn — an empty Kanban column's centred body: the drop hint and, where the viewer may
 * create a ticket in this column, a muted tier-5 ghost "Create ticket" beneath it (§B.8.1 — a column is
 * never given a filled or bordered button). The control opens the same composer the header's ＋ does,
 * pre-targeted to this column.
 */
export interface BoardEmptyColumnProps {
	/** The column's name, for the control's accessible name. */
	title: string;
	/** Present only where the viewer may create here. */
	onCreate?: () => void;
}

export function BoardEmptyColumn({ title, onCreate }: BoardEmptyColumnProps): JSX.Element {
	return (
		<>
			<span class="brd-dropzone">Drop tickets here</span>
			{onCreate
				? (
					<Button
						class="brd-dropzone__create"
						variant="text"
						size="sm"
						icon={<Icon name="plus" size="sm" aria-hidden />}
						label="Create ticket"
						aria-label={`Create a ticket in ${title}`}
						onPointerDown={(e: PointerEvent) => e.stopPropagation()}
						onClick={onCreate}
					/>
				)
				: null}
		</>
	);
}
