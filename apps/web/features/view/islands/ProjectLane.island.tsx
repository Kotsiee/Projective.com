import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { requestShare } from "@web/features/share/core/share-request.ts";
// The lane reuses the profile lane's `pf-lane*` skeleton (header + scroll + footer geometry), and
// `entity-view.css` layers the conversion-rail content on top — the SAME sheet and the SAME classes
// the commerce `EntityLane` renders, which is what makes the two one control set (§C.1 — a sheet
// imported by a server component alone never ships, so it rides this island's bundle).
import "@features/profile/styles/profile.css";
import "../styles/entity-view.css";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import {
	LaneIdentity,
	LaneLedger,
	type LaneMenuItem,
	LaneStages,
	PriceBlock,
} from "../components/lane-parts.tsx";
import { ProjectCtaRig, ProjectPreviewCta } from "../components/ProjectCtaRig.tsx";
import { sellerBadges, signInHref } from "../core/view-model.ts";
import { savedFlag, toggleFlag } from "@features/saved/core/saved-state.ts";
import {
	projectCurrency,
	projectLaneRows,
	projectTicketPrice,
} from "../core/project-view-model.ts";

/**
 * ProjectLane — the Projects archetype's conversion rail (`DESIGN_SYSTEM.md` §D.7), mounted as the
 * frame's END column exactly where a service's `EntityLane` mounts.
 *
 * Same anatomy, top to bottom: the client's identity band with their earned badges and the overflow
 * kebab (Share · Save · Report); the ticket-price figure in two registers; the stage quick-jumps,
 * which drive the server-rendered `StageProgressLedger` in the body; the summary ledger; and the
 * pinned action footer carrying the single Apply primary and the Message ghost.
 *
 * It replaces the `ProjectViewLane` that lived in the SHELL's navigation slot — a drag-resizable
 * middle-nav lane for a signed-in reader and a floating glass aside for a guest, neither of which
 * was the panel a service showed. One presentation now serves both shells, and the lane is not
 * rendered below the frame breakpoint, where `ProjectApplyBar` takes the duty (§D.7.4).
 */
export interface ProjectLaneProps {
	view: EntityView;
	project: ProjectViewExtra;
	authed: boolean;
	ctx: HrefContext;
	/**
	 * The owner's preview: the same lane with no kebab (sharing, saving or reporting one's own draft
	 * are not things the preview is for) and a footer that names the applicant's actions instead of
	 * offering them ({@link ProjectPreviewCta}).
	 */
	preview?: boolean;
}

export default function ProjectLane(
	{ view, project, authed, ctx, preview = false }: ProjectLaneProps,
): JSX.Element {
	const { item } = view;
	const saved = authed ? savedFlag("project", item.id) : null;
	const status = useSignal("");

	/** Save the project (its star, Decision #180); a guest is sent to sign in first. */
	async function save(): Promise<void> {
		if (!saved) {
			globalThis.location.assign(signInHref(item, ctx));
			return;
		}
		const out = await toggleFlag("project", item.id);
		if (out.message) status.value = out.message;
	}

	/** Open the unified share modal (people on Projective · external apps · copy · the device sheet). */
	function share(): void {
		requestShare({ href: globalThis.location?.href ?? "", title: item.title, noun: "project" });
	}

	const menu: LaneMenuItem[] = preview ? [] : [
		{ key: "share", label: "Share project", icon: "share", onSelect: share },
		{
			key: "save",
			label: saved?.value ? "Remove from saved" : "Save project",
			icon: "star",
			onSelect: () => void save(),
		},
	];

	const price = projectTicketPrice(project);

	return (
		<div class="pf-lane evp-lane">
			<div class="pf-lane__full evp-lane__full">
				<LaneIdentity
					item={item}
					badges={sellerBadges(item, view.responseMinutes)}
					menu={menu}
					menuLabel="More project actions"
				/>

				<div class="pf-lane__scroll evp-lane__scroll">
					<PriceBlock
						amount={price.amount}
						fallback={price.fallback}
						unit={price.unit}
						isFloor={price.isFloor}
					/>

					<LaneStages
						stages={project.stages}
						currency={projectCurrency(project)}
						label="Project stages"
					/>

					<div class="evp-lane__meta">
						<LaneLedger rows={projectLaneRows(project)} />
					</div>
				</div>

				<div class="pf-lane__footer evp-lane__footer">
					{preview
						? <ProjectPreviewCta layout="lane" />
						: <ProjectCtaRig item={item} authed={authed} ctx={ctx} layout="lane" />}
				</div>
			</div>

			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}
