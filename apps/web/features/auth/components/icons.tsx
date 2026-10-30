import type { JSX } from "preact";

/**
 * Inline stroke icons for the auth surface — dependency-free (no icon package in the island bundle),
 * `currentColor`-driven so they inherit token colours. 24×24 viewBox, 2px stroke.
 */
import { IconShell } from "@projective/ui/icons";

type IconProps = { class?: string };

/** The Google "G" lives with every other brand mark; re-exported under the auth surface's name. */
export { GoogleMark as GoogleGlyph } from "@features/shell/components/brand-marks.tsx";

function svg(path: JSX.Element, extra?: IconProps): JSX.Element {
	return <IconShell class={extra?.class} focusable="false">{path}</IconShell>;
}

export const MailIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="m3 7 9 6 9-6" />
		</>,
		p,
	);

export const LockIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="4" y="11" width="16" height="9" rx="2" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</>,
		p,
	);

export const UserIcon = (p?: IconProps) =>
	svg(
		<>
			<circle cx="12" cy="8" r="4" />
			<path d="M4 20a8 8 0 0 1 16 0" />
		</>,
		p,
	);

export const AtIcon = (p?: IconProps) =>
	svg(
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
		</>,
		p,
	);

export const CalendarIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="3" y="4" width="18" height="17" rx="2" />
			<path d="M3 9h18M8 2v4M16 2v4" />
		</>,
		p,
	);

export const PhoneIcon = (p?: IconProps) =>
	svg(
		<path d="M5 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" />,
		p,
	);

export const BuildingIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="4" y="3" width="16" height="18" rx="1.5" />
			<path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" />
		</>,
		p,
	);

export const IdIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="M7 9h4M7 13h6M15 9h2v4h-2z" />
		</>,
		p,
	);

export const PinIcon = (p?: IconProps) =>
	svg(
		<>
			<path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11Z" />
			<circle cx="12" cy="10" r="2.5" />
		</>,
		p,
	);

export const BriefcaseIcon = (p?: IconProps) =>
	svg(
		<>
			<rect x="3" y="7" width="18" height="13" rx="2" />
			<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
		</>,
		p,
	);

export const CartIcon = (p?: IconProps) =>
	svg(
		<>
			<path d="M3 4h2l2.4 12.3a1 1 0 0 0 1 .7h8.2a1 1 0 0 0 1-.8L20 8H6" />
			<circle cx="9" cy="20" r="1" />
			<circle cx="17" cy="20" r="1" />
		</>,
		p,
	);

export const InfoIcon = (p?: IconProps) =>
	svg(
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5M12 8h.01" />
		</>,
		p,
	);

export const WarnIcon = (p?: IconProps) =>
	svg(
		<>
			<path d="M12 3 2 20h20L12 3Z" />
			<path d="M12 10v4M12 17h.01" />
		</>,
		p,
	);

export const CheckIcon = (p?: IconProps) => svg(<path d="M4 12l5 5L20 6" />, p);

export const PlusIcon = (p?: IconProps) => svg(<path d="M12 5v14M5 12h14" />, p);

export const XIcon = (p?: IconProps) => svg(<path d="M6 6l12 12M18 6 6 18" />, p);

export const EyeIcon = (p?: IconProps) =>
	svg(
		<>
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
			<circle cx="12" cy="12" r="3" />
		</>,
		p,
	);

export const EyeOffIcon = (p?: IconProps) =>
	svg(
		<>
			<path d="M4 4l16 16" />
			<path d="M9.5 9.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2" />
			<path d="M6.2 6.4C3.9 7.9 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1M9.9 5.7A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-2.4 3.2" />
		</>,
		p,
	);
