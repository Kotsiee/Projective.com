import type { JSX } from "preact";
import { reviewsHref } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMetrics — the hero's unboxed inline metrics strip: Rating · Completed stages · Standing.
 * Each item is a figure over a caption; the rating figure deep-links to the Reviews section when
 * there is anything to read there. An item whose fact is absent is omitted rather than drawn empty,
 * and a strip with nothing to say renders nothing at all.
 */
export interface ProfileMetricsProps {
	profile: ProfileView;
}

interface Metric {
	key: string;
	value: string;
	label: string | null;
	sub?: string;
	href?: string;
}

function metricsFor(profile: ProfileView): Metric[] {
	const items: Metric[] = [];
	const track = profile.rating.asHelper ?? profile.rating.asClient;
	if (track && track.count > 0) {
		items.push({
			key: "rating",
			value: track.value.toFixed(1),
			label: "Rating",
			href: reviewsHref(profile.handle),
		});
	}
	const { completedStages, standing, volumeLabel } = profile.stats;
	if (completedStages > 0) {
		items.push({
			key: "stages",
			value: String(completedStages),
			label: completedStages === 1 ? "Completed stage" : "Completed stages",
		});
	}
	if (standing) {
		items.push({
			key: "standing",
			value: standing.label,
			label: "Standing",
			sub: volumeLabel ?? undefined,
		});
	} else if (volumeLabel) {
		items.push({ key: "volume", value: volumeLabel, label: null });
	}
	return items;
}

function MetricBody({ metric }: { metric: Metric }): JSX.Element {
	return (
		<>
			<span class="pf-metric__value">{metric.value}</span>
			{(metric.label || metric.sub) && (
				<span class="pf-metric__caption">
					{metric.label && <span class="pf-metric__label">{metric.label}</span>}
					{metric.label && metric.sub && <span class="pf-metric__dot" aria-hidden="true">·</span>}
					{metric.sub && <span class="pf-metric__sub">{metric.sub}</span>}
				</span>
			)}
		</>
	);
}

export function ProfileMetrics({ profile }: ProfileMetricsProps): JSX.Element | null {
	const items = metricsFor(profile);
	if (items.length === 0) return null;
	return (
		<ul class="pf-metrics" role="list">
			{items.map((metric) => (
				<li class="pf-metric" key={metric.key}>
					{metric.href
						? (
							<a class="pf-metric__link" href={metric.href}>
								<MetricBody metric={metric} />
							</a>
						)
						: <MetricBody metric={metric} />}
				</li>
			))}
		</ul>
	);
}
