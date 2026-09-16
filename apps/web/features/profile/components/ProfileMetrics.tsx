import type { ComponentChildren, JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import {
	type EstimatedSpend,
	isFastResponder,
	responseLabel,
	reviewsHref,
} from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMetrics — the hero's unboxed inline metrics strip: Rating · Completed stages · Standing ·
 * Avg. response · Est. spend · Consultation. Each item is a figure over a caption; the rating figure
 * deep-links to the Reviews section when there is anything to read there. An item whose fact is
 * absent is omitted rather than drawn empty, and a strip with nothing to say renders nothing at all.
 *
 * The last three were the context bar's "At a glance" block until they moved here: they are the same
 * register of fact as the first three (a number a visitor weighs before reading further), and one
 * strip is one place to look. "Fast responder" rides as the response figure's caption rather than a
 * chip, and a free consultation is a figure of its own — a container asserts interactivity (§B.11),
 * and neither of these is a control.
 */
export interface ProfileMetricsProps {
	profile: ProfileView;
	/** The estimated spend floor across the seller's listings; `null` when nothing carries a price. */
	spend: EstimatedSpend | null;
}

interface Metric {
	key: string;
	value: ComponentChildren;
	label: string | null;
	sub?: string;
	href?: string;
}

function metricsFor(profile: ProfileView, spend: EstimatedSpend | null): Metric[] {
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
	const minutes = profile.responseMinutes;
	if (minutes !== null) {
		items.push({
			key: "response",
			value: responseLabel(minutes),
			label: "Avg. response",
			sub: isFastResponder(minutes) ? "Fast responder" : undefined,
		});
	}
	if (spend) {
		items.push({
			key: "spend",
			value: (
				<>
					<span class="pf-metric__from">from</span>{" "}
					<MoneyView minor={spend.amount.minor} currency={spend.amount.currency} hideOrigin />
				</>
			),
			label: "Est. spend",
			sub: spend.unit ? `/ ${spend.unit}` : undefined,
		});
	}
	if (profile.freeConsultation) {
		items.push({ key: "consult", value: "Free", label: "Consultation" });
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

export function ProfileMetrics({ profile, spend }: ProfileMetricsProps): JSX.Element | null {
	const items = metricsFor(profile, spend);
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
