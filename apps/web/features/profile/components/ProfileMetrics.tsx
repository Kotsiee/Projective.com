import type { ComponentChildren, JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { CLIENT_TRUST_MIN_REVIEWS } from "@projective/types/reviews";
import { MoneyView } from "@projective/ui/display/money";
import {
	type EstimatedSpend,
	isFastResponder,
	type ProfileMetaFact,
	responseLabel,
	reviewsHref,
	standingFactorFacts,
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
 *
 * A TEAM's Standing, read from the team's own Standing row (Teams P1), carries the client-valued
 * factors behind the rung beneath its caption as one MetaLine ("96% on time · 100% completion · No
 * disputes", `standingFactorFacts`) once the team has the volume the ladder's first earned rung
 * demands — the database withholds them below it. A freelancer's Standing is the rung alone (their
 * rates are not published), and a business has no Standing at all (Decision #244).
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
	/** Facts beneath the caption, as one MetaLine — the Standing rung's factors (Teams P1). */
	facts?: ProfileMetaFact[];
}

/**
 * A business's trust readout (BP1, Decision #244; defined by #486 (B)): its Client Trust Score with
 * how many freelancer reviews stand behind it. Below 3 reviews the score is not shown, so the strip
 * says how many there are and when the score appears, rather than a figure that is not one yet.
 */
function clientReviewsSub(count: number): string {
	return `${count} ${count === 1 ? "review" : "reviews"} from freelancers`;
}

function metricsFor(profile: ProfileView, spend: EstimatedSpend | null): Metric[] {
	const items: Metric[] = [];
	const track = profile.rating.asHelper ?? profile.rating.asClient;
	if (profile.kind === "business") {
		if (profile.clientTrust) {
			items.push({
				key: "rating",
				value: profile.clientTrust.score.toFixed(2),
				label: "Client Trust Score",
				sub: clientReviewsSub(profile.clientTrust.reviewCount),
				href: reviewsHref(profile.handle),
			});
		} else if (track && track.count > 0) {
			items.push({
				key: "rating",
				value: String(track.count),
				label: track.count === 1 ? "Review from freelancers" : "Reviews from freelancers",
				sub: `Client Trust Score shows from ${CLIENT_TRUST_MIN_REVIEWS}`,
				href: reviewsHref(profile.handle),
			});
		}
	} else if (track && track.count > 0) {
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
			facts: standingFactorFacts(standing.factors, profile.kind),
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
			{metric.facts && metric.facts.length > 0 && (
				<MetaLine as="span" size="xs" class="pf-metric__facts" items={metric.facts} />
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
