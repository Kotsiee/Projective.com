import { z } from "zod";

/**
 * explore.stored — the Zod SSOT for the seller-authored JSON DOCUMENTS the discovery tables carry.
 *
 * `marketplace.service_blueprints` and `catalogue.products` / `catalogue.articles` hold several
 * ordered lists as jsonb rather than child tables — a service's stage template, a Direct
 * Deliverable's team, a product's file manifest and specification ledger, an article's body. Each is
 * authored as one unit and read back whole, which is why it is a document; and each is interpreted by
 * more than one reader (the discovery mapper, the seller console, the seed generator), which is why
 * its element shape lives HERE rather than in any of them. The database refuses only what no reader
 * could interpret (a non-array, an over-long list); the shape is validated against these schemas.
 *
 * These are STORAGE shapes, deliberately distinct from the view projections in `./view.ts`: a stored
 * stage carries a price in integer minor units and no status, seat counts or pre-formatted labels,
 * because those are derived by the reader for the viewer at hand. Parsing is lenient on read
 * ({@link parseStoredList}): one malformed element is dropped rather than taking the whole listing
 * page down with it.
 */

// #region Service stage template

/** One stage of a Pipeline / One-Off service (`service_blueprints.stage_template`). */
export const BlueprintStageSchema = z.object({
	name: z.string().trim().min(1).max(80),
	description: z.string().max(600).default(""),
	/** What this stage hands over — the "what you get" bullets on the expanded stage. */
	deliverables: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
	/** Estimated turnaround, as the seller states it (`~1 week`). */
	turnaround: z.string().max(40).optional(),
	/**
	 * The stage's price in integer MINOR units: the STANDARD per-ticket price on a Pipeline (the
	 * reader brackets it with the workload-intensity range), or the fixed milestone amount on a
	 * One-Off. Absent when the seller has not priced the stage — never a guessed zero.
	 */
	priceCents: z.number().int().min(0).optional(),
	/** Skill LABELS as the seller wrote them. */
	skills: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
});
export type BlueprintStage = z.infer<typeof BlueprintStageSchema>;

/** One named role on a Direct Deliverable's team (`service_blueprints.team_roles`). */
export const BlueprintTeamRoleSchema = z.object({
	name: z.string().trim().min(1).max(80),
	summary: z.string().max(240).default(""),
	skills: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
	count: z.number().int().min(1).max(20).default(1),
});
export type BlueprintTeamRole = z.infer<typeof BlueprintTeamRoleSchema>;

// #endregion

// #region Product documents

/**
 * One delivered file in a product's bundle (`catalogue.products.file_manifest`). `bytes` is the
 * UNCOMPRESSED payload — what the buyer unpacks — because that is the figure a buyer checks against
 * their disk and their host application.
 */
export const ProductManifestEntrySchema = z.object({
	name: z.string().trim().min(1).max(200),
	/** Human name for the format (`Blender scene`, `Source bundle`). */
	label: z.string().trim().min(1).max(80),
	/** Extension including the dot (`.blend`). */
	extension: z.string().trim().regex(/^\.[a-z0-9]{1,10}$/i),
	bytes: z.number().int().min(0),
});
export type ProductManifestEntry = z.infer<typeof ProductManifestEntrySchema>;

/** One row of a product's specification ledger (`catalogue.products.specs`). */
export const StoredProductSpecSchema = z.object({
	label: z.string().trim().min(1).max(80),
	value: z.string().trim().min(1).max(200),
});

/** One host application in a product's compatibility matrix (`catalogue.products.compatibility`). */
export const StoredProductCompatSchema = z.object({
	app: z.string().trim().min(1).max(80),
	versions: z.string().trim().min(1).max(120),
});

// #endregion

// #region Article body

/**
 * One block of an article body as STORED (`catalogue.articles.body`).
 *
 * The one difference from the view's `ArticleBlock` is how an image is referenced: stored as the
 * OBJECT (`bucket` + `path`), never as a URL. A URL is a deployment fact — which host the browser
 * reaches storage on — and one written into a document would silently point at the wrong host the
 * moment the document outlived the deployment that wrote it. The reader resolves it.
 */
export const StoredArticleBlockSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum(["heading", "subheading"]),
		/** The stable anchor the table of contents links to. */
		id: z.string().trim().min(1).max(120).optional(),
		text: z.string().trim().min(1).max(200),
	}),
	z.object({
		type: z.enum(["paragraph", "quote"]),
		text: z.string().trim().min(1).max(4000),
	}),
	z.object({
		type: z.literal("list"),
		items: z.array(z.string().trim().min(1).max(400)).min(1).max(40),
	}),
	z.object({
		type: z.literal("image"),
		bucket: z.string().trim().min(1),
		path: z.string().trim().min(1),
		alt: z.string().max(200).default(""),
		caption: z.string().max(300).optional(),
	}),
]);
export type StoredArticleBlock = z.infer<typeof StoredArticleBlockSchema>;

// #endregion

// #region Lenient list parsing

/**
 * Parse a stored jsonb list element by element, dropping what does not match.
 *
 * Lenient on purpose. A document is authored by a seller and read on a public page; one element that
 * fails validation (a stage with an empty name, a manifest entry with a bad extension) should cost
 * that element, not the whole listing. A non-array reads as empty — the table's CHECK already refuses
 * one, so reaching it means a row written around that constraint, and an empty list is the honest
 * rendering of a document nobody can read.
 */
export function parseStoredList<T>(schema: z.ZodType<T>, raw: unknown): T[] {
	if (!Array.isArray(raw)) return [];
	const out: T[] = [];
	for (const element of raw) {
		const parsed = schema.safeParse(element);
		if (parsed.success) out.push(parsed.data);
	}
	return out;
}

// #endregion

// #region Licence

/** The licence a product is sold under (`catalogue.products.licence`). */
export const ProductLicenceKey = z.enum(["standard", "extended"]);
export type ProductLicenceKey = z.infer<typeof ProductLicenceKey>;

/**
 * The terms of a licence — PLATFORM POLICY, not seller copy. A licence is a term of the sale, so
 * what "standard" permits has to mean the same thing on every product, in every seller's shop; the
 * seller chooses WHICH licence, never what it says.
 *
 * Stated as explicit allowed/denied permissions rather than a list of only the permitted things: an
 * omitted permission reads as an oversight, a denied one reads as a term. Every row is phrased as a
 * RIGHT the buyer gets ("Use without attribution"), never an obligation — on an allowed/denied axis a
 * constraint would put a check mark against something the buyer must do.
 *
 * An unrecognised key resolves to the NARROWER licence. Granting a buyer rights the seller never
 * offered is the failure that cannot be taken back; under-stating them is merely conservative.
 */
export function licenceTerms(
	key: string,
	attributionRequired: boolean,
): { name: string; summary: string; permissions: Array<{ label: string; allowed: boolean }> } {
	const extended = key === "extended";
	return {
		name: extended ? "Extended commercial licence" : "Standard commercial licence",
		summary: extended
			? "Use in unlimited commercial projects, including work delivered to your own clients and products offered for resale."
			: "Use in your own commercial projects. Redistributing the source files, and reselling this as a competing product, are not permitted.",
		permissions: [
			{ label: "Personal use", allowed: true },
			{ label: "Commercial use", allowed: true },
			{ label: "Use in client deliverables", allowed: extended },
			{ label: "Modify and adapt", allowed: true },
			{ label: "Redistribute source files", allowed: false },
			{ label: "Resell as a competing product", allowed: false },
			{ label: "Use without attribution", allowed: !attributionRequired },
		],
	};
}

// #endregion
