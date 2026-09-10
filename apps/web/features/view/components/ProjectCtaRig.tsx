import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { CtaButton } from "./CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { applyToProject, projectApplied } from "../core/view-state.ts";
import { messageHrefFor, signInHref } from "../core/view-model.ts";

/**
 * ProjectCtaRig — the action rig BOTH of a project's transactional regions render.
 *
 * The conversion lane above the frame breakpoint and the apply bar below it are two components,
 * and §D.7.4's whole point is that they must never offer different transactions. They share this
 * one rig, exactly as the commerce regions share `BookingCtaRig`, and the only difference between
 * the two mounts is which classes they hang on it.
 *
 * It follows §D.7.7's anatomy: ONE primary — **Apply to project** — on the same `CtaButton` and the
 * same `.evp-cta__btn` classes as a service's Buy now, so the two archetypes' primaries are
 * indistinguishable in geometry; and ONE ghost tertiary — **Message client** — the single sanctioned
 * pre-purchase contact control. No secondary: a brief is applied to, never added to a basket.
 *
 * A guest's Apply bounces to sign-in with a return path, and so does a guest's Message: the DM
 * namespace is authed-only, and a link that lands a guest on a login wall with no way back is worse
 * than one that says where it is taking them.
 *
 * Apply is an optimistic client stub (`projectApplied`) until the application write path lands —
 * the same state the dashboard's `ProjectPreviewRig` reads, so an application shows everywhere at
 * once.
 */
export function ProjectCtaRig(
	{ item, authed, ctx, layout = "lane" }: {
		item: ExploreItem;
		authed: boolean;
		ctx: HrefContext;
		/** `lane` renders the compact rig; `bar` the mobile block. Presentation only. */
		layout?: "lane" | "bar";
	},
): JSX.Element {
	const primary = useCtaFeedback();
	const applied = projectApplied.value;
	const contactHref = authed ? messageHrefFor(item) : signInHref(item, ctx);

	function run(): Promise<boolean> {
		const before = projectApplied.value;
		const after = applyToProject(item, authed, ctx);
		// A guest is bounced by `applyToProject` and nothing changed; only a real flip settles.
		return Promise.resolve(after !== before && after);
	}

	return (
		<div class={layout === "bar" ? "evp-cta evp-cta--bar" : "evp-cta"}>
			<CtaButton
				label={applied ? "Applied" : "Apply to project"}
				ariaLabel={applied ? "Applied — press to withdraw your application" : undefined}
				settledLabel="Applied"
				phase={primary.phase}
				tone={applied ? "brand" : "inverted"}
				variant={applied ? "outlined" : "filled"}
				icon={<Icon name={applied ? "check" : "user-plus"} size="sm" aria-hidden />}
				onClick={() => void primary.run(run)}
			/>

			<a class="evp-cta__ghost" href={contactHref}>
				<Icon name="message" size="sm" aria-hidden />
				<span>Message client</span>
			</a>
		</div>
	);
}
