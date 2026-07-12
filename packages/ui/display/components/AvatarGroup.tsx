import type { ComponentChildren, JSX } from "preact";
import { toChildArray } from "preact";
import "../styles/avatar.css";
import { cx } from "../../core/cx.ts";
import { Avatar } from "./Avatar.tsx";
import type { AvatarShape, AvatarSize } from "./Avatar.tsx";

export interface AvatarGroupProps {
	/** {@link Avatar} elements to stack. */
	children?: ComponentChildren;
	/** Cap the number of visible avatars; the remainder collapses into a `+N` overflow chip. */
	max?: number;
	/** Size/shape applied to the synthetic overflow chip so it matches the group's own avatars. */
	size?: AvatarSize;
	shape?: AvatarShape;
	class?: string;
}

/**
 * AvatarGroup — an overlapping stack of {@link Avatar}s (each ringed with the surface colour so the
 * overlap reads cleanly). When `max` is set, avatars beyond the cap collapse into a trailing `+N`
 * chip rendered as another Avatar. Zero client JS.
 */
export function AvatarGroup(props: AvatarGroupProps): JSX.Element {
	const { children, max, size, shape, class: className } = props;
	const items = toChildArray(children);
	const visible = max !== undefined ? items.slice(0, max) : items;
	const overflow = max !== undefined ? Math.max(0, items.length - max) : 0;

	return (
		<div class={cx("ui-avatar-group", className)} role="group">
			{visible}
			{overflow > 0 && (
				<Avatar
					label={`+${overflow}`}
					size={size}
					shape={shape}
					class="ui-avatar-group__overflow"
					aria-label={`${overflow} more`}
				/>
			)}
		</div>
	);
}
