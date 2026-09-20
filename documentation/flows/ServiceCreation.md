# Service Creation — the seller-side write contract

What the **service-creation pages** (the catalogue console at `/catalogue` and `/catalogue/[id]`, plus
the seller's booking settings) must write so that the buyer-side flows shipped by Decision #108 —
the profile's Hire menu, the Service Detail and Project Assignment modals, the Consultation modal and
the `/view/[id]` Contact menu — read real data instead of fixtures.

> **Status (2026-09-19).** Every column and table below **exists** in the consolidated schema and was
> verified by execution (`supabase db reset` + probes inside `BEGIN … ROLLBACK`; see root
> `CLAUDE.md` §8 Decision #109). The **editors** that fill them do not: the catalogue editor
> (`ListingEditor.island.tsx`) has no intake section, no hire-intake settings surface exists, and no
> call-platform picker exists. The reads are wired and fixture-backed behind the existing gates
> (`CATALOGUE_BACKEND_LIVE` · `PROFILE_BACKEND_LIVE` · `EXPLORE_BACKEND_LIVE`), so the day an editor
> writes a row, the buyer surfaces show it with no shape change.

## 1. The five things a listing must carry

| Buyer surface reads                                    | Seller must write                                           | Column                                                       | Zod SSOT                                                                     |
| :----------------------------------------------------- | :---------------------------------------------------------- | :----------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Service Detail modal → the intake questions            | An ordered list of ≤ 12 `IntakeField`s per listing         | `marketplace.service_blueprints.intake_fields` (jsonb)       | `IntakeFieldSchema` · `ListingDetail.intake` · `UpdateListingInput.intake`   |
| Project Assignment modal → the hire questions          | An ordered list of ≤ 12 `IntakeField`s per seller          | `org.freelancer_profiles.hire_intake` · `org.teams.hire_intake` | `IntakeFieldSchema` · `ProfileView.hireIntake`                              |
| Consultation modal → courtesy / paid, durations, fee   | The call settings                                           | `scheduling.call_settings` (pre-existing)                    | `CallSettingsSchema` · `UpdateCallSettingsSchema`                            |
| Consultation modal → the platform selector             | The ordered allow-list of conferencing providers            | `scheduling.call_platforms` (one row per provider)           | `CallPlatformSchema` · `UpdateCallPlatformsSchema`                           |
| Hire menu → listings with price, rating, thumbnail     | Publish the listing                                         | `service_blueprints.is_published` + `catalogue.listings`      | `SetListingStatusInput` (pre-existing)                                       |

### 1.1 Intake editor (catalogue console)

- **Where:** a new "Questions for the buyer" section on `/catalogue/[id]` (`ListingEditor`). It
  edits `ListingDetail.intake` and sends it wholesale through `POST /api/catalogue/update` as
  `UpdateListingInput.intake` — **order is meaning**, so the patch is the whole list, never a diff.
- **Validation:** `IntakeFieldSchema` at the route (Zod) and `intakeRefusal`'s inverse on the
  seller side — every option-bearing kind needs ≥ 1 option, a `number` with a slider needs both
  bounds, ids are unique within the list. The database refuses only a non-array or > 12 elements.
- **Live write:** `UPDATE marketplace.service_blueprints SET intake_fields = $1 WHERE id = $2` under
  the owner's RLS (`"Owners manage own blueprints"`). The `catalogue.listings` row points at the
  blueprint and restates nothing, so there is exactly one column to write.
- **Renaming a field id** after a listing has sold orphans the stored `answers` under the old id on
  every basket line and invitation; the editor should treat an id as immutable once the listing has
  been published and only allow label/option edits.

### 1.2 Hire intake editor (seller settings)

- **Where:** a settings surface that does not exist yet — the natural home is the profile owner's
  Settings (Decision #96's rig) or the workspace console for a team (Decision #61). It edits
  `ProfileView.hireIntake` for the acting seller.
- **Live write:** `UPDATE org.freelancer_profiles SET hire_intake = $1 WHERE user_id = auth.uid()` for
  an individual; `UPDATE org.teams SET hire_intake = $1 WHERE id = $2` for a team (team-lead gate).
  No route exists today; `PATCH /api/profile/hire-intake` is the obvious shape, thin over a fat
  `ProfileBackendService.updateHireIntake`.
- Same field-id immutability rule as §1.1: answers land on `projects.project_invitations.answers`.

### 1.3 Call platforms (booking settings)

- **Where:** beside the call settings (`/calendar` hub's Connect-Calendar surface, Decision #72, or
  a dedicated booking-settings page). A multi-select over the host's ACTIVE `conferencing`
  connections, reordered by drag; `preferred_provider_slug` picks the default within it.
- **Live write:** replace the set — `DELETE FROM scheduling.call_platforms WHERE schedule_id = $1`
  then one INSERT per slug with its `position` — in one RPC, because a partial replace leaves a
  platform offered that the host just removed. RLS: `fn_can_manage_schedule`.
- **The public offer is an intersection.** `PublicCallOffer.platforms` = `call_platforms` ∩ active
  `user_connections` with `conferencing`, ordered by `position`; an empty list means every connected
  provider. The booking write refuses a platform outside that set (`platform_not_offered`).

## 2. What the BUYER-side services write (already shaped, stub-first)

| Flow                                   | Write                                                                                                           | Live status                                                                                                                                  |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| Service Detail → session booking       | `finance.basket_items` with `scheduled_at`, `timezone`, `metadata.answers`                                    | Stub (per-process store) — see `API_BACKLOG.md` P0 #12                                                                                     |
| Service Detail → one-off / task brief  | `finance.basket_items` with `metadata.answers` + the brief                                                     | Stub                                                                                                                                         |
| Service Detail → pipeline instantiate  | `projects.projects` (`source_blueprint_id`, `status='draft'`, `visibility='unlisted'`) + stages               | Stub (`draft-store` + `write-store`); RPC `projects.create_project` cannot set `source_blueprint_id` (Decision #85(b))                       |
| Project Assignment → hire invitation   | `projects.project_invitations` with `target_user_id`, `message`, `offer_price_cents`, `answers`, `placeholder` | Stub — the live INSERT needs a token minter; `resolveHireOffer` derives `placeholder` server-side and it is never accepted from the payload |
| Consultation → discovery call          | `scheduling.discovery_calls` with `proposed_start/_end`, `provider_slug`, `service_blueprint_id` (NULL from a profile) | Stub (`call-store.ts`, whose row already mirrors every column)                                                                              |

## 3. Reads that resolve the seller's data

| Read                                          | Live query                                                                                                                              |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `ServiceView.intake` on `/view/[id]`           | `service_blueprints.intake_fields` by slug                                                                                               |
| `ProfileView.hireIntake` on `/[handle]`        | `freelancer_profiles.hire_intake` (user) or `teams.hire_intake` (team) by handle                                                        |
| `PublicCallOffer` (`/api/services/call-offer`) | `call_settings` ⨝ `call_platforms` ⨝ `integrations.v_my_connections`-equivalent for the HOST (service role; the caller is a stranger) |
| `MemberRosterPage.invites`                     | `project_invitations` incl. `target_user_id` → `org.users_public.username` for the `@handle` line, `placeholder` (wired: `live-members.ts`) |

## 4. Still open (needs a human)

1. **Token minting for an identity-addressed invitation.** `token` is `NOT NULL UNIQUE` and is the
   accept capability; for an invitee who already has an account the accept path could key on
   `target_user_id = auth.uid()` instead and the token becomes vestigial. Decide whether to keep
   minting one (uniform accept path) or relax `token` to nullable for identity rows.
2. **Per-role hire intake.** A Direct Deliverable's named roles (`stage_staffing_roles`) carry no
   intake of their own; the seller's `hire_intake` is asked regardless of the role. Fine until a
   seller wants role-specific questions.
3. **A session listing reaching the Hire menu** (Decision #108(c)) — sessions are booked, not hired
   into; the menu should probably filter them.
