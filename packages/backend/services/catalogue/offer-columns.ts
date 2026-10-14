import {
	AttachmentRefSchema,
	type FormArchetype,
	ListingLicence,
	type ListingOffer,
	ListingProductFormat,
	MilestoneSchema,
	ScopeItem,
	TeamRoleSchema,
} from "@projective/types/catalogue";
import { parseStoredList } from "@projective/types/explore";
import { MeetingProvider } from "@projective/types/scheduling";

/**
 * offer-columns — a listing's {@link ListingOffer} to and from the columns that store it.
 *
 * The offer is one discriminated union in the editor and a handful of columns on the service
 * blueprint or the product (`stage_template`, `turnaround_days`, `licence`, …). Both directions live
 * here, side by side, so a field cannot be written under one name and read under another. The keys
 * {@link offerColumns} emits are exactly the column names `catalogue.save_listing` accepts.
 */

// #region Rows
/** The blueprint columns an offer is read from. */
export interface OfferBlueprintColumns {
	stage_template: unknown;
	team_roles: unknown;
	deliverables: string[] | null;
	turnaround_days: number | null;
	session_minutes: number | null;
	session_count: number | null;
	meeting_provider: string | null;
	max_seats_per_cohort: number | null;
	allow_continuous_enrollment: boolean | null;
}

/** The product columns an offer is read from. */
export interface OfferProductColumns {
	format: string;
	licence: string;
	attribution_required: boolean | null;
	file_manifest: unknown;
}
// #endregion

// #region Read
/** A session's length when the blueprint has none yet: the form opens on one hour. */
const DEFAULT_SESSION_MINUTES = 60;

function scopeOf(raw: string[] | null): string[] {
	return (raw ?? []).flatMap((line) => {
		const parsed = ScopeItem.safeParse(line);
		return parsed.success ? [parsed.data] : [];
	});
}

function sessionFields(bp: OfferBlueprintColumns) {
	const provider = MeetingProvider.safeParse(bp.meeting_provider);
	return {
		minutes: bp.session_minutes && bp.session_minutes >= 5
			? Math.min(600, bp.session_minutes)
			: DEFAULT_SESSION_MINUTES,
		count: Math.min(52, Math.max(1, bp.session_count ?? 1)),
		meetingProvider: provider.success ? provider.data : null,
	};
}

/**
 * The offer a blueprint stores, for the archetype the listing edits as. Stored documents are read
 * leniently: an element that no longer parses is left out rather than failing the whole listing.
 */
export function offerFromBlueprint(
	archetype: Exclude<FormArchetype, "product">,
	bp: OfferBlueprintColumns,
): ListingOffer {
	const stages = parseStoredList(MilestoneSchema, bp.stage_template);
	const teamRoles = parseStoredList(TeamRoleSchema, bp.team_roles);
	switch (archetype) {
		case "pipeline":
			return { archetype, stages, teamRoles };
		case "session":
			return { archetype, ...sessionFields(bp) };
		case "cohort":
			return {
				archetype,
				...sessionFields(bp),
				maxSeatsPerCohort: Math.min(500, Math.max(1, bp.max_seats_per_cohort ?? 1)),
				continuousEnrollment: bp.allow_continuous_enrollment ?? false,
			};
		case "one_off":
			return {
				archetype,
				milestones: stages,
				turnaroundDays: bp.turnaround_days,
				scope: scopeOf(bp.deliverables),
				teamRoles,
			};
	}
}

/** The offer a product stores. An unknown stored licence reads as the narrowest one. */
export function offerFromProduct(pr: OfferProductColumns): ListingOffer {
	const format = ListingProductFormat.safeParse(pr.format);
	const licence = ListingLicence.safeParse(pr.licence);
	return {
		archetype: "product",
		format: format.success ? format.data : "download",
		licence: licence.success ? licence.data : "personal",
		attributionRequired: pr.attribution_required ?? false,
		attachments: parseStoredList(AttachmentRefSchema, pr.file_manifest),
	};
}
// #endregion

// #region Write
/**
 * The `save_listing` patch keys for an offer. Moving between Session and Group Session is the one
 * archetype change an offer may carry; it travels as the delivery model the database checks.
 */
export function offerColumns(offer: ListingOffer, current: FormArchetype): Record<string, unknown> {
	switch (offer.archetype) {
		case "product":
			return {
				format: offer.format,
				licence: offer.licence,
				attribution_required: offer.attributionRequired,
				file_manifest: offer.attachments,
			};
		case "one_off":
			return {
				stage_template: offer.milestones,
				turnaround_days: offer.turnaroundDays,
				deliverables: offer.scope,
				team_roles: offer.teamRoles,
			};
		case "pipeline":
			return { stage_template: offer.stages, team_roles: offer.teamRoles };
		case "session":
		case "cohort": {
			const out: Record<string, unknown> = {
				session_minutes: offer.minutes,
				session_count: offer.count,
				meeting_provider: offer.meetingProvider,
			};
			if (offer.archetype === "cohort") {
				out.max_seats_per_cohort = offer.maxSeatsPerCohort;
				out.allow_continuous_enrollment = offer.continuousEnrollment;
			}
			if (offer.archetype !== current) {
				out.delivery_model = offer.archetype === "cohort" ? "group_session" : "session";
			}
			return out;
		}
	}
}
// #endregion
