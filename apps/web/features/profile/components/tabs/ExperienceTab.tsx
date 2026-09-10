import type { ComponentChildren, JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { newestFirst } from "./tab-shared.tsx";
import type {
	CertificationEntry,
	EducationEntry,
	ExperienceEntry,
	ProfileTabPayload,
} from "../../types/profile-types.ts";

/**
 * ExperienceTab — the Experience section: career history, education and certifications as three
 * hairline-separated lists in one column, newest first. A SERVER component; the only hydration root
 * it mounts is the verified crest's Tooltip.
 */
export interface ExperienceTabProps {
	payload: ProfileTabPayload;
}

// #region Row
interface RowProps {
	logo?: string;
	org: string;
	title: ComponentChildren;
	dates: string;
	summary?: string;
	link?: string;
}

function Row({ logo, org, title, dates, summary, link }: RowProps): JSX.Element {
	return (
		<li class="pf-tl">
			<Avatar image={logo} label={org} size={40} shape="square" class="pf-tl__logo" />
			<div class="pf-tl__body">
				<span class="pf-tl__title">{title}</span>
				<span class="pf-tl__org">{org}</span>
				{summary ? <p class="pf-tl__summary">{summary}</p> : null}
				{link
					? (
						<a class="pf-tl__link" href={link} target="_blank" rel="noopener">
							View credential <Icon name="external-link" size="2xs" />
						</a>
					)
					: null}
			</div>
			<span class="pf-tl__dates">{dates}</span>
		</li>
	);
}

function Section(
	{ title, children }: { title: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="pf-exp__section">
			<h2 class="pf-h">{title}</h2>
			<ul class="pf-exp__list" role="list">{children}</ul>
		</section>
	);
}
// #endregion

// #region Entry shapes
function experienceDates(e: ExperienceEntry): string {
	const end = e.current ? "Present" : e.end ?? "Present";
	return `${e.start} – ${end}`;
}

function educationDates(e: EducationEntry): string {
	return `${e.start} – ${e.end ?? "Present"}`;
}

function certificationDates(c: CertificationEntry): string {
	return c.expires ? `${c.issued} – ${c.expires}` : c.issued;
}

function certificationTitle(c: CertificationEntry): ComponentChildren {
	if (!c.verified) return c.name;
	return (
		<>
			{c.name}
			<Tooltip content="Verified by Projective">
				<span class="pf-tl__crest" tabIndex={0} role="img" aria-label="Verified by Projective">
					<Icon name="verified" filled size="xs" />
				</span>
			</Tooltip>
		</>
	);
}
// #endregion

export function ExperienceTab({ payload }: ExperienceTabProps): JSX.Element {
	const experience = newestFirst(payload.experience, (e) => e.start);
	const education = newestFirst(payload.education, (e) => e.start);
	const certifications = newestFirst(payload.certifications, (c) => c.issued);

	return (
		<div class="pf-exp">
			{experience.length
				? (
					<Section title="Experience">
						{experience.map((e) => (
							<Row
								key={e.id}
								logo={e.logo}
								org={e.org}
								title={e.role}
								dates={experienceDates(e)}
								summary={e.summary}
							/>
						))}
					</Section>
				)
				: null}
			{education.length
				? (
					<Section title="Education">
						{education.map((e) => (
							<Row
								key={e.id}
								logo={e.logo}
								org={e.school}
								title={`${e.credential} · ${e.field}`}
								dates={educationDates(e)}
							/>
						))}
					</Section>
				)
				: null}
			{certifications.length
				? (
					<Section title="Certifications">
						{certifications.map((c) => (
							<Row
								key={c.id}
								logo={c.logo}
								org={c.issuer}
								title={certificationTitle(c)}
								dates={certificationDates(c)}
								link={c.credentialUrl}
							/>
						))}
					</Section>
				)
				: null}
		</div>
	);
}
