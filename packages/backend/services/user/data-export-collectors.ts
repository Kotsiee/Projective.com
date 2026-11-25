import {
	DATA_EXPORT_DOMAIN_SCHEMAS,
	type DataExportCalendar,
	type DataExportContributions,
	type DataExportDomain,
	type DataExportDomainFile,
	type DataExportEmails,
	type DataExportFiles,
	DataExportFilesSchema,
	type DataExportInvoices,
	type DataExportMessages,
	type DataExportNotifications,
	type DataExportPreferences,
	type DataExportProfile,
	type DataExportProjects,
	DataExportProjectsSchema,
	type DataExportReviews,
	type DataExportSaved,
	type DataExportSearch,
	type DataExportSecurity,
	type DataExportWallet,
} from "@projective/types/org";
import { fileInspectHref, mediaProxyHref } from "@projective/types/files";

/**
 * data-export-collectors — the pure half of the personal data export (Decision #450): one mapper per
 * archive domain, from what `security.collect_data_export` answered to the domain file's versioned
 * shape. Each parses against its `@projective/types/org` schema, so a key the schema does not list is
 * dropped and a malformed answer throws (the job then retries the request). No I/O: every mapper is
 * unit-tested on its own.
 */

// #region Context
/** What a mapper needs besides the raw answer. */
export interface CollectorContext {
	/** The app's public origin (`APP_URL`), so links in the archive open from anywhere. */
	origin: string;
}

function absolute(origin: string, path: string): string {
	return `${origin.replace(/\/+$/, "")}${path}`;
}

function records(raw: unknown): Record<string, unknown>[] {
	if (!Array.isArray(raw)) throw new TypeError("Expected a list of records.");
	return raw.map((row) => {
		if (typeof row !== "object" || row === null || Array.isArray(row)) {
			throw new TypeError("Expected a record.");
		}
		return row as Record<string, unknown>;
	});
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
// #endregion

// #region Mappers
/** profile.json — identity, profile, seller profile and its sub-records, handle history. */
export function collectProfile(raw: unknown): DataExportProfile {
	return DATA_EXPORT_DOMAIN_SCHEMAS.profile.parse(raw);
}

/** emails.json — every address on the account. */
export function collectEmails(raw: unknown): DataExportEmails {
	return DATA_EXPORT_DOMAIN_SCHEMAS.emails.parse(raw);
}

/** preferences.json — display, notification and per-category settings. */
export function collectPreferences(raw: unknown): DataExportPreferences {
	return DATA_EXPORT_DOMAIN_SCHEMAS.preferences.parse(raw);
}

/** projects.json — projects held personally, each with the address it opens at. */
export function collectProjects(raw: unknown, ctx: CollectorContext): DataExportProjects {
	return DataExportProjectsSchema.parse(
		records(raw).map((row) => ({
			...row,
			url: absolute(ctx.origin, `/projects/${encodeURIComponent(text(row.slug))}`),
		})),
	);
}

/** contributions.json — seats, stage assignments, claimed tickets and submissions elsewhere. */
export function collectContributions(raw: unknown): DataExportContributions {
	return DATA_EXPORT_DOMAIN_SCHEMAS.contributions.parse(raw);
}

/** messages.json — what the person sent, and the conversations they are in. */
export function collectMessages(raw: unknown): DataExportMessages {
	return DATA_EXPORT_DOMAIN_SCHEMAS.messages.parse(raw);
}

/**
 * files.json — the manifest of the person's own files. Each entry gets the stable addresses that open
 * and download it behind the person's own sign-in; never a signed link, which would be a key to a
 * private file in every copy of the archive.
 */
export function collectFiles(raw: unknown, ctx: CollectorContext): DataExportFiles {
	return DataExportFilesSchema.parse(
		records(raw).map((row) => ({
			...row,
			open_url: absolute(ctx.origin, fileInspectHref(text(row.slug))),
			download_url: absolute(ctx.origin, mediaProxyHref(text(row.id), { download: true })),
		})),
	);
}

/** wallet.json — the person's own wallets and every ledger entry on them. */
export function collectWallet(raw: unknown): DataExportWallet {
	return DATA_EXPORT_DOMAIN_SCHEMAS.wallet.parse(raw);
}

/** invoices.json — invoices issued, wallet statements and orders. */
export function collectInvoices(raw: unknown): DataExportInvoices {
	return DATA_EXPORT_DOMAIN_SCHEMAS.invoices.parse(raw);
}

/** reviews.json — written, and received about the person or their listings. */
export function collectReviews(raw: unknown): DataExportReviews {
	return DATA_EXPORT_DOMAIN_SCHEMAS.reviews.parse(raw);
}

/** saved.json — bookmarks and their collections. */
export function collectSaved(raw: unknown): DataExportSaved {
	return DATA_EXPORT_DOMAIN_SCHEMAS.saved.parse(raw);
}

/** calendar.json — the person's own entries and their answers to invitations. */
export function collectCalendar(raw: unknown): DataExportCalendar {
	return DATA_EXPORT_DOMAIN_SCHEMAS.calendar.parse(raw);
}

/** notifications.json — every notice the person was sent. */
export function collectNotifications(raw: unknown): DataExportNotifications {
	return DATA_EXPORT_DOMAIN_SCHEMAS.notifications.parse(raw);
}

/** search.json — searches and recently viewed pages. */
export function collectSearch(raw: unknown): DataExportSearch {
	return DATA_EXPORT_DOMAIN_SCHEMAS.search.parse(raw);
}

/** security.json — sign-ins, open sessions and the platform's audit rows about the person. */
export function collectSecurity(raw: unknown): DataExportSecurity {
	return DATA_EXPORT_DOMAIN_SCHEMAS.security.parse(raw);
}
// #endregion

// #region Dispatch
type Collector<D extends DataExportDomain> = (
	raw: unknown,
	ctx: CollectorContext,
) => DataExportDomainFile<D>;

const COLLECTORS: { [D in DataExportDomain]: Collector<D> } = {
	profile: collectProfile,
	emails: collectEmails,
	preferences: collectPreferences,
	projects: collectProjects,
	contributions: collectContributions,
	messages: collectMessages,
	files: collectFiles,
	wallet: collectWallet,
	invoices: collectInvoices,
	reviews: collectReviews,
	saved: collectSaved,
	calendar: collectCalendar,
	notifications: collectNotifications,
	search: collectSearch,
	security: collectSecurity,
};

/** Map one domain's raw answer to its file contents. Throws when the answer does not fit the schema. */
export function collectDomain<D extends DataExportDomain>(
	domain: D,
	raw: unknown,
	ctx: CollectorContext,
): DataExportDomainFile<D> {
	return COLLECTORS[domain](raw, ctx);
}

/**
 * How many records a domain file holds, for the manifest: an array's length, or the sum of an
 * object's arrays plus one for each single record it holds.
 */
export function recordCount(file: unknown): number {
	if (Array.isArray(file)) return file.length;
	if (typeof file !== "object" || file === null) return 0;
	return Object.values(file).reduce<number>((sum, value) => {
		if (Array.isArray(value)) return sum + value.length;
		return value === null || value === undefined ? sum : sum + 1;
	}, 0);
}
// #endregion
