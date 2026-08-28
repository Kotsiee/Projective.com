import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon, type IconSize } from "@projective/ui/icons";

/**
 * VerifiedBadge — the identity-verification mark shown beside a verified owner's name.
 *
 * It is now a thin wrapper over the SHARED registry glyph. It used to hand-author its own `<svg>`
 * children — a twelve-lobe seal, a concentric ring and a tick, each addressed by its own class so the
 * stylesheet could paint a solid primary crest with a knocked-out tick. That was the third independent
 * geometry for one concept in this product (the registry had one, the profile feature had another),
 * which §B.7.7 bans outright, and it also authored a `stroke-width` on a glyph and set colour from
 * tokens INSIDE it — both §B.7 merge-gate items.
 *
 * It is the SOLID badge: the eight-point star floods with `--primary` and the check is knocked out of
 * it in `--on-primary`. That needed a real addition to the icon contract rather than a local hack —
 * `data-filled` floods the whole `<svg>`, so filling this glyph used to turn its checkmark into a blob.
 * `icon.css` now honours one `data-knockout` part per glyph, drawn in `--icon-knockout`, and this
 * component is the call site that says what ground the check is cut out of. The glyph itself still
 * names no colour, so §B.7.6 holds.
 *
 * `--on-primary` on `--primary` measures 3.57:1 in dark mode (the theme-engine defect of Decisions
 * #64/#65). That is a fail for TEXT and fine here: a checkmark is a graphical object, where the AA
 * floor is 3:1 — and it is the same pairing every filled primary control in the product already uses,
 * so a crest that diverged from it would be the odd one out rather than the safe one.
 *
 * ## The accessible name is given ONCE
 *
 * The mark used to carry `role="img" aria-label` AND a `Tooltip` with the same string, so the word was
 * announced twice. The `Tooltip` is what a sighted reader gets on hover; the `role`/`aria-label` pair
 * is what everyone else gets, and it is the one that has to be right. The `Icon` inside stays
 * `aria-hidden` — the name lives on the labelled element, per §B.7.5.
 */
export function VerifiedBadge(
	{ size = "sm", label = "Verified" }: { size?: "sm" | "md" | "lg"; label?: string },
): JSX.Element {
	// The badge's own three steps map onto the shared ramp, so every instance lands on a whole pixel.
	// The old `--md` was 1.2rem — 19.2px, a fractional box that half-pixels a 1.5px stroke (§B.7.3).
	const iconSize: IconSize = size === "lg" ? "lg" : size === "md" ? "md" : "sm";
	return (
		<Tooltip content={label} placement="top">
			<span class={`ex-verified ex-verified--${size}`} role="img" aria-label={label}>
				<Icon name="verified" size={iconSize} filled />
			</span>
		</Tooltip>
	);
}
