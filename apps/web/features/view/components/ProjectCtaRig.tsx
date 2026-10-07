import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { CtaButton } from "./CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { applyToProject, projectApplied } from "../core/view-state.ts";
import { messageHrefFor, signInHref } from "../core/view-model.ts";
import { AllowanceDisclosure } from "@features/proposals/components/AllowanceDisclosure.tsx";

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
 * Apply opens the listing's one `ProjectApplyModal` (stage, role, applicant, cover note, and the
 * proposal allowance's pre-flight gate). Beneath it sits the cost disclosure — `1 proposal token · N
 * ready` (Decision #154) — in this shared rig, so the lane and the bar quote one cost. "Applied" is
 * derived from the viewer's real pending proposals, and pressing it opens the same modal to manage or
 * withdraw them. Since Decision #144 that is the public listing only: the engagement's own pages are
 * for people already on it.
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

	return (
		<div class={layout === "bar" ? "evp-cta evp-cta--bar" : "evp-cta"}>
			<CtaButton
				label={applied ? "Applied" : "Apply to project"}
				ariaLabel={applied ? "Applied — open to manage or withdraw your proposal" : undefined}
				settledLabel="Applied"
				phase={primary.phase}
				tone={applied ? "brand" : "inverted"}
				variant={applied ? "outlined" : "filled"}
				icon={<Icon name={applied ? "check" : "user-plus"} size="sm" aria-hidden />}
				onClick={() => void applyToProject(item, authed, ctx)}
			/>
			<AllowanceDisclosure authed={authed} />

			<a class="evp-cta__ghost" href={contactHref}>
				<Icon name="message" size="sm" aria-hidden />
				<span>Message client</span>
			</a>
		</div>
	);
}

/**
 * ProjectPreviewCta — what the owner's preview shows where the rig would be.
 *
 * The owner is looking at their own brief; Apply would apply them to it and Message would open a
 * conversation with themselves. Rendering those two controls disabled would be worse still — a control
 * that renders must do something (§3 gate 11), and a greyed-out primary reads as "something is wrong
 * with your project" rather than "this is where applicants act". So the footer states, in words, the
 * two actions an applicant gets here, naming them in the same order and with the same glyphs the rig
 * uses, and offers nothing to press. It is NOT a live region — it never changes.
 */
export function ProjectPreviewCta({ layout = "lane" }: { layout?: "lane" | "bar" }): JSX.Element {
	return (
		<div
			class={layout === "bar"
				? "evp-cta evp-cta--bar evp-cta--preview"
				: "evp-cta evp-cta--preview"}
		>
			<p class="evp-cta__previewlead">Applicants act here</p>
			<ul class="evp-cta__previewlist">
				<li class="evp-cta__previewitem">
					<Icon name="user-plus" size="sm" aria-hidden />
					<span>Apply to project</span>
				</li>
				<li class="evp-cta__previewitem">
					<Icon name="message" size="sm" aria-hidden />
					<span>Message client</span>
				</li>
			</ul>
		</div>
	);
}
