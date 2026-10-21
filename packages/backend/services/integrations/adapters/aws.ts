import { serverEnv } from "../../../core/env.ts";
import { type ErrorClassifier, providerFetch } from "./adapter-support.ts";
import { amzDateOf, canonicalQuery, signRequest, type SigV4Credentials } from "./sigv4.ts";
import { StorageAdapterError, type StorageNet } from "./StorageAdapter.ts";

/**
 * aws — what the `s3` connector needs from AWS beyond SigV4: its XML, its partitions, and STS.
 *
 * An AWS bucket is reached by ROLE ASSUMPTION, never by a stored key (Decision #314):
 *
 * - The customer creates an IAM role in their own account whose trust policy names Projective's AWS
 *   account and an `sts:ExternalId` condition; the connection stores only that role's ARN.
 * - The platform principal (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) calls `AssumeRole` on it, and
 *   every bucket request is signed with the temporary credentials STS returns.
 * - The external id is DERIVED from the connection's id ({@link s3ExternalIdOf}), never typed in: a
 *   customer who names another customer's role ARN is refused by that role's own trust policy, which
 *   names the other connection's id. That is the confused-deputy guard the external id exists for.
 * - A session lasts an hour and is reused only while the caller's minimum still fits inside it, so a
 *   pre-signed download never outlives the session that signed it.
 */

// #region XML

function decodeXml(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1] === "x"
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : "";
		}
		return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity] ?? "";
	});
}

/** The decoded text of the first `<tag>` in `xml`, or `null` when there is none. */
export function xmlText(xml: string, tag: string): string | null {
	const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	return match ? decodeXml(match[1]) : null;
}

/** The raw inner XML of every `<tag>` in `xml`. */
export function xmlBlocks(xml: string, tag: string): string[] {
	return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

// #endregion

// #region Partitions

/** An AWS partition — the DNS and IAM namespace a region belongs to. */
export type AwsPartition = "aws" | "aws-cn" | "aws-us-gov";

const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

/** The partition of an AWS region id, or `null` when it is not one. */
export function awsPartitionOf(region: string): AwsPartition | null {
	if (!AWS_REGION.test(region)) return null;
	if (region.startsWith("cn-")) return "aws-cn";
	if (region.startsWith("us-gov-")) return "aws-us-gov";
	return "aws";
}

/** The DNS suffix a partition's service endpoints live under. */
export function awsDnsSuffixOf(partition: AwsPartition): string {
	return partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
}

/** The partition an ARN names — `arn:{partition}:…`. */
export function arnPartitionOf(arn: string): string {
	return arn.split(":")[1] ?? "";
}

// #endregion

// #region STS

const STS = "AWS STS";
const PLACEHOLDER = "XXXX-XXXX";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** The session length asked of STS: an hour, the most every role allows by default. */
export const ASSUME_ROLE_SECONDS = 3_600;

/** The external id an AWS connection's role trust policy must name — derived, never chosen. */
export function s3ExternalIdOf(connectionId: string): string {
	return `projective-${connectionId}`;
}

/** The platform principal that assumes customers' roles, or `null` while unset or the placeholder. */
export function s3PlatformPrincipal(): SigV4Credentials | null {
	const env = serverEnv();
	const accessKeyId = env.s3AccessKeyId?.trim();
	const secretAccessKey = env.s3SecretAccessKey?.trim();
	if (
		!accessKeyId || !secretAccessKey || accessKeyId === PLACEHOLDER ||
		secretAccessKey === PLACEHOLDER
	) {
		return null;
	}
	return { accessKeyId, secretAccessKey, sessionToken: null };
}

/** One role to assume, for one connection. */
export interface AssumeRoleRequest {
	connectionId: string;
	roleArn: string;
	/** The bucket's region — its regional STS endpoint is the one called. */
	region: string;
	partition: AwsPartition;
	principal: SigV4Credentials;
	/** A cached session is reused only while it has at least this many seconds left. */
	minRemainingSeconds: number;
}

interface Session {
	credentials: SigV4Credentials;
	expiresAt: number;
}

const sessions = new Map<string, Session>();
const inflight = new Map<string, Promise<Session>>();

/** Forget every cached and in-flight session. */
export function clearAssumedRoles(): void {
	sessions.clear();
	inflight.clear();
}

const classify: ErrorClassifier = (_status, body) => {
	const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
	if (/^(AccessDenied|ValidationError|MalformedPolicyDocument)$/.test(code)) return "misconfigured";
	if (
		/^(InvalidClientTokenId|SignatureDoesNotMatch|IncompleteSignature|ExpiredToken|RegionDisabledException)$/
			.test(code)
	) {
		return "unavailable";
	}
	if (code === "Throttling") return "rate_limited";
	return null;
};

function reworded(error: unknown): unknown {
	if (!(error instanceof StorageAdapterError)) return error;
	if (error.code === "misconfigured") {
		return new StorageAdapterError(
			"misconfigured",
			"S3: the role refused Projective — its trust policy must name Projective's AWS account and " +
				"this connection's external id.",
			{ status: error.status, cause: error },
		);
	}
	if (error.code === "unavailable") {
		return new StorageAdapterError(
			"unavailable",
			"S3: the platform's AWS principal was refused, so AWS buckets cannot be reached.",
			{ status: error.status, cause: error },
		);
	}
	return error;
}

async function requestSession(net: StorageNet, request: AssumeRoleRequest): Promise<Session> {
	const host = `sts.${request.region}.${awsDnsSuffixOf(request.partition)}`;
	const query: [string, string][] = [
		["Action", "AssumeRole"],
		["DurationSeconds", String(ASSUME_ROLE_SECONDS)],
		["ExternalId", s3ExternalIdOf(request.connectionId)],
		["RoleArn", request.roleArn],
		["RoleSessionName", `projective-${request.connectionId}`],
		["Version", "2011-06-15"],
	];
	const signed = await signRequest(
		{
			method: "GET",
			host,
			canonicalPath: "/",
			query,
			region: request.region,
			service: "sts",
			amzDate: amzDateOf(net.now()),
		},
		request.principal,
		EMPTY_SHA256,
	);
	let xml: string;
	try {
		const response = await providerFetch(net, STS, `https://${host}/?${canonicalQuery(query)}`, {
			method: "GET",
			headers: signed.headers,
		}, classify);
		xml = await response.text();
	} catch (error) {
		throw reworded(error);
	}
	const accessKeyId = xmlText(xml, "AccessKeyId");
	const secretAccessKey = xmlText(xml, "SecretAccessKey");
	const sessionToken = xmlText(xml, "SessionToken");
	const expiresAt = Date.parse(xmlText(xml, "Expiration") ?? "");
	if (!accessKeyId || !secretAccessKey || !sessionToken || !Number.isFinite(expiresAt)) {
		throw new StorageAdapterError("provider_error", `${STS} answered without credentials.`);
	}
	return { credentials: { accessKeyId, secretAccessKey, sessionToken }, expiresAt };
}

/**
 * Temporary credentials for a connection's role: a cached session while it still has the caller's
 * minimum left, else one fresh `AssumeRole` shared by every concurrent caller. A failure is never
 * cached.
 */
export async function assumeRole(
	net: StorageNet,
	request: AssumeRoleRequest,
): Promise<SigV4Credentials> {
	const key = `${request.connectionId}\n${request.roleArn}`;
	const cached = sessions.get(key);
	if (cached && cached.expiresAt - net.now().getTime() >= request.minRemainingSeconds * 1_000) {
		return cached.credentials;
	}
	const pending = inflight.get(key);
	if (pending) return (await pending).credentials;
	const run = requestSession(net, request)
		.then((session) => {
			sessions.set(key, session);
			return session;
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, run);
	return (await run).credentials;
}

// #endregion
