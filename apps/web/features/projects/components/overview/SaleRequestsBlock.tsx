import type { JSX } from "preact";
import type { ProjectSaleRequests, SaleRequestView } from "@projective/types/catalogue";
import { Block, MetaFacts } from "../dashboard/DashboardBlocks.tsx";

/**
 * SaleRequestsBlock — the Overview's "Requests to sell" region (MARKETPLACE SC7, Decision #493): one row
 * per stage the viewer may sell from as its maker, or holds a request on as the client, each a link to
 * the stage's dialog (`?sell=<stage slug>`, ROUTING.md), its state said in inline Meta text. Renders
 * nothing when there is nothing to show; the database decides (`catalogue.project_sale_requests`).
 */
export interface SaleRequestsBlockProps {
	sales: ProjectSaleRequests;
}

interface Row {
	stageSlug: string;
	stageName: string;
	title: string;
	facts: string[];
	label: string;
}

const pct = (bp: number) => `${(bp / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} %`;

/** A request's state, as the viewer reads it in one Meta line. */
function factsOf(r: SaleRequestView): string[] {
	const royalty = r.royaltyBp > 0 ? `${pct(r.royaltyBp)} royalty` : "No royalty";
	switch (r.status) {
		case "requested":
			return r.role === "client"
				? ["Awaiting your decision", `${royalty} to you`]
				: ["Waiting for the client", royalty];
		case "approved":
			return r.role === "client" ? ["Granted", `${royalty} to you`] : ["Granted", "Draft ready"];
		case "declined":
			return ["Declined"];
		case "withdrawn":
			return ["Withdrawn"];
	}
}

export function SaleRequestsBlock({ sales }: SaleRequestsBlockProps): JSX.Element | null {
	const rows: Row[] = [];
	const seen = new Set<string>();
	for (const s of sales.stages) {
		const latest = sales.requests.find((r) => r.stageSlug === s.stageSlug && r.role === "maker");
		seen.add(s.stageSlug);
		rows.push({
			stageSlug: s.stageSlug,
			stageName: s.stageName,
			title: latest && latest.status !== "withdrawn" ? latest.title : s.stageName,
			facts: latest && latest.status !== "withdrawn" ? factsOf(latest) : [
				s.refusal ??
					(s.ipMode === "shared_ownership" ? "You may list it" : "You may ask to sell it"),
			],
			label: latest
				? `Your request to sell from ${s.stageName}`
				: `Ask to sell work from ${s.stageName}`,
		});
	}
	for (const r of sales.requests) {
		if (seen.has(r.stageSlug) || r.role !== "client") continue;
		seen.add(r.stageSlug);
		rows.push({
			stageSlug: r.stageSlug,
			stageName: r.stageName,
			title: r.title,
			facts: factsOf(r),
			label: `The request to sell ${r.title}`,
		});
	}
	if (!rows.length) return null;
	return (
		<Block title="Requests to sell" region="sale-requests">
			<ul class="pjd-list">
				{rows.map((row) => (
					<li key={row.stageSlug}>
						<a
							class="pjd-row"
							href={`?sell=${encodeURIComponent(row.stageSlug)}`}
							aria-label={row.label}
						>
							<span class="pjd-row__body">
								<span class="pjd-row__title">{row.title}</span>
								<MetaFacts
									items={row.title === row.stageName ? row.facts : [row.stageName, ...row.facts]}
								/>
							</span>
						</a>
					</li>
				))}
			</ul>
		</Block>
	);
}
