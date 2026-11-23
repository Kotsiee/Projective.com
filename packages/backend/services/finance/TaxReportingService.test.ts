import { assertEquals } from "@std/assert";
import {
	SELLER_TAX_REPORT_COLUMNS,
	sellerTaxReportCsv,
	toSellerTaxReport,
	toTaxDocuments,
} from "./TaxReportingService.ts";

const SELLER = "0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb";
const PROJECT = "1fee216e-a637-4619-a90a-4ae03bb1ed8b";
const CLIENT = "2e4274fb-e76b-4640-ad31-c66d7fbea842";
const FILE = "f0f9d5f0-8068-4239-ad55-8d7f1d69149d";

const row = {
	seller_type: "freelancer",
	seller_id: SELLER,
	currency: "GBP",
	quarter: 2,
	credited_minor: 6000,
	fees_minor: 315,
	gross_minor: 6315,
	activities: 1,
	profile_country: "GB",
	payout_provider: "stripe",
	payout_account_id: "acct_123",
};

Deno.test("toSellerTaxReport maps each row and drops an owner kind it does not know", () => {
	const report = toSellerTaxReport({ year: 2009, rows: [row, { ...row, seller_type: "guild" }] }, 2009);
	assertEquals(report.year, 2009);
	assertEquals(report.rows, [{
		sellerType: "freelancer",
		sellerId: SELLER,
		currency: "GBP",
		quarter: 2,
		creditedMinor: 6000,
		feesMinor: 315,
		grossMinor: 6315,
		activities: 1,
		profileCountry: "GB",
		payoutProvider: "stripe",
		payoutAccountId: "acct_123",
	}]);
	assertEquals(toSellerTaxReport(null, 2026), { year: 2026, rows: [] });
});

Deno.test("sellerTaxReportCsv writes the header, one line per row, and never a formula", () => {
	const report = toSellerTaxReport({
		year: 2009,
		rows: [row, { ...row, quarter: 3, profile_country: "=HYPERLINK(\"x\")", payout_provider: null, payout_account_id: null }],
	}, 2009);
	const lines = sellerTaxReportCsv(report).split("\r\n");
	assertEquals(lines[0], SELLER_TAX_REPORT_COLUMNS.join(","));
	assertEquals(lines[1], `2009,2,freelancer,${SELLER},GBP,6000,315,6315,1,GB,stripe,acct_123`);
	assertEquals(lines[2], `2009,3,freelancer,${SELLER},GBP,6000,315,6315,1,"'=HYPERLINK(""x"")",,`);
	assertEquals(lines[3], "");
	assertEquals(lines.length, 4);
});

Deno.test("toTaxDocuments maps documents, their one share and the targets; an unknown kind is dropped", () => {
	const docs = toTaxDocuments({
		documents: [
			{
				file_id: FILE,
				kind: "residence_certificate",
				name: "Residence 2026.pdf",
				mime_type: "application/pdf",
				size_bytes: 2048,
				created_at: "2026-11-23T10:00:00Z",
				shared: {
					project_id: PROJECT,
					project_slug: "prj-abc",
					project_title: "Brand refresh",
					client_user_id: CLIENT,
					client_name: null,
				},
			},
			{
				file_id: FILE,
				kind: "w9",
				name: "x",
				mime_type: "application/pdf",
				size_bytes: 1,
				created_at: "2026-11-23T10:00:00Z",
				shared: null,
			},
		],
		targets: [{
			project_id: PROJECT,
			project_slug: "prj-abc",
			project_title: "Brand refresh",
			client_user_id: CLIENT,
			client_name: "Tomasz Wójcik",
		}],
	});
	assertEquals(docs.documents.length, 1);
	assertEquals(docs.documents[0].shared, {
		projectId: PROJECT,
		projectSlug: "prj-abc",
		projectTitle: "Brand refresh",
		clientUserId: CLIENT,
		clientName: "",
	});
	assertEquals(docs.targets[0].clientName, "Tomasz Wójcik");
	assertEquals(toTaxDocuments(null), { documents: [], targets: [] });
});
