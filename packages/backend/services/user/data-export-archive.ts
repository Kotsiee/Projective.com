import { strToU8, zipSync } from "fflate";
import {
	DATA_EXPORT_MANIFEST_VERSION,
	DATA_EXPORT_POLICY,
	type DataExportDomain,
	DataExportDomain as DataExportDomainEnum,
	dataExportFileName,
	type DataExportManifest,
	DataExportManifestSchema,
} from "@projective/types/org";
import { recordCount } from "./data-export-collectors.ts";

/**
 * data-export-archive — the pure assembly of a personal data export (Decision #450): the manifest,
 * the README and the ZIP bytes, from the domain files the collectors produced. No I/O.
 */

/** Everything one archive is built from. */
export interface DataExportArchiveInput {
	requestId: string;
	requestedAt: string;
	userId: string;
	handle: string | null;
	generatedAt: Date;
	/** Every domain's file contents, already mapped and validated. */
	files: ReadonlyMap<DataExportDomain, unknown>;
}

/** The archive's `manifest.json`: its version, whose it is, and each domain file with its record count. */
export function buildManifest(input: DataExportArchiveInput): DataExportManifest {
	return DataExportManifestSchema.parse({
		manifest_version: DATA_EXPORT_MANIFEST_VERSION,
		generated_at: input.generatedAt.toISOString(),
		request: { id: input.requestId, requested_at: input.requestedAt },
		account: { user_id: input.userId, handle: input.handle },
		domains: DataExportDomainEnum.options.map((domain) => {
			if (!input.files.has(domain)) throw new Error(`The ${domain} file is missing.`);
			return {
				domain,
				file: dataExportFileName(domain),
				records: recordCount(input.files.get(domain)),
			};
		}),
	});
}

/** What a person reads first when they open the archive. */
export function readmeText(manifest: DataExportManifest): string {
	const lines = [
		"Your Projective data",
		"",
		`Prepared ${manifest.generated_at} for @${
			manifest.account.handle ?? manifest.account.user_id
		}.`,
		"",
		"Each .json file holds one part of your data, named by the fields it comes from. manifest.json lists",
		`them with how many records each holds, and the format's version (${manifest.manifest_version}).`,
		"",
		...manifest.domains.map((d) =>
			`  ${d.file.padEnd(20)} ${d.records} record${d.records === 1 ? "" : "s"}`
		),
		"",
		"Your files are listed in files.json with their size and checksum, and a link that opens or",
		"downloads each one once you are signed in. The files themselves are not inside this archive.",
		"",
		"Messages: only the messages you sent are included. Other people in a conversation appear by",
		"their @handle; their messages are their own data.",
		"",
		`This copy could be downloaded for ${DATA_EXPORT_POLICY.linkDays} days. Keep it somewhere safe: it holds`,
		"your personal details.",
		"",
	];
	return lines.join("\n");
}

/** The ZIP bytes: `manifest.json`, `README.txt` and one pretty-printed JSON file per domain. */
export function buildArchive(
	input: DataExportArchiveInput,
): { bytes: Uint8Array; manifest: DataExportManifest } {
	const manifest = buildManifest(input);
	const entries: Record<string, Uint8Array> = {
		"README.txt": strToU8(readmeText(manifest)),
		"manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
	};
	for (const entry of manifest.domains) {
		entries[entry.file] = strToU8(JSON.stringify(input.files.get(entry.domain), null, 2));
	}
	return { bytes: zipSync(entries, { level: 6, mtime: input.generatedAt }), manifest };
}
