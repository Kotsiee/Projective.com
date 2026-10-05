# Projects — settlement endpoints

The three client decisions that move deliverables and money. Each is a thin route over one fat
`ProjectBackendService` method, and each method makes **one** call to a guarded `SECURITY DEFINER`
door under the caller's own JWT. The door's review-authority check (`projects.can_review_project`)
is the security of the path: no route or service repeats it (Decision #53(b)). Function contracts:
[`../database/projects/Functions.md`](../database/projects/Functions.md). Fair Exit tiers:
[`../business/finance-model.md`](../business/finance-model.md) §3.

`:id` is the project slug (`prj-…`, Decision #88). `:stageId` is the stage slug (`stg-…`, Decision
#93) or its uuid; it is always resolved **inside** the named project, so a stage of another
engagement cannot be addressed through this one's URL.

| Method + path | Zod (`@projective/types/projects`) | Service → Postgres | Answers |
| :-- | :-- | :-- | :-- |
| `POST /api/projects/:id/stages/:stageId/submissions/:submissionId/review` | `ReviewSubmissionSchema` → `SubmissionReviewed` | `reviewSubmission` → `projects.review_submission` | `decision: accept \| request_revision`. A revision **requires** `notes` (422 on `notes`), stored as `feedback.global`. The submission must belong to `:stageId` (else 404). |
| `POST /api/projects/:id/stages/:stageId/approve` | `ApproveStageSchema` → `StageApproved` | `approveStage` → `projects.approve_stage` | Releases every held escrow on the stage; the stage settles straight to `paid`. `handoverUnlocked` reports the Contact Handover. |
| `POST /api/projects/:id/stages/:stageId/cancel` | `CancelStageFairExitSchema` → `StageExited` | `cancelStageFairExit` → `projects.cancel_stage_fair_exit` | `tier: 25 \| 50 \| 75` — the freelancer's share in percent; the remainder is refunded to the payer. |

## Status mapping

The live module (`packages/backend/services/projects/live-settlement.ts`) maps by SQLSTATE first
and by the function's wording second:

| Postgres | HTTP | Meaning |
| :-- | :-- | :-- |
| `42501` | 403 | Not signed in, or not the client/owner. The payee included. |
| `P0002` | 404 | Stage or submission not found. An address the viewer cannot see also resolves to 404. |
| `22023`, `23514` | 422 | Invalid tier or decision. |
| `55000` | 409 | Nothing held to release or cancel, or the submission is not awaiting review. |
| stale JWT | 401 | `apiFetch` refreshes the session and retries. |

**Fail-closed.** With `PROJECTS_BACKEND_LIVE` on, none of these writes ever reaches the stub. A
thrown write is a 502, and a signed-in caller without an access token gets a 401 rather than the
in-memory store. With the gate off, the stub records a submission verdict (folded onto the
explorer's read) and reports zero money moved for an approval or a Fair Exit.
