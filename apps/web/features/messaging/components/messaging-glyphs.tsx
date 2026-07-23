import type { JSX, VNode } from "preact";

/**
 * messaging-glyphs — the `/messages` module's inline SVG glyph set. Following the shell's icon-agnostic
 * convention (`nav-icons.tsx` / `profile-glyphs.tsx`), {@link MessagingIcon} is a FUNCTION component that
 * returns a FRESH 24×24 `currentColor` line VNode per call — so the same glyph can render in the collapsed
 * rail AND the expanded stack without the Preact VNode-reuse hazard (no `cloneElement` needed). Every glyph
 * is `aria-hidden`; the control's label carries the accessible name.
 */

/** Every glyph the messaging module can render. */
export type MessagingIconName =
	| "search"
	| "compose"
	| "settings"
	| "filter"
	| "back"
	| "kebab"
	| "star"
	| "archive"
	| "unarchive"
	| "trash"
	| "mute"
	| "bell"
	| "pin"
	| "popout"
	| "maximize"
	| "members"
	| "addMember"
	| "chat"
	| "files"
	| "close"
	| "check"
	| "inbox"
	| "robot";

const PATHS: Record<MessagingIconName, VNode> = {
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.2-3.2" />
		</>
	),
	compose: (
		<>
			<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
			<path d="M13.5 6.5l3 3" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
		</>
	),
	filter: <path d="M4 5h16M7 12h10M10 19h4" />,
	back: <path d="M15 5l-7 7 7 7" />,
	kebab: (
		<>
			<circle cx="12" cy="5" r="1.4" />
			<circle cx="12" cy="12" r="1.4" />
			<circle cx="12" cy="19" r="1.4" />
		</>
	),
	star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9z" />,
	archive: (
		<>
			<rect x="3" y="4" width="18" height="5" rx="1" />
			<path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
		</>
	),
	unarchive: (
		<>
			<rect x="3" y="4" width="18" height="5" rx="1" />
			<path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M12 17v-5M9.5 14l2.5-2.5L14.5 14" />
		</>
	),
	trash: <path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
	mute: (
		<>
			<path d="M6 9a6 6 0 0 1 9.4-4.9M18 12v-2M6 9v3s-2 1-2 4h11" />
			<path d="M4 4l16 16" />
			<path d="M10 20a2 2 0 0 0 4 0" />
		</>
	),
	bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 21a2 2 0 0 0 4 0" />,
	pin: <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" />,
	popout: (
		<>
			<path d="M14 4h6v6M20 4l-8 8" />
			<path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
		</>
	),
	maximize: (
		<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
	),
	members: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6m1 8a6 6 0 0 0-3-5" />
		</>
	),
	addMember: (
		<>
			<circle cx="9" cy="8" r="3" />
			<path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" />
		</>
	),
	chat: <path d="M4 5h16v11H9l-4 3v-3H4z" />,
	files: <path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />,
	close: <path d="M6 6l12 12M18 6 6 18" />,
	check: <path d="M5 12l5 5 9-11" />,
	inbox: (
		<>
			<path d="M4 13l2.5-8h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
			<path d="M4 13h4a2 2 0 0 0 4 2 2 2 0 0 0 4-2h4" />
		</>
	),
	robot: (
		<>
			<rect x="5" y="8" width="14" height="10" rx="2" />
			<path d="M12 4v4M9 13v0M15 13v0M2 12v2M22 12v2" />
		</>
	),
};

/**
 * MessagingIcon — renders a messaging glyph by name. Stroke-based, `currentColor`, `aria-hidden`. Extra
 * SVG props (e.g. `class`) are forwarded to the root `<svg>`.
 */
export function MessagingIcon(
	{ name, ...svg }: { name: MessagingIconName } & JSX.SVGAttributes<SVGSVGElement>,
): VNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			{...svg}
		>
			{PATHS[name]}
		</svg>
	);
}
