/**
 * The authoring helper every legal content module uses: validate a document's versions as a family.
 *
 * Each version is parsed on its own against `LegalDocSchema` (`defineContent`), then the family is
 * checked as a whole, so a broken module fails its own unit test — and the route's first import —
 * with a sentence naming what is wrong, never by rendering a half-document.
 *
 * @module
 */
import { z } from "zod";
import { defineContent, type LegalDoc, LegalDocSchema } from "@projective/types/content";
import { compareVersions } from "../versions.ts";

/** One version as a content module writes it (the schema's input shape). */
export type LegalDocInput = z.input<typeof LegalDocSchema>;

/**
 * One clause as a content module writes it. Clauses that read the same in two versions are written
 * once, as a named constant both versions list, so an unchanged clause is unchanged by construction.
 */
export type LegalClause = LegalDocInput["sections"][number];

/**
 * Validate every version of one document (newest first) and the family rules between them:
 *
 * - at least one version; every version shares the document's `id` and `slug`;
 * - versions strictly descending (`2.0`, then `1.1`, then `1.0`) — no label used twice;
 * - effective dates never earlier than the version they replace.
 *
 * @throws {Error} naming the document and the rule it broke.
 */
export function defineLegalVersions(versions: readonly LegalDocInput[]): readonly LegalDoc[] {
	const docs = versions.map((version) => defineContent(LegalDocSchema, version));
	const [newest] = docs;
	if (!newest) throw new Error("A legal document needs at least one version");
	const label = `legal document "${newest.id}"`;
	docs.forEach((doc, i) => {
		if (doc.id !== newest.id || doc.slug !== newest.slug) {
			throw new Error(`${label}: version ${doc.version} has id/slug ${doc.id}/${doc.slug}`);
		}
		const older = docs[i + 1];
		if (!older) return;
		if (compareVersions(doc.version, older.version) <= 0) {
			throw new Error(
				`${label}: versions must be newest first and distinct (${doc.version} before ${older.version})`,
			);
		}
		if (doc.effectiveDate < older.effectiveDate) {
			throw new Error(
				`${label}: version ${doc.version} takes effect before the ${older.version} it replaces`,
			);
		}
	});
	return Object.freeze(docs);
}
