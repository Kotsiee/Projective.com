import type { JSX } from "preact";
import type { WorkspaceKind } from "@projective/types/workspace";
import { cloneGlyph } from "../core/workspace-glyphs.tsx";
import type { WorkspaceModule } from "../core/module-registry.tsx";

/**
 * ModulePlaceholder — the honest surface for a module whose depth lives somewhere else, or is next.
 *
 * Two genuinely different situations wear the same shape here, and the distinction is the whole point:
 *
 *   - **A module that DELEGATES.** Projects, Catalogue, Calendar and Messages are already whole
 *     surfaces elsewhere; this entity's version of them is those surfaces scoped to the entity. The
 *     placeholder's job is to say so and hand off, because duplicating `/projects` inside `/teams`
 *     would mean two feeds to keep in step.
 *   - **A module that is NEXT.** Analytics, Standing, Billing and Talent are near-term. Saying so
 *     plainly is better than an empty panel that reads as a bug, and far better than fabricating
 *     numbers to fill the space.
 *
 * What it must never be is a shrug. It names what belongs here and, where a real destination exists,
 * takes you there.
 */

export interface ModulePlaceholderProps {
	module: WorkspaceModule;
	/**
	 * The entity kind, so the placeholder carries the same `.wsp[data-kind]` token scope as every other
	 * screen. Without it the `--wsp-kind` tints silently fall back and a delegating module would be the
	 * one page on the surface that is not tinted like its entity.
	 */
	kind?: WorkspaceKind;
	/** Where the real surface lives, when one does. Omit for a not-yet module. */
	href?: string | null;
	/** Call-to-action label for {@link href}. */
	linkLabel?: string;
	/** Overrides the module's own blurb when this instance needs to say something more specific. */
	note?: string;
}

/** The shared body for a delegating or near-term module. */
export function ModulePlaceholder(props: ModulePlaceholderProps): JSX.Element {
	const { module } = props;
	const delegating = Boolean(props.href);

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				<section
					class="wsp-band wsp-band--head wsp-band--tail"
					aria-labelledby={`wsp-mod-${module.key}`}
				>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<span class="wsp-activity__glyph" aria-hidden="true">{cloneGlyph(module.glyph)}</span>
							<h1 class="wsp-pagehead__title" id={`wsp-mod-${module.key}`}>{module.label}</h1>
						</div>
						<p class="wsp-pagehead__note">{props.note ?? module.blurb}</p>
						{delegating
							? (
								<p class="wsp-moneyhead">
									<a class="wsp-moneyhead__link" href={props.href!}>
										{props.linkLabel ?? `Open ${module.label.toLowerCase()}`}
									</a>
								</p>
							)
							: (
								<p class="wsp-pagehead__meta">
									Not built yet — it will appear here without you having to do anything.
								</p>
							)}
					</div>
				</section>
			</div>
		</div>
	);
}
