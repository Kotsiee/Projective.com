import type { JSX } from "preact";
import "../styles/avatar.css";
import { cx } from "../../core/cx.ts";
import { Avatar } from "./Avatar.tsx";
import type { AvatarShape, AvatarSize } from "./Avatar.tsx";

// #region Types
/** One person in an {@link AvatarStack}. Structurally compatible with the app's party shapes. */
export interface AvatarStackPerson {
	name: string;
	/** Image URL; `null`/absent falls back to initials. */
	avatar?: string | null;
}

/** Props for {@link AvatarStack}. */
export interface AvatarStackProps {
	people: readonly AvatarStackPerson[];
	/** How many faces render before the rest collapse into `+N` (default 4). */
	max?: number;
	size?: AvatarSize;
	shape?: AvatarShape;
	/**
	 * What the separating ring is drawn in. Defaults to `var(--surface)`; pass the ancestor's own
	 * background when the stack sits on a tinted card, or the ring reads as a halo instead of a gap.
	 */
	ringColor?: string;
	/** Names the group for assistive tech; defaults to "N people: A, B, C". */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * AvatarStack — a cascading row of faces with a `+N` overflow chip.
 *
 * The data-driven counterpart to {@link AvatarGroup}, which takes `Avatar` children. A roster is
 * almost always an array in hand, and writing the map at every call site is how five surfaces ended
 * up with five different overlap ratios, ring colours and overflow labels.
 *
 * Accessibility is the other reason it exists: a stack of avatars is ONE fact ("who is on this"),
 * so the items are hidden from assistive tech and the group carries a single composed label. Read
 * item-by-item, the same markup announces a stream of disconnected initials.
 */
export function AvatarStack(props: AvatarStackProps): JSX.Element | null {
	const { people, max = 4, size = "sm", shape = "circle", ringColor, class: className } = props;
	if (people.length === 0) return null;

	const visible = people.slice(0, max);
	const overflow = people.length - visible.length;
	const label = props["aria-label"] ??
		`${people.length} ${people.length === 1 ? "person" : "people"}: ${
			people.map((p) => p.name).join(", ")
		}`;

	return (
		<div
			class={cx("ui-avatar-group", "ui-avatar-stack", className)}
			role="img"
			aria-label={label}
			style={ringColor ? `--avatar-ring:${ringColor}` : undefined}
		>
			{visible.map((p, i) => (
				<Avatar
					key={`${p.name}-${i}`}
					image={p.avatar ?? undefined}
					label={p.name}
					size={size}
					shape={shape}
				/>
			))}
			{overflow > 0
				? (
					<Avatar
						label={`+${overflow}`}
						size={size}
						shape={shape}
						class="ui-avatar-group__overflow"
					/>
				)
				: null}
		</div>
	);
}
