# HTTP QUERY — Evaluation for the Projective Read API

> **Status: EVALUATION. Recommendation: DO NOT IMPLEMENT YET.**
>
> This document assesses whether the fifteen read endpoints under `apps/web/routes/api/projects/`
> and `apps/web/routes/api/messaging/` should move from `GET` to the proposed HTTP `QUERY` method.
> It concludes that three of the fifteen would genuinely benefit, that the benefit is **not** the
> one usually claimed (payload size), and that adopting it today would be a net regression because
> Fresh cannot route the method and no cache anywhere in the delivery path stores its responses. §9
> states the exact conditions that would reverse this recommendation.
>
> This is an evaluation, not a plan of record. Nothing here changes a shipped contract.

> **Location deviation, recorded deliberately.** The originating brief specified
> `docs/architecture/`. Root [`CLAUDE.md`](../../CLAUDE.md) §0 states: _"All markdown documentation
> lives under `documentation/`. Do not create docs elsewhere."_ There is no `docs/` directory in
> this repository and `documentation/architecture/` already holds
> [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) and [`ROUTING.md`](./ROUTING.md). The repo
> guardrail wins; the file lives here. Per root §8, the divergence is surfaced rather than resolved
> silently.

---

## 0. Scope, provenance and how the numbers were produced

Fifteen `GET` handlers exist across the two route families (sixteen files; `projects/create.ts` is
`POST`-only). The fifteenth is `/api/messaging/settings`, which is `GET`+`POST` and is a preference
read/write rather than a pure read.

Every quantitative claim below was produced by **execution**, not by reading a specification:

| Claim class             | How it was established                                                                                                        |
| :---------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| URL and body sizes      | Query strings built with the real `URLSearchParams` serialisation the client services use; `.length` / `TextEncoder` measured |
| Deno runtime support    | A live `Deno.serve` + `fetch` round trip on `deno 2.9.4`                                                                      |
| Fresh routing behaviour | The resolved `@fresh/core@2.3.3` `UrlPatternRouter` imported and driven directly                                              |
| Everything else         | Read from the working tree at the paths cited                                                                                 |

Appendix A records the scripts, the versions and — as importantly — what was **not** verified.

> **The tree was in motion during this pass.** A concurrent session is migrating these routes onto
> the new `defineReadRoute` factory (`apps/web/utils/read-endpoint.ts`). At the time of writing
> exactly one route — `apps/web/routes/api/projects/list.ts` — had been migrated; the other fourteen
> still declare a bare `define.handlers({ GET(ctx) { … } })`. That migration is the single most
> important thing that has happened for a future QUERY transition, and §7/§8 build on it.

---

## 1. What HTTP QUERY is

`QUERY` is a new HTTP method specified by **`draft-ietf-httpbis-safe-method-w-body`**, an
Internet-Draft adopted by the IETF HTTP Working Group. It is, in one line, **`GET` with a request
body**: a method that is simultaneously **safe**, **idempotent**, **cacheable**, and carries request
content.

### 1.1 The combination is the whole point

Each of those four properties exists in the methods we already have. No existing method has all
four, and that is the gap.

| Property                   | `GET`                                                                                                | `POST`                                                                               | `QUERY` |
| :------------------------- | :--------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- | :------ |
| Safe (no state change)     | yes                                                                                                  | **no**                                                                               | yes     |
| Idempotent (retry is free) | yes                                                                                                  | **no**                                                                               | yes     |
| Cacheable by default       | yes                                                                                                  | **no** (only with explicit freshness + `Content-Location`, which nothing implements) | yes     |
| Carries request content    | **no** (RFC 9110 §9.3.1: content on a `GET` has no defined semantics; implementations may reject it) | yes                                                                                  | yes     |

Safety is not decorative bookkeeping. It is the property that tells every participant in the request
— the browser, a proxy, a retry wrapper, a crawler, and the person reading an access log — that
re-issuing the request costs nothing. Losing it costs three concrete things: an interrupted request
cannot be retried automatically, speculative prefetch is off the table, and a log line no longer
distinguishes a read from a write. Idempotence is what licenses the retry. Cacheability is what
makes a validator worth minting.

So a complex read today must choose one of two compromises:

- **Encode everything in the URL and keep `GET`.** Correct semantics; an unbounded request target,
  and every parameter becomes a log artefact.
- **Move to `POST`.** Unbounded structured input; the read is now indistinguishable from a write to
  every intermediary, is not cacheable, and cannot be retried safely.

`QUERY` is the third option, and it is the only one that is not a compromise.

### 1.2 The two mechanics that make it work

The draft resolves the two obvious objections:

1. **"How does a cache key a request whose input is in the body?"** By incorporating the request
   content into the cache key. This is the load-bearing addition — it is what separates `QUERY` from
   "a `POST` we promised to be well-behaved about".
2. **"How do you bookmark or share a query?"** A `QUERY` response may carry `Content-Location`
   naming a `GET`-able URI that returns the same representation. The query has a URL when it needs
   one; it just is not the request target.

The draft has also carried an **`Accept-Query`** response header for a resource to advertise which
query media types it accepts, returned on `OPTIONS`. Treat that name as provisional — an
Internet-Draft is not a stable contract, and this one has been revised repeatedly. **Re-read the
current revision before writing a line of code against it.**

### 1.3 Status

Internet-Draft. Not an RFC. Not scheduled. The method name is stable, the semantics are stable, the
header spellings and the exact caching rules are not. That is the correct posture for a draft and it
is a genuine reason not to ship against it yet — but it is the _least_ important of the blockers in
§6.

---

## 2. Endpoint audit

### 2.1 Method

An endpoint benefits from `QUERY` in proportion to (a) how much structure its input has that a query
string cannot express natively, (b) how long its worst realistic request target gets, and (c) how
sensitive its parameters are as a log artefact. It does **not** benefit merely from having a lot of
parameters, and it does not benefit at all from having one.

Worst realistic case, per endpoint, means: every facet exercised, a plausible free-text term, a real
36-character UUID wherever an id appears, and the deepest cursor or path the schema permits.

### 2.2 The fifteen

| #      | Endpoint                           | Array / repeated params                                                      | Cursor           | Worst URL |  Body | Verdict       |
| :----- | :--------------------------------- | :--------------------------------------------------------------------------- | :--------------- | --------: | ----: | :------------ |
| **M1** | `GET /api/messaging/conversations` | **5 unbounded** — `rel` `svc` `prod` `entity` `member`, each an OR-set       | forward, raw id  | **7,108** | 6,549 | **Recommend** |
| **P1** | `GET /api/projects/list`           | **7** — `workspaces` `roles` `formats` `statuses` `kinds` `quick` `requests` | none             | **1,042** | 1,077 | **Recommend** |
| **P6** | `GET /api/projects/submissions`    | **2** — `path` (≤12 segments) + `kinds`                                      | forward, raw id  |   **881** |   879 | **Recommend** |
| P5     | `GET /api/projects/files`          | 1 — `kinds` (≤9)                                                             | forward, raw id  |       305 |   297 | Marginal      |
| M4     | `GET /api/messaging/files`         | 1 — `kinds` (≤8)                                                             | forward, raw id  |       266 |   253 | Marginal      |
| P7     | `GET /api/projects/board`          | none                                                                         | none             |       215 |   199 | No            |
| P8     | `GET /api/projects/members`        | none (3 `sim*` flags)                                                        | none             |       206 |   182 | No            |
| P4     | `GET /api/projects/messages`       | none                                                                         | backward, raw id |       184 |   155 | No            |
| M3     | `GET /api/messaging/messages`      | none                                                                         | backward, raw id |       155 |   121 | No            |
| M5     | `GET /api/messaging/members`       | none                                                                         | none             |        98 |    59 | No            |
| P2     | `GET /api/projects/item`           | none — one `slug`                                                            | none             |        75 |    39 | No            |
| P3     | `GET /api/projects/detail`         | none — one `slug`                                                            | none             |        75 |    39 | No            |
| M6     | `GET /api/messaging/contacts`      | none                                                                         | none             |        73 |    37 | No            |
| M2     | `GET /api/messaging/conversation`  | none — one `id`                                                              | none             |        60 |    27 | No            |
| M7     | `GET /api/messaging/settings`      | none                                                                         | none             |        59 |    19 | No            |

Lengths are characters of the full absolute URL against a 22-character origin; bodies are UTF-8
bytes of the equivalent JSON. M1 is shown at 40 ids per facet; see §2.3 for the sensitivity curve.

### 2.3 The three that would benefit

#### M1 · `/api/messaging/conversations` — the only endpoint whose URL actually breaks

This is the strongest candidate by a wide margin, and the only one where the URL-length argument is
real rather than theoretical.

`ConversationListParamsSchema` (`packages/types/messaging/conversations.ts`) nests a
`ConversationFilterSchema` of **five independent arrays** — `relations` (8-member enum),
`serviceIds`, `productIds`, `entityIds`, `memberIds` (each `z.string().max(80)`). **None of the five
has a length cap.** `buildConversationQuery` in
`apps/web/features/messaging/core/MessagingService.ts` flattens them to repeated keys
(`qs.append("rel", r)`), so each selected id costs its own `&key=value`.

Measured, with all 8 relations selected and _n_ ids in each of the four id facets:

| ids per facet | full URL | JSON body | crosses ~2,000? |
| ------------: | -------: | --------: | :-------------- |
|             4 |      952 |       933 | no              |
|            12 |    2,320 |     2,181 | **yes**         |
|            40 |    7,108 |     6,549 | **yes**         |

Twelve is not a stress test. A freelancer filtering their inbox by the twelve clients they worked
with last quarter produces it. The semantics are also the ones a query string is worst at: five
**independent OR-sets, AND-combined across facets** (`passesFilter`), expressed as five interleaved
repeated keys with no grouping. A JSON object states that structure directly.

#### P1 · `/api/projects/list` — the most structured input in the codebase

Fifteen fields, seven of them arrays, over five closed enums plus two free id lists. Worst realistic
target: **1,042 characters** — under any hard ceiling, but the structure is the argument, not the
size.

Two specifics worth naming:

- **`q` has no length cap at all.** `ProjectFeedParamsSchema.q` is a bare `z.string()`
  (`packages/types/projects/feed.ts:102`), where the messaging sibling caps at `.max(200)`. An
  unbounded, user-typed free-text string is currently concatenated into a request line. That is a
  defect independent of `QUERY` and is listed in §8.
- **`toSearchParams` uses comma-joined lists** while `parseProjectParams` accepts _both_ comma lists
  and repeated keys. Two wire encodings for one logical value, and the round trip is only stable
  because one side happens to be a superset of the other.

#### P6 · `/api/projects/submissions` — a tree path flattened into a string and re-split

`SubmissionListParamsSchema.path` is `z.array(z.string().max(120)).max(12)` — an ordered chain of
tree segments. `SubmissionsService` joins it with `/`, `URLSearchParams` then percent-encodes every
separator to `%2F`, and the route splits it back apart:

```ts
const path = pathRaw.split("/").map((s) => s.trim()).filter(Boolean).slice(0, 12);
```

Measured with twelve 44-character slugs (under the 48-character `slug()` cap that
`submissions-fixtures.ts` enforces): the `path` value alone is **539 characters decoded, 561
encoded**, inside an **881-character** URL. An array is serialised to a string, escaped,
transmitted, unescaped and re-parsed — and a segment containing a literal `/` would silently split
into two nodes, which matters because these segments **are** URL path segments for
`/projects/[id]/submissions/[...path]` and Decision #65 made the ticket modal address the same nodes
by the same paths.

A body carries `path` as the array it already is. No join, no escape, no re-split, no ambiguity.

### 2.4 The twelve that would not

- **P2 `item`, P3 `detail`, M2 `conversation`** take a **single scalar key** — a slug or an id. A
  request body here is pure overhead: a `Content-Type` header, a length header, a serialise, a
  parse, and a method no cache understands, in exchange for moving one 27-character string off the
  request line. `GET /api/projects/detail?slug=northwind-packaging-refresh` is 75 characters and is
  exactly what a `GET` is for.
- **M5 `members`, M6 `contacts`, M7 `settings`** are the same shape with one or two scalars. M7 is
  additionally `GET`+`POST` on one route; introducing a third method there buys nothing and
  complicates the verb table.
- **P4 / M3 `messages`** take an id pair plus a backward cursor and a limit. Flat, bounded, small
  (184 / 155 characters at maximum). These are also the highest-frequency reads in the product —
  every scroll-up fires one — and they are precisely the requests that most want the browser's
  automatic conditional revalidation, which §5.3 shows `QUERY` takes away.
- **P7 `board`** is six scalars, 215 characters. Its payload is the heaviest in either family — the
  full attachment, history, submission and payment graph per card — but that is a **response**
  problem, addressed by `HEAD`, `ETag`, and the ARC cache. `QUERY` changes nothing about it.
- **P8 `members`** is three scalars plus three `sim*` flags. Note separately that those `sim*`
  parameters are accepted from any caller with **no `DENO_ENV=development` gate** — the
  privilege-forgery shape Decision #72 established and fixed on the scheduling surface. That is a
  live security issue and it is orthogonal to this document; it needs fixing regardless of the verb.
- **P5 / M4 `files`** are marginal rather than negative. Their only structured input is a `kinds`
  enum array of at most nine members, and they top out at 305 / 266 characters. They would come
  along for free with a shared factory (§7 Phase 4); they would not justify one.

---

## 3. The status quo's real failure modes

### 3.1 URL length is a real ceiling — and mostly not this codebase's problem

The conventional safe-interop figure is **~2,000 characters**. It descends from Internet Explorer's
2,083-byte maximum and survives because every deployment guide repeats it. The hard stops that
actually matter in a plausible deployment path are lower than folklore suggests and vary by layer:

| Layer                                     | Typical limit                                    | Failure mode                     |
| :---------------------------------------- | :----------------------------------------------- | :------------------------------- |
| Apache `LimitRequestLine`                 | 8,190 bytes (default)                            | `414 URI Too Long`               |
| nginx `large_client_header_buffers`       | `4 8k` (default) — one request line ≤ 8 KB       | `414`                            |
| WAFs, corporate proxies, logging sidecars | varies, frequently much lower, rarely documented | reject, or **truncate silently** |

The last row is the dangerous one. A truncated query string arrives at the application as a
_syntactically valid request with missing filters_, and the response is a correct answer to a
question nobody asked. The application never sees the truncation, the client cannot distinguish it
from an empty facet, and nothing logs an error.

**Of the fifteen endpoints, exactly one crosses 2,000 characters**, and only above roughly twelve
ids per facet (M1). This is the single most important corrective in this document: the URL-length
argument for `QUERY` is real for one endpoint and rhetorical for the other fourteen.

### 3.2 Bodies are not smaller — measured

The size argument is routinely stated backwards. Comparing the measured request target against the
equivalent JSON body:

| Endpoint                         |   URL | JSON body | Δ                     |
| :------------------------------- | ----: | --------: | :-------------------- |
| `projects/list`                  | 1,042 |     1,077 | **body is 3% LARGER** |
| `projects/submissions`           |   881 |       879 | identical             |
| `messaging/conversations` (n=12) | 2,320 |     2,181 | body 6% smaller       |
| `messaging/conversations` (n=40) | 7,108 |     6,549 | body 8% smaller       |

Percent-encoding overhead and JSON's structural punctuation very nearly cancel. **`QUERY` is not a
compression mechanism, and any proposal that justifies it on payload size should be rejected on the
numbers.** Its benefits are: escaping the request-line budget entirely (a body has a different and
far larger one), moving parameters out of the request target, and carrying structure natively.

### 3.3 The query string is a log artefact

A query string is part of the request line. It is written to every access log along the path,
appears in HAR exports attached to bug reports, and lands in error-tracking breadcrumbs. For these
endpoints that content includes:

- `q` on `/api/projects/list` — user-typed free text, **no length cap**, unbounded.
- `q` on `/api/messaging/conversations` — user-typed, capped at 200.
- `member`, `entity`, `svc`, `prod` — sets of ids that describe **who a person is filtering their
  inbox down to**. The set is more disclosive than any single member of it.

**Two honest scoping caveats**, because this argument is easy to overstate:

1. **`Referer` does not apply to these URLs.** `apps/web/routes/_middleware.ts:41` sets
   `referrer-policy: strict-origin-when-cross-origin`, which sends the full URL same-origin — but an
   `/api/*` URL is never a document URL, so it never becomes anyone's `Referer`.
2. **The exposure that does exist is on the page URL, and `QUERY` cannot help it.**
   `serializeProjectParams` writes the same facets into `/projects?…` via `history.pushState`. That
   URL is shareable **by design** (Decision #12: "real-time, shareable URL") and it is the one that
   reaches `Referer`, bookmarks, browser history and pasted links. Moving the API call to a body
   removes the log-line copy; it does not remove the address-bar copy, and it should not, because
   the address-bar copy is a product feature.

So: a genuine improvement to server-side log hygiene, and not a privacy fix.

### 3.4 Cache-key permutations — and precisely what the ARC cache does and does not solve

Two logically identical queries whose parameters differ in order are different URLs, and therefore
different cache entries in every HTTP intermediary.

`packages/backend/core/cache.ts` already solves half of this server-side.
`cacheKey(tenant,
namespace, params)` builds its key through `stableStringify`, whose docblock is
explicit about the asymmetry:

> Object keys are sorted, because `{a,b}` and `{b,a}` are one query and must not be two entries.
> Array order is PRESERVED, because it is semantic everywhere it appears in these params (a sort
> order, a cursor path, a facet list the UI renders in order) and sorting it would merge two
> genuinely different requests.

That is the right call for `path` (an ordered tree chain, where order _is_ the meaning). It is
**exactly wrong for the facet sets**, where order carries no meaning and the client emits values in
UI selection order. Choosing _k_ relations out of eight yields _k!_ distinct keys for one logical
query:

| relations selected | distinct orderings |
| -----------------: | -----------------: |
|                  2 |                  2 |
|                  3 |                  6 |
|                  4 |                 24 |
|                  5 |                120 |
|                  8 |             40,320 |

And **`QUERY` does not fix this either.** A body with `["client","team"]` is a different body from
`["team","client"]`, so it is a different cache key under the draft's content-keyed rule too. The
fix is canonical ordering — sort the unordered facets at the boundary, leave the ordered ones alone
— and it is available today, under `GET`, with no draft dependency. It is item 4 in §8.

### 3.5 The parser is the real cost of the URL

This is the cost that is paid every day, and it is the one the size tables miss.

Because a query string is flat strings, each route hand-rolls its own coercion layer: `SORT_KEYS`
and `KINDS` whitelists, `Number.parseInt` with `Number.isFinite` guards, `sp.get("x") || undefined`
chains, `"1"`/`"0"`/`"true"` boolean spellings — replicated across six files with small divergences.
**No read route calls `.parse()` on its own Zod SSOT.** The schema documents a contract the route
does not enforce.

The drift this produces is already shipping. `FileListParamsSchema` permits **nine** file kinds —
including `link` — with `.max(9)`. `SubmissionListParamsSchema` permits eight. And the hand-written
`KINDS` whitelists in `projects/files.ts`, `projects/submissions.ts` and `messaging/files.ts` all
list **eight**, omitting `link`. A client that requests `kinds=link` has that value silently dropped
by a `.filter()` on the way in, and receives an unfiltered page with no error. Three copies of one
list, one of which is a different length from the schema it claims to implement.

A body would make the route `Schema.parse(await ctx.req.json())` and delete all six coercion layers.
But so would calling `Schema.parse` on a normalised object built from the query string — which is
§8's first item, needs no new HTTP method, and can land this week.

---

## 4. Proposed payload bodies

Field names below are taken from the actual Zod schemas, not invented. Each mirrors its
`…ParamsSchema` exactly, so the handler body would be a single `parse` call.

### M1 · `QUERY /api/messaging/conversations` — `ConversationListParamsSchema`

```json
{
	"q": "packaging",
	"view": "inbox",
	"unread": true,
	"role": "freelancer",
	"cursor": "grp-northwind-packaging-programme-2026",
	"limit": 30,
	"filter": {
		"relations": ["client", "co_freelancer", "team_member"],
		"serviceIds": ["sv-brand-identity-sprint", "sv-packaging-art-direction"],
		"productIds": [],
		"entityIds": ["3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3"],
		"memberIds": ["mara", "ivy", "sofia"]
	}
}
```

The nesting is the point. `filter` is one object with five sibling OR-sets, which is the shape
`passesFilter` consumes — instead of five interleaved repeated keys the reader has to mentally
regroup. `cursor` is `.nullable().optional()`, the only field in either family that is both, and
JSON distinguishes `null` from absent natively where a query string cannot.

### P1 · `QUERY /api/projects/list` — `ProjectFeedParamsSchema`

```json
{
	"q": "brand identity refresh",
	"view": "engagements",
	"involvement": "worker",
	"sort": "alphabetical",
	"scope": "global",
	"scopeType": "organisation",
	"scopeId": "3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3",
	"workspaces": ["3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3", "8c1d40b9-2e77-4a13-b5fe-0d9a6c3e1f52"],
	"roles": ["owner", "admin"],
	"formats": ["pipeline", "session"],
	"statuses": ["active", "on_hold"],
	"kinds": ["service"],
	"quick": ["starred", "unread", "revision_requested"],
	"requests": ["client_invite"],
	"serviceId": ""
}
```

Every field is required in the schema, so the body is total — there is no "omitted means default"
ambiguity for the parser to resolve, and `scopeType: null` (active context) is expressible as
something other than an empty string.

### P6 · `QUERY /api/projects/submissions` — `SubmissionListParamsSchema`

```json
{
	"projectId": "3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3",
	"channelId": "stage-3-production-artwork",
	"path": ["stage-3-production-artwork", "mara", "revision-2-packaging-dielines"],
	"sort": "date",
	"dir": "desc",
	"kinds": ["image", "pdf"],
	"query": "dieline",
	"asFreelancer": false,
	"cursor": "f-3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3-attachment-0042",
	"limit": 60
}
```

`path` is an array on the wire, which removes the join/escape/split round trip entirely and with it
the class of bug where a segment containing the separator splits into two tree nodes.

### P5 / M4 · `QUERY /api/projects/files` · `QUERY /api/messaging/files` — `FileListParamsSchema`

```json
{
	"projectId": "3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3",
	"channelId": "stage-3-production-artwork",
	"sort": "size",
	"dir": "asc",
	"kinds": ["image", "video", "pdf", "link"],
	"query": "packaging dieline v4",
	"cursor": "f-3f2a91c4-7b8e-4d51-9a06-c2ee81f4d7b3-attachment-0042",
	"limit": 60
}
```

Note `"link"` — legal per the schema's nine-member enum, and silently dropped by all three routes
today (§3.5). `messaging/files` would take `conversationId` rather than the current
`conversationId ?? projectId` legacy alias; a new verb is a free opportunity to retire an alias
without breaking the `GET` that still honours it.

---

## 5. Caching under QUERY

### 5.1 ETag and `If-None-Match` carry over unchanged

Nothing in `apps/web/utils/read-endpoint.ts` is method-specific. It serialises the payload once,
hashes the exact transmitted bytes into a strong validator (SHA-256 truncated to 128 bits), and
`ifNoneMatchSatisfied` implements the weak comparison function RFC 9110 §8.8.3.2 requires for
`If-None-Match`, across the comma-separated list. It sends `private, no-cache, must-revalidate` on
success and `no-store` on failure, so an error can never be pinned in front of a resource that has
since started existing.

All of that is correct for `QUERY` verbatim. The validator logic is not the problem.

### 5.2 The cache key must come from the body — and already does

The draft requires a cache to incorporate request content into the cache key. **This codebase's
server-side cache already keys on the parameter object rather than the query string**, which makes
it the single most transition-ready component in the stack:

```ts
export function cacheKey(tenant: CacheTenant, namespace: string, params?: unknown): string;
```

`params` is the parsed object. Whether it arrived as a query string or as a JSON body is invisible
to the key. `stableStringify` sorts object keys and preserves array order (§3.4), the tenant leads
the key so `clearTenant` can match on a prefix, and `CacheTenant` is non-optional by construction so
no overload can produce a global key by omission — which matters here because every one of these
payloads is a per-viewer projection.

Two things to carry forward:

- **The array-order caveat of §3.4 applies to the body identically.** Canonicalise unordered facets
  before they reach `cacheKey`, or one logical query keeps producing _k!_ entries.
- **`cache.ts` contains six literal NUL bytes** as its key delimiter. The choice is deliberate and
  documented — no id this system mints can contain one, so no value can be crafted to collide — but
  it makes the file binary to `git` and invisible to `grep`, which is the exact defect class
  recorded as Decision #67(2) for `fingerprint.ts`. Flagged, not changed: it is outside this
  evaluation.

### 5.3 The regression nobody expects — and the reason this recommendation is "not yet"

**A browser HTTP cache is keyed by method and URL. It does not store `QUERY` responses. Neither does
any CDN, reverse proxy or Service Worker `Cache` in production today** — the Cache API's `put()`
explicitly rejects a non-`GET` request with a `TypeError`.

Follow that through against what these endpoints do today:

| Under `GET` (today)                                                 | Under `QUERY` (today)                                     |
| :------------------------------------------------------------------ | :-------------------------------------------------------- |
| Browser stores the body under `no-cache`                            | Browser stores nothing                                    |
| Browser sends `If-None-Match` **automatically** on the next request | Nothing is sent; there is no stored validator             |
| Server answers `304`, ~200 bytes                                    | Server answers `200` with the whole payload, every time   |
| `read-endpoint.ts`'s revalidation path works with zero client code  | Client must hold body + ETag in JS and hand-roll the loop |

Adopting `QUERY` today would therefore **remove the 304 path that `read-endpoint.ts` was just built
to provide**, on the endpoints most likely to be re-fetched. The draft's own answer is
`Content-Location` pointing at a `GET`-able equivalent — which reintroduces the URL the migration
was meant to escape, and for M1 at forty ids per facet that URL is 7,108 characters.

`QUERY` is theoretically more cacheable than `GET` and, until deployed caches implement it,
**practically less cacheable**. That inversion is the core of the recommendation.

---

## 6. Blockers

### 6.1 The Deno runtime is NOT a blocker — verified

A live round trip on `deno 2.9.4`:

```
QUERY  -> 200 {"method":"QUERY","bodyLen":46,"body":"{\"q\":\"packaging\",\"quick\":[\"starred\",\"unread\"]}"}
TRACE  -> THREW: Method is forbidden
```

`Deno.serve` accepts an inbound `QUERY` and exposes its body; Deno's `fetch` sends one. The `TRACE`
control confirms the forbidden-method list is enforced and that `QUERY` is not on it. The runtime is
ready.

### 6.2 Fresh 2 is the blocker — verified, three ways

`@fresh/core@2.3.3` (the version `deno.lock` resolves; `deno.json` requests `^2.2.2`) closes the
method set at the type level:

```ts
// @fresh/core/2.3.3/src/router.ts
export type Method = "HEAD" | "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "OPTIONS";
export type RouteByMethod<T> = { [m in Method]: T | null };

// @fresh/core/2.3.3/src/handlers.ts
export type HandlerByMethod<Data, State> = { [M in Method]?: HandlerFn<Data, State> };
```

**(a) It will not typecheck.** `define.handlers({ QUERY })` is an object literal against
`HandlerByMethod`; `QUERY` is an excess property and TypeScript rejects it.

**(b) Forced past the type check, it registers silently as a no-op.** `applyCommands` iterates
`Object.keys(route.handler)` and calls `router.add(method as Method, …)`. Inside `add`,
`newByMethod()` initialises exactly the seven known keys to `null`, and the store is guarded:

```ts
allowed.add(method); // "QUERY" IS recorded here
if (byMethod[method] === null) byMethod[method] = item; // undefined === null → false → SKIPPED
```

Driving the real router directly:

```
Allow advertises: [ "GET", "QUERY" ]
match(QUERY) -> { item: undefined, methodMatch: true, pattern: "/api/projects/list" }
match(GET)   -> { item: "GET-handler", methodMatch: true }
app.ts dispatch -> TypeError: handler is not a function
```

The handler is dropped, and `OPTIONS` would **advertise `Allow: GET, QUERY`** for a method the
router holds nothing for. A lying `Allow` header is worse than a missing one, because feature
detection believes it.

**(c) An inbound `QUERY` produces a 500, not a 405 — and this is a live pre-existing defect.**
`match` reads `byMethod["QUERY"]`, gets `undefined`, and the guard is `if (item !== null)` —
`undefined !== null` is **true**, so `methodMatch` is set `true` and `item` stays `undefined`.
`app.ts` then calls `handler(ctx)` because `undefined !== null`, throwing a `TypeError` inside its
`try`, which lands in `DEFAULT_ERROR_HANDLER`. Against today's routes, with no `QUERY` key declared
anywhere:

```
Allow: [ "GET", "HEAD", "OPTIONS" ]
match(QUERY)     item: undefined | methodMatch: true | => app.ts: calls handler → TypeError → 500
match(PROPFIND)  item: undefined | methodMatch: true | => app.ts: calls handler → TypeError → 500
match(PUT)       item: null      | methodMatch: false | => app.ts: 405 (HttpError)
```

> **🚨 Flag for a human, independent of `QUERY`.** Any HTTP method outside Fresh's seven-member
> union — `QUERY`, `PROPFIND`, `LOCK`, anything — currently yields a **500 on every route in this
> application**. A method _inside_ the union but unregistered (`PUT`) correctly yields 405. The
> difference is `undefined !== null` slipping past a null check. Consequences: an unknown-method
> probe is indistinguishable from a server fault; each one allocates an error render and logs an
> error; and since this app has **no `_error.tsx`**, the response body is plain text, so any client
> calling `.json()` on it throws. This should be reported upstream and shimmed locally (§8, item 6).

### 6.3 Browsers

- **`fetch` will send it.** The Fetch standard's forbidden-method list is `CONNECT`, `TRACE`,
  `TRACK`; `QUERY` is a valid method token and a body is permitted on anything except `GET`/`HEAD`.
- **Cross-origin needs a preflight** answered with `Access-Control-Allow-Methods: QUERY`, since only
  `GET`/`HEAD`/`POST` are CORS-safelisted. Not a constraint here — `read-endpoint.ts` is
  deliberately same-origin-only and echoes an `Origin` only when it equals the request's own.
- **No browser HTTP cache and no Service Worker `Cache` stores it** (§5.3). This is the operative
  browser blocker, not the wire format.

### 6.4 Intermediaries

No CDN caches `QUERY` responses. WAFs and corporate proxies commonly reject unknown methods
outright, and some do so before any header the application controls. Deno Deploy's behaviour for
extension methods was **not verified in this pass** and must be tested before Phase 2.

### 6.5 The draft

Internet-Draft, not an RFC. The method name and core semantics are stable; header spellings and the
precise caching rules are not. Any implementation must pin the revision it was written against.

---

## 7. Transition roadmap

The governing constraint: **`GET` keeps working throughout, on every endpoint, forever.** Not as a
deprecation courtesy but because the twelve SSR resolvers call the fat services directly and never
touch HTTP at all, and because the page URL is a shareable product surface (§3.3). There is no phase
in which `GET` is removed.

### Phase 0 — Prepare, no `QUERY` (do this now)

Everything in §8. Each item stands on its own merit today and none mentions the new method.

**Exit criteria:** every read route resolves through `defineReadRoute`; every route has exactly one
`parse…Params` function accepting both a `URLSearchParams` and a plain object and returning a
Zod-parsed result; unordered facets are canonically ordered at the boundary; an unknown method
returns a 405 in the domain envelope shape.

### Phase 1 — Unblock the framework

Fresh must route the method. Two paths, not mutually exclusive: contribute `QUERY` to
`@fresh/core`'s `Method` union (a small, self-contained change — the union, `newByMethod`, and the
`item !== null` guard), and/or add a local catch-all shim. Fresh documents a catch-all escape hatch:
`define.handlers((ctx) => …)` as a bare function rather than a method map, which receives every verb
and dispatches on `ctx.req.method` in application code.

The catch-all is the pragmatic route, but it is not free: a bare function handler causes
`applyCommands` to register **all seven** methods for that pattern, so the route takes
responsibility for its own 405 and its own `Allow` header. `defineReadRoute` is the right place for
that, because it already owns `READ_METHODS`, `methodNotAllowed()` and `readOptionsResponse()` and
would keep the two in agreement by construction.

**Exit criteria:** a `QUERY` request reaches a handler; `OPTIONS` advertises a set that matches what
is actually routed; an unsupported method still returns 405 with a correct `Allow`; Deno Deploy is
confirmed to pass the method through.

### Phase 2 — Dual-serve one endpoint

`/api/messaging/conversations` only — the strongest candidate and the one whose URL actually breaks.
`defineReadRoute` gains an optional `parseBody` alongside `resolve`, produces a fourth handler, and
both verbs share **one** params parser and **one** service call. `Allow` and
`Access-Control-Allow-Methods` become `GET, HEAD, OPTIONS, QUERY`.

Both verbs must be proven to produce **byte-identical payloads and identical ETags** for equivalent
input — the same property `defineReadRoute` already guarantees between `GET` and `HEAD`, and for the
same reason: two responses that are supposed to be the same should be produced by one code path, not
kept in agreement by hand.

**Exit criteria:** identical bytes and identical ETag across verbs for a matrix of equivalent
inputs; no change to any `GET` response; a Deploy-hosted preview serving both.

### Phase 3 — Client feature detection

The client must **never** hard-fail to a method the server may not route.

- **`OPTIONS` is the mechanism.** One `OPTIONS` per session, result held in memory, `QUERY` used
  only if `Allow` contains it. Not a per-request probe — that doubles round trips to save a query
  string.
- **The fallback is a status probe, and it is unreliable until Phase 1.** §6.2(c) shows this app
  currently answers an unroutable method with **500**, not 405 or 501. A client keying on 405/501
  would treat a genuine server fault as "unsupported" and silently degrade forever. Until Phase 1
  lands, treat _any_ non-2xx on a first `QUERY` attempt as "unsupported", latch it for the session,
  and retry the identical read over `GET`.
- **Fall back, never fail.** Retrying with `GET` costs one round trip on one request per session. A
  client that cannot complete a read because a draft method was refused is strictly worse than a
  client that never tried.

**Exit criteria:** detection is one call per session; every failure path lands on `GET` and returns
data; forcing every `QUERY` to fail leaves the product functionally unchanged; the flag is
observable in dev tooling.

### Phase 4 — Broaden, on evidence

Extend to `/api/projects/list` and `/api/projects/submissions`, then optionally the two `files`
endpoints since the factory makes them nearly free. Do **not** extend to the eight scalar-keyed
reads (§2.4) — the cost is real and the benefit is zero.

**Exit criteria:** measured reduction in truncated/rejected requests; no regression in cache hit
rate or p95 latency; no increase in error rate attributable to the verb.

### Phase 5 — There is no Phase 5

`GET` is not deprecated, on any endpoint, at any point. If the draft stalls or is withdrawn, Phases
2–4 are reverted by deleting one handler per route and one branch in the client. That reversibility
is a deliberate design constraint, not a fallback plan.

---

## 8. What to do now — none of which requires `QUERY`

Ordered by value. Every item is worth doing on its own merit and, collectively, they make a later
transition a small diff rather than a rewrite.

1. **One params parser per endpoint, accepting either source.** A single
   `parseFileParams(source: URLSearchParams | unknown): FileListParams` per endpoint, so a future
   body parser reuses the identical normalisation instead of forking it.
   `parseProjectParams(search: string | URLSearchParams)` in
   `apps/web/features/projects/core/projects-state.ts` already has exactly this shape and is the
   model — it is pure, DOM-free, and runs identically on the server and the client. The other five
   routes inline theirs into the handler.

2. **Call the Zod schema.** No read route runs `.parse()` on its own SSOT today. Doing so fixes the
   `link` file-kind drop (§3.5) for free, replaces six hand-rolled coercion layers with one call,
   and makes the schema the contract it claims to be. Root CLAUDE.md §2 already requires it:
   _"Routes do HTTP parsing + Zod validation."_

3. **Keep params flowing as an object into the fat services.** Already true, and it is why
   `cacheKey(tenant, namespace, params)` needs no change at all when the source becomes a body. Do
   not let a query string leak past the route boundary.

4. **Canonicalise unordered facet arrays at the boundary.** Sort `roles`, `formats`, `statuses`,
   `kinds`, `quick`, `requests`, `relations`, `serviceIds`, `productIds`, `entityIds`, `memberIds`.
   Do **not** sort `path` or anything else where order carries meaning. This collapses up to 40,320
   cache keys into one for a single logical query (§3.4) and pays off under `GET` today.

5. **Finish the `defineReadRoute` migration.** One route is on it; fourteen are not. It is the only
   place a fourth verb would ever need to be added, and it already owns `READ_METHODS`,
   `methodNotAllowed()` and `readOptionsResponse()` — the three things Phase 1 must keep in
   agreement.

6. **Make an unknown method return 405 in the domain envelope.** Two defects in one fix: the 500 of
   §6.2(c), and the fact that with no `_error.tsx` the response is plain text, so
   `ProjectSidebarService`/`MessagingService` throw on `.json()`. The `scheduling/*` guards already
   establish the shape (`{ ok: false, message }`), which the clients' soft-error handling parses.

7. **Cap `ProjectFeedParamsSchema.q`.** It is a bare `z.string()` where its messaging sibling is
   `.max(200)`. An unbounded user-typed string currently reaches the request line and every access
   log along the way.

8. **Gate the `sim*` params on `DENO_ENV=development`.** Unrelated to this document and more urgent
   than it: `/api/projects/members` accepts `simViewer`, `simProjectType` and `simPendingInvites`
   from any caller with no server-side gate, which is the privilege-forgery shape Decision #72
   identified and fixed on the scheduling surface.

---

## 9. Recommendation

**Do not implement `QUERY` yet.**

The case for it is narrower than it first appears and the case against it is currently decisive:

- **Three of fifteen endpoints would benefit** — `messaging/conversations`, `projects/list`,
  `projects/submissions`. Two more are marginal. Ten would be made worse.
- **Size is not the reason.** Measured, the JSON body is 3% _larger_ than the query string for
  `projects/list` and identical for `projects/submissions`. Only `messaging/conversations` crosses
  the ~2,000-character interop line, and only past roughly twelve ids per facet.
- **Fresh cannot route it.** Verified three ways: it fails typecheck, it registers silently as a
  no-op while advertising itself in `Allow`, and an inbound request 500s.
- **It would remove caching, not add it.** No browser, CDN or Service Worker stores a `QUERY`
  response, so adopting it today deletes the automatic `If-None-Match` → 304 path that
  `read-endpoint.ts` exists to provide.
- **The genuine wins are available under `GET` today.** Structured parsing, one parser per endpoint,
  Zod enforcement, canonical facet ordering, body-shaped cache keys — §8, none of it blocked on
  anything.

### What would change this recommendation

| #  | Condition                                                                                            | Status                                |
| :- | :--------------------------------------------------------------------------------------------------- | :------------------------------------ |
| 1  | `@fresh/core` `Method` union includes `QUERY`, or a catch-all shim routes it with a truthful `Allow` | **blocking** — not started            |
| 2  | At least one deployed cache in the path (browser, CDN, or edge) stores `QUERY` responses             | **blocking** — none does              |
| 3  | `draft-ietf-httpbis-safe-method-w-body` reaches RFC, or the wire format stops changing               | **blocking** — Internet-Draft         |
| 4  | Deno Deploy confirmed to pass extension methods through unmodified                                   | unverified — testable now             |
| 5  | Measured evidence of truncated or rejected requests in production                                    | unmeasured — nothing is in production |
| 6  | §8 items 1–5 complete, so the transition is a small diff                                             | item 5 in flight, rest not started    |

Conditions 1–3 are all outside this repository's control. Until at least 1 and 2 hold, `GET` with a
disciplined parser, a stable cache key and a working ETag is the better engineering answer — and
building that is the fastest route to a cheap `QUERY` migration later.

---

## Appendix A — Verification

### Environment

| Component     | Version                                                                           |
| :------------ | :-------------------------------------------------------------------------------- |
| Deno          | 2.9.4                                                                             |
| `@fresh/core` | **2.3.3** resolved via `deno.lock` (`deno.json` requests `^2.2.2`)                |
| Working tree  | `main`, `projects/list.ts` migrated to `defineReadRoute`; fourteen routes not yet |

### Measured by execution

1. **URL and body sizes** — query strings constructed with `URLSearchParams` exactly as
   `SubmissionsService.list`, `buildConversationQuery` and `toSearchParams` build them; measured
   with `.length` and `TextEncoder().encode().byteLength` against a 22-character origin.
2. **Deno `QUERY` support** — `Deno.serve` on localhost, a `fetch` with `method: "QUERY"` and a JSON
   body; `TRACE` as the negative control.
3. **Fresh router behaviour** — `UrlPatternRouter` imported directly from
   `https://jsr.io/@fresh/core/2.3.3/src/router.ts`, `add`/`match`/`getAllowedMethods` driven with
   both a declared and an undeclared `QUERY`, and the `app.ts` dispatch expression reproduced
   against the returned `item`.

### Read from source, not executed

`Method` / `HandlerByMethod` / `newByMethod` / the `item !== null` guard / `applyCommands`'s
`Object.keys` loop / `defaultOptionsHandler` / `DEFAULT_NOT_ALLOWED_METHOD` (`@fresh/core@2.3.3`);
all six route-level parsers; all seven `…ParamsSchema` definitions; `read-endpoint.ts`; `cache.ts`
`stableStringify` / `cacheKey`; `_middleware.ts` security headers.

### NOT verified — stated rather than claimed

- **Deno Deploy's handling of extension methods.** Local `Deno.serve` accepts `QUERY`; the hosted
  edge was not tested. Blocking for Phase 2.
- **Real intermediary limits.** The Apache and nginx defaults in §3.1 are documented defaults, not
  measurements of any deployment of this app. Nothing is in production, so no truncation or
  rejection rate exists to measure.
- **Browser behaviour end to end.** `fetch` sending `QUERY` was verified in Deno, which shares the
  forbidden-method list, not in a browser. The claims that no browser HTTP cache and no Service
  Worker `Cache` stores a non-`GET` response are from the Fetch and Service Worker specifications,
  not from an experiment.
- **The current `draft-ietf-httpbis-safe-method-w-body` revision.** Method name and core semantics
  are reported with confidence; `Accept-Query` and the exact caching rules should be re-read against
  the live draft before any implementation.

### Related decisions

Root [`CLAUDE.md`](../../CLAUDE.md) §8 — **#12** (shareable Explore/feed URLs, which is why the page
query string stays), **#67(2)** (the NUL-byte-makes-a-file-binary defect class, recurring in
`cache.ts`), **#69** (`AsyncLocalStorage` for request-scoped currency, which is part of the ETag
key), **#72** (`sim*` params as a privilege-forgery primitive, unfixed on `/api/projects/members`).
