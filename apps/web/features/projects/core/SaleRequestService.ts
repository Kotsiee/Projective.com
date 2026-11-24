import { postProjects } from "./api.ts";
import type {
	DecideSaleRequestInput,
	RequestSaleInput,
	SaleRequestStatus,
} from "@projective/types/catalogue";
import type { ProjectsResult } from "../types/results.ts";

/** A request door's answer: where the request stands, and its draft once one is minted. */
export interface SaleRequestOutcome {
	requestId: string;
	status: SaleRequestStatus;
	productSlug: string | null;
}

/**
 * SaleRequestService — the dumb client service for the Overview's requests to sell (MARKETPLACE SC7).
 * It builds the JSON body and calls the transport helper; every rule (who may ask, which stage, the
 * royalty ceiling, the grant switch, the files a draft may deliver) is the server's.
 */
export const SaleRequestService = {
	/** Ask to sell an asset made on a released stage. */
	request(input: RequestSaleInput): Promise<ProjectsResult<SaleRequestOutcome>> {
		return postProjects("/api/catalogue/sale-requests", input);
	},

	/** The client grants (some of) the files asked for, or declines. */
	decide(
		requestId: string,
		input: DecideSaleRequestInput,
	): Promise<ProjectsResult<SaleRequestOutcome>> {
		return postProjects(
			`/api/catalogue/sale-requests/${encodeURIComponent(requestId)}/decide`,
			input,
		);
	},

	/** The maker withdraws an open request. */
	withdraw(requestId: string): Promise<ProjectsResult<SaleRequestOutcome>> {
		return postProjects(
			`/api/catalogue/sale-requests/${encodeURIComponent(requestId)}/withdraw`,
			{},
		);
	},
};
