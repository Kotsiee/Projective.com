import { assertEquals } from "@std/assert";
import {
	amzDateOf,
	canonicalQuery,
	encodeKeyPath,
	presignUrl,
	signRequest,
	uriEncode,
} from "./sigv4.ts";

/*
 * Vectors from the AWS SigV4 test suite (as vendored by botocore, `tests/unit/auth/aws4_testsuite`) and
 * the S3 query-string authentication example in the S3 API reference.
 */

const SUITE = {
	accessKeyId: "AKIDEXAMPLE",
	secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
	sessionToken: null,
};
const BASE = {
	method: "GET",
	host: "example.amazonaws.com",
	region: "us-east-1",
	service: "service",
	amzDate: "20150830T123600Z",
};
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const UNRESERVED = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

Deno.test("sigv4: get-vanilla — canonical request, string to sign and header match the suite", async () => {
	const signed = await signRequest({ ...BASE, canonicalPath: "/", query: [] }, SUITE, EMPTY);
	assertEquals(
		signed.canonicalRequest,
		`GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
	);
	assertEquals(
		signed.stringToSign,
		"AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n" +
			"bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
	);
	assertEquals(
		signed.headers.authorization,
		"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
			"SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
	);
	assertEquals(signed.headers["x-amz-date"], "20150830T123600Z");
});

Deno.test("sigv4: query order, UTF-8 query, UTF-8 path and unreserved characters match the suite", async () => {
	const cases: [string, [string, string][], string][] = [
		[
			"/",
			[["Param2", "value2"], ["Param1", "value1"]],
			"b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
		],
		["/", [["ሴ", "bar"]], "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04"],
		[encodeKeyPath("/ሴ"), [], "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85"],
		[
			"/",
			[[UNRESERVED, UNRESERVED]],
			"9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
		],
	];
	for (const [canonicalPath, query, expected] of cases) {
		const signed = await signRequest({ ...BASE, canonicalPath, query }, SUITE, EMPTY);
		assertEquals(signed.signature, expected);
	}
});

Deno.test("sigv4: the S3 reference's pre-signed GET reproduces exactly", async () => {
	const url = await presignUrl(
		{
			method: "GET",
			host: "examplebucket.s3.amazonaws.com",
			canonicalPath: "/test.txt",
			query: [],
			region: "us-east-1",
			service: "s3",
			amzDate: "20130524T000000Z",
		},
		{
			accessKeyId: "AKIAIOSFODNN7EXAMPLE",
			secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
			sessionToken: null,
		},
		86400,
		"https://examplebucket.s3.amazonaws.com",
	);
	assertEquals(
		url,
		"https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
			"&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
			"&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
			"&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
	);
});

Deno.test("sigv4: a session token is signed, and keys encode the way AWS canonicalises them", async () => {
	const signed = await signRequest(
		{ ...BASE, canonicalPath: "/", query: [] },
		{ ...SUITE, sessionToken: "session/token" },
		EMPTY,
	);
	assertEquals(signed.headers["x-amz-security-token"], "session/token");
	assertEquals(
		signed.headers.authorization.includes("SignedHeaders=host;x-amz-date;x-amz-security-token"),
		true,
	);
	assertEquals(encodeKeyPath("a b/c+d=(e)!.txt"), "a%20b/c%2Bd%3D%28e%29%21.txt");
	assertEquals(uriEncode("~*'"), "~%2A%27");
	assertEquals(canonicalQuery([["b", "2"], ["a", "x y"], ["a", "1"]]), "a=1&a=x%20y&b=2");
	assertEquals(amzDateOf(new Date("2026-10-21T09:05:07.123Z")), "20261021T090507Z");
});
