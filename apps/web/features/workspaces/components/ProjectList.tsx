import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { ProgressBar } from "@projective/ui/feedback";
import type { PreviewRow } from "../core/overview-model.ts";

/**
 * ProjectList — the Overview's projects preview: a team's first live engagements, a business's first
 * commissions in delivery (`projectPreview` in `core/overview-model.ts` decides which).
 *
 * One row per engagement, the whole row a link to `/projects/prj-…` (slugs only, Decision #88): the
 * title in the body register, its facts as one MetaLine (counterparty · stage · state · date — never
 * chips, §B.11), and completion as the ui `ProgressBar`, which owns its own fill so no row writes an
 * inline style. Rows part by ONE hairline and are never boxed (§B.4).
 */

export interface ProjectListProps {
	rows: readonly PreviewRow[];
	/** The one Meta line drawn when there is nothing live. */
	empty: string;
}

/** One engagement. */
function ProjectRow({ row }: { row: PreviewRow }): JSX.Element {
	const pct = row.progress === null ? null : Math.round(row.progress * 100);
	return (
		<li class="wsp-projects__item">
			<a class="wsp-projects__row" href={row.href}>
				<span class="wsp-projects__body">
					<span class="wsp-projects__title">{row.title}</span>
					<MetaLine
						as="span"
						size="xs"
						items={row.meta.map((text) => ({ text, tabular: true }))}
					/>
				</span>
				{pct !== null && (
					<ProgressBar
						class="wsp-projects__progress"
						value={pct}
						aria-label={`${pct}% of stages done`}
					/>
				)}
			</a>
		</li>
	);
}

/** The preview list, or one Meta line when nothing is live. */
export function ProjectList(props: ProjectListProps): JSX.Element {
	if (props.rows.length === 0) {
		return <MetaLine class="wsp-projects__empty" items={[props.empty]} />;
	}
	return (
		<ul class="wsp-projects">
			{props.rows.map((row) => <ProjectRow key={row.key} row={row} />)}
		</ul>
	);
}
