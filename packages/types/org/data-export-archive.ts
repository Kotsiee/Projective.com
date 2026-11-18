import { z } from "zod";

/**
 * org data export archive — the versioned contract of the ZIP a person downloads (Decision #450).
 *
 * The archive holds `manifest.json`, a `README.txt`, and one `<domain>.json` per {@link DataExportDomain},
 * each the shape below. Keys are the database's own column names (snake_case), so the copy reads
 * against the published schema docs. A change to any shape bumps {@link DATA_EXPORT_MANIFEST_VERSION}.
 *
 * Collected by the 00001061 `org.fn_export_*` functions, mapped and validated by the backend's pure
 * collectors: a key not listed here never reaches an archive.
 */

// #region Version and domains
/** The archive format's version, written into `manifest.json` and onto the request row. */
export const DATA_EXPORT_MANIFEST_VERSION = 1;

/** Every domain file in an archive, in the order the manifest lists them. */
export const DataExportDomain = z.enum([
	"profile",
	"emails",
	"preferences",
	"projects",
	"contributions",
	"messages",
	"files",
	"wallet",
	"invoices",
	"reviews",
	"saved",
	"calendar",
	"notifications",
	"search",
	"security",
]);
export type DataExportDomain = z.infer<typeof DataExportDomain>;
// #endregion

// #region Primitives
const id = z.string();
const at = z.string();
const text = z.string().nullable();
const when = at.nullable();
const count = z.number().nullable();
const flag = z.boolean().nullable();
const words = z.array(z.string()).nullable();
const json = z.json().nullable();
// #endregion

// #region profile.json
export const DataExportProfileSchema = z.object({
	account: z.object({
		user_id: id,
		email: text,
		email_confirmed_at: when,
		created_at: when,
		last_sign_in_at: when,
	}).nullable(),
	profile: z.object({
		username: text,
		first_name: text,
		last_name: text,
		headline: text,
		bio: json,
		city: text,
		country: text,
		timezone: text,
		languages: words,
		interests: words,
		dob: text,
		visibility: text,
		is_freelancer: flag,
		created_at: when,
		updated_at: when,
	}).nullable(),
	freelancer: z.object({
		skills: words,
		availability_status: text,
		available_since: when,
		max_workload_intensity: count,
		kyc_status: text,
		kyc_verified_at: when,
		hire_intake: json,
		created_at: when,
		updated_at: when,
	}).nullable(),
	languages: z.array(z.object({ code: z.string(), level: text })),
	education: z.array(z.object({
		school: text,
		credential: text,
		field: text,
		start_year: text,
		end_year: text,
		created_at: when,
	})),
	experience: z.array(z.object({
		org_name: text,
		role: text,
		start_year: text,
		end_year: text,
		is_current: flag,
		summary: text,
		created_at: when,
	})),
	certifications: z.array(z.object({
		name: text,
		issuer: text,
		issued_year: text,
		expires_year: text,
		credential_url: text,
		verified: flag,
		created_at: when,
	})),
	portfolio: z.array(z.object({
		title: text,
		description: text,
		client_name: text,
		category: text,
		is_public: flag,
		created_at: when,
		archived_at: when,
	})),
	handle_changes: z.array(
		z.object({ old_handle: z.string(), new_handle: z.string(), changed_at: at }),
	),
});
export type DataExportProfile = z.infer<typeof DataExportProfileSchema>;
// #endregion

// #region emails.json
export const DataExportEmailsSchema = z.array(z.object({
	email: z.string(),
	is_primary: flag,
	verified_at: when,
	created_at: when,
}));
export type DataExportEmails = z.infer<typeof DataExportEmailsSchema>;
// #endregion

// #region preferences.json
export const DataExportPreferencesSchema = z.object({
	display: z.object({
		theme: text,
		locale: text,
		preferred_display_currency: text,
		layout_direction: text,
		contrast: text,
		font: text,
		cvd: text,
		motion: text,
		date_format: text,
		ui_settings: json,
	}).nullable(),
	notifications: z.object({
		email: flag,
		push: flag,
		in_app: flag,
		sms: flag,
		digest: flag,
		digest_frequency: text,
		digest_hour: count,
		digest_weekday: count,
		timezone: text,
		quiet_hours_enabled: flag,
		quiet_hours_start: text,
		quiet_hours_end: text,
		muted_until: when,
		locale: text,
		read_receipts: flag,
		show_typing_indicator: flag,
		sound: flag,
		auto_responses_enabled: flag,
	}).nullable(),
	notification_categories: z.array(z.object({
		category: z.string(),
		in_app: flag,
		push: flag,
		email: flag,
		sms: flag,
		digest_frequency: text,
	})),
});
export type DataExportPreferences = z.infer<typeof DataExportPreferencesSchema>;
// #endregion

// #region projects.json
export const DataExportProjectsSchema = z.array(z.object({
	slug: z.string(),
	/** Where the project opens in the app. */
	url: z.string(),
	role: z.enum(["owner", "client"]),
	title: text,
	description: text,
	format: text,
	status: text,
	visibility: text,
	currency: text,
	budget_type: text,
	budget_amount_cents: count,
	created_at: when,
	updated_at: when,
	archived_at: when,
	stages: z.array(z.object({
		slug: text,
		name: text,
		description: text,
		status: text,
		sort_order: count,
		unit_price_cents: count,
		created_at: when,
		completed_at: when,
		archived_at: when,
	})),
	tickets: z.array(z.object({
		slug: text,
		title: text,
		description: text,
		status: text,
		priority: text,
		due_date: when,
		workload_intensity: count,
		payment_status: text,
		unit_price_cents: count,
		total_amount_paid: count,
		created_at: when,
		updated_at: when,
	})),
}));
export type DataExportProjects = z.infer<typeof DataExportProjectsSchema>;
// #endregion

// #region contributions.json
export const DataExportContributionsSchema = z.object({
	memberships: z.array(z.object({
		project_slug: text,
		project_title: text,
		role: text,
		joined_at: when,
	})),
	stage_assignments: z.array(z.object({
		project_slug: text,
		stage_slug: text,
		stage_name: text,
		status: text,
		assigned_at: when,
	})),
	claimed_tickets: z.array(z.object({
		project_slug: text,
		ticket_slug: text,
		title: text,
		status: text,
		claimed_at: when,
	})),
	submissions: z.array(z.object({
		project_slug: text,
		stage_slug: text,
		ticket_slug: text,
		number: count,
		title: text,
		notes: text,
		status: text,
		created_at: when,
		reviewed_at: when,
	})),
});
export type DataExportContributions = z.infer<typeof DataExportContributionsSchema>;
// #endregion

// #region messages.json
export const DataExportMessagesSchema = z.object({
	/** Direct and group messages the person sent. Nobody else's message is ever included. */
	direct: z.array(z.object({
		id,
		thread: text,
		body: text,
		has_attachments: flag,
		is_audio: flag,
		reply_to_id: text,
		created_at: when,
		deleted_at: when,
	})),
	/** Project channel messages the person sent. */
	channel: z.array(z.object({
		id,
		project_slug: text,
		channel: text,
		body: text,
		has_attachments: flag,
		is_audio: flag,
		reply_to_id: text,
		created_at: when,
		edited_at: when,
		deleted_at: when,
	})),
	/** Every conversation the person is in: its metadata, their own state, the others by @handle. */
	threads: z.array(z.object({
		ref: text,
		kind: text,
		title: text,
		created_at: when,
		last_message_at: when,
		joined_at: when,
		last_read_at: when,
		is_starred: flag,
		is_muted: flag,
		inbox_folder: text,
		left_at: when,
		participants: z.array(z.string()),
	})),
});
export type DataExportMessages = z.infer<typeof DataExportMessagesSchema>;
// #endregion

// #region files.json
/** The manifest of the person's own files: what each is and where to open it — never its bytes. */
export const DataExportFilesSchema = z.array(z.object({
	id,
	name: text,
	original_name: text,
	folder: text,
	mime_type: text,
	size_bytes: count,
	category: text,
	content_hash: text,
	hash_algo: text,
	hash_sampled: flag,
	status: text,
	visibility: text,
	is_archived: flag,
	starred: flag,
	link_url: text,
	link_title: text,
	created_at: when,
	updated_at: when,
	/** Opens the file in the app; needs the person to be signed in. */
	open_url: z.string(),
	/** Downloads the original; needs the person to be signed in. Never a signed link. */
	download_url: z.string(),
}));
export type DataExportFiles = z.infer<typeof DataExportFilesSchema>;
// #endregion

// #region wallet.json
export const DataExportWalletSchema = z.array(z.object({
	id,
	kind: z.enum(["user", "freelancer"]),
	currency: text,
	balance_cents: count,
	created_at: when,
	transactions: z.array(z.object({
		id,
		direction: text,
		amount_cents: count,
		currency: text,
		reason: text,
		ref_table: text,
		ref_id: text,
		balance_after_cents: count,
		fund_state: text,
		fx_rate: count,
		fx_base: text,
		fx_as_of: when,
		created_at: when,
	})),
}));
export type DataExportWallet = z.infer<typeof DataExportWalletSchema>;
// #endregion

// #region invoices.json
export const DataExportInvoicesSchema = z.object({
	issued: z.array(z.object({
		id,
		invoice_type: text,
		status: text,
		currency: text,
		subtotal_cents: count,
		platform_fee_cents: count,
		tax_cents: count,
		total_cents: count,
		amount_due_cents: count,
		billing_period_start: when,
		billing_period_end: when,
		due_date: when,
		paid_at: when,
		created_at: when,
	})),
	statements: z.array(z.object({
		period_start: when,
		period_end: when,
		currency: text,
		opening_balance_cents: count,
		closing_balance_cents: count,
		total_in_cents: count,
		total_out_cents: count,
		total_fees_cents: count,
		status: text,
		issued_at: when,
	})),
	orders: z.array(z.object({
		reference: text,
		status: text,
		placed_at: when,
		currency: text,
		subtotal_minor: count,
		creator_discount_minor: count,
		promo_discount_minor: count,
		promo_code: text,
		platform_fee_minor: count,
		tax_minor: count,
		total_minor: count,
		charged_minor: count,
		payment_method_label: text,
		created_at: when,
	})),
});
export type DataExportInvoices = z.infer<typeof DataExportInvoicesSchema>;
// #endregion

// #region reviews.json
export const DataExportReviewsSchema = z.object({
	written: z.array(z.object({
		target_type: text,
		target_id: text,
		rating: count,
		title: text,
		comment: text,
		reply: text,
		replied_at: when,
		created_at: when,
		updated_at: when,
	})),
	/** About the person, or one of their own listings. Who wrote each is never included. */
	received: z.array(z.object({
		about: z.enum(["you", "listing"]),
		listing_title: text,
		rating: count,
		title: text,
		comment: text,
		reply: text,
		replied_at: when,
		created_at: when,
	})),
});
export type DataExportReviews = z.infer<typeof DataExportReviewsSchema>;
// #endregion

// #region saved.json
export const DataExportSavedSchema = z.object({
	collections: z.array(z.object({ name: text, created_at: when })),
	bookmarks: z.array(z.object({
		entity_type: text,
		entity_id: text,
		collection: text,
		created_at: when,
	})),
});
export type DataExportSaved = z.infer<typeof DataExportSavedSchema>;
// #endregion

// #region calendar.json
export const DataExportCalendarSchema = z.object({
	entries: z.array(z.object({
		id,
		kind: text,
		status: text,
		title: text,
		starts_at: when,
		ends_at: when,
		all_day: flag,
		location: text,
		description: text,
		meeting_provider: text,
		recurrence_rule: text,
		availability_behavior: text,
		created_at: when,
		updated_at: when,
		archived_at: when,
	})),
	invitations: z.array(z.object({
		title: text,
		starts_at: when,
		ends_at: when,
		role: text,
		response: text,
		responded_at: when,
		note: text,
	})),
});
export type DataExportCalendar = z.infer<typeof DataExportCalendarSchema>;
// #endregion

// #region notifications.json
export const DataExportNotificationsSchema = z.array(z.object({
	type: text,
	category: text,
	urgency: text,
	title: text,
	body: text,
	action_url: text,
	created_at: when,
	seen_at: when,
	read_at: when,
	archived_at: when,
}));
export type DataExportNotifications = z.infer<typeof DataExportNotificationsSchema>;
// #endregion

// #region search.json
export const DataExportSearchSchema = z.object({
	queries: z.array(z.object({
		query: text,
		filters: json,
		entity_type: text,
		result_count: count,
		created_at: when,
	})),
	recent_views: z.array(z.object({
		entity_type: text,
		entity_id: text,
		view_count: count,
		first_viewed_at: when,
		viewed_at: when,
	})),
});
export type DataExportSearch = z.infer<typeof DataExportSearchSchema>;
// #endregion

// #region security.json
export const DataExportSecuritySchema = z.object({
	sign_ins: z.array(z.object({ action: text, provider: text, ip_address: text, at: when })),
	sessions: z.array(z.object({
		created_at: when,
		updated_at: when,
		refreshed_at: text,
		user_agent: text,
		ip: text,
		aal: text,
		not_after: when,
	})),
	activity: z.array(z.object({
		action: text,
		entity_table: text,
		ip: text,
		user_agent: text,
		created_at: when,
	})),
});
export type DataExportSecurity = z.infer<typeof DataExportSecuritySchema>;
// #endregion

// #region The archive
/** Each domain file's schema, by domain. */
export const DATA_EXPORT_DOMAIN_SCHEMAS = {
	profile: DataExportProfileSchema,
	emails: DataExportEmailsSchema,
	preferences: DataExportPreferencesSchema,
	projects: DataExportProjectsSchema,
	contributions: DataExportContributionsSchema,
	messages: DataExportMessagesSchema,
	files: DataExportFilesSchema,
	wallet: DataExportWalletSchema,
	invoices: DataExportInvoicesSchema,
	reviews: DataExportReviewsSchema,
	saved: DataExportSavedSchema,
	calendar: DataExportCalendarSchema,
	notifications: DataExportNotificationsSchema,
	search: DataExportSearchSchema,
	security: DataExportSecuritySchema,
} as const satisfies Record<DataExportDomain, z.ZodType>;

/** One domain file's parsed contents. */
export type DataExportDomainFile<D extends DataExportDomain> = z.infer<
	(typeof DATA_EXPORT_DOMAIN_SCHEMAS)[D]
>;

/** The file a domain is written to inside the archive. */
export function dataExportFileName(domain: DataExportDomain): string {
	return `${domain}.json`;
}

/** `manifest.json`. */
export const DataExportManifestSchema = z.object({
	manifest_version: z.literal(DATA_EXPORT_MANIFEST_VERSION),
	generated_at: at,
	request: z.object({ id, requested_at: at }),
	account: z.object({ user_id: id, handle: text }),
	domains: z.array(z.object({
		domain: DataExportDomain,
		file: z.string(),
		records: z.number().int().min(0),
	})),
}).strict();
export type DataExportManifest = z.infer<typeof DataExportManifestSchema>;
// #endregion
