import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { requestShare } from "@web/features/share/core/share-request.ts";
import "@features/profile/styles/profile-skeleton.css";
import "../styles/entity-view.css";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import {
	CARD_STAGE_LIMIT,
	LaneContextMenu,
	LaneLedger,
	LaneMenu,
	type LaneMenuItem,
	LaneStages,
	PriceBlock,
} from "../components/lane-parts.tsx";
import { ProjectCtaRig, ProjectPreviewCta } from "../components/ProjectCtaRig.tsx";
import { signInHref } from "../core/view-model.ts";
import { savedFlag, toggleFlag } from "@features/saved/core/saved-state.ts";
import {
	projectCurrency,
	projectLaneRows,
	projectTicketPrice,
} from "../core/project-view-model.ts";

/**
 * ProjectLane — the Projects archetype's purchase card (`DESIGN_SYSTEM.md` §D.7), mounted as the
 * frame's END column exactly where a listing's `EntityLane` mounts, in the same `.evp-card` anatomy:
 * the ticket price with the overflow kebab (Share · Save) · the stage quick-jumps, capped at
 * {@link CARD_STAGE_LIMIT} · the summary ledger · the action footer carrying the single Apply primary
 * and the Message ghost. It carries no identity: the client is named once, in the hero's seller line.
 *
 * Below the frame breakpoint it is not rendered, and `ProjectApplyBar` takes the duty (§D.7.4).
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
	const card = useRef<HTMLDivElement>(null);

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
			icon: "bookmark",
			onSelect: () => void save(),
		},
	];

	const price = projectTicketPrice(project);

	return (
		<div class="evp-card" ref={card}>
			<div class="evp-card__head">
				<PriceBlock
					amount={price.amount}
					fallback={price.fallback}
					unit={price.unit}
					isFloor={price.isFloor}
				/>
				<LaneMenu menu={menu} menuLabel="More project actions" />
			</div>

			<div class="evp-card__body">
				<LaneStages
					stages={project.stages}
					currency={projectCurrency(project)}
					label="Project stages"
					limit={CARD_STAGE_LIMIT}
				/>
				<LaneLedger rows={projectLaneRows(project)} />
			</div>

			<div class="evp-card__foot">
				{preview
					? <ProjectPreviewCta layout="lane" />
					: <ProjectCtaRig item={item} authed={authed} ctx={ctx} layout="lane" />}
			</div>

			{!preview && (
				<LaneContextMenu
					menu={menu}
					surface={() => card.current}
					label="Project actions"
				/>
			)}
			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}
