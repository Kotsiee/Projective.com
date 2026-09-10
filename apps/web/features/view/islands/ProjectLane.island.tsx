import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
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
import { ProjectCtaRig } from "../components/ProjectCtaRig.tsx";
import { sellerBadges } from "../core/view-model.ts";
import {
	PROJECT_CURRENCY,
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
}

export default function ProjectLane(
	{ view, project, authed, ctx }: ProjectLaneProps,
): JSX.Element {
	const { item } = view;
	const saved = useSignal(false);
	const status = useSignal("");

	function announce(msg: string): void {
		status.value = msg;
	}

	/** Share via the Web Share sheet where the platform offers one, else copy to the clipboard. */
	function share(): void {
		try {
			const url = globalThis.location?.href ?? "";
			const nav = globalThis.navigator as Navigator & {
				share?: (d: { title: string; url: string }) => Promise<void>;
			};
			if (nav?.share) nav.share({ title: item.title, url }).catch(() => {});
			else {
				nav?.clipboard?.writeText(url).catch(() => {});
				announce("Link copied to clipboard");
			}
		} catch { /* non-fatal */ }
	}

	const menu: LaneMenuItem[] = [
		{ key: "share", label: "Share project", icon: "share", onSelect: share },
		{
			key: "save",
			label: saved.value ? "Remove from list" : "Save to custom list",
			icon: "bookmark",
			onSelect: () => {
				saved.value = !saved.value;
				announce(saved.value ? "Saved to your list" : "Removed from your list");
			},
		},
		{
			key: "report",
			label: "Report project",
			icon: "flag",
			danger: true,
			onSelect: () => announce("Report submitted for review"),
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
						currency={PROJECT_CURRENCY}
						label="Project stages"
					/>

					<div class="evp-lane__meta">
						<LaneLedger rows={projectLaneRows(project)} />
					</div>
				</div>

				<div class="pf-lane__footer evp-lane__footer">
					<ProjectCtaRig item={item} authed={authed} ctx={ctx} layout="lane" />
				</div>
			</div>

			<p class="ui-visually-hidden" role="status" aria-live="polite">{status.value}</p>
		</div>
	);
}
