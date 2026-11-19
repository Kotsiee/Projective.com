# Development seed

`supabase db reset` (or `deno task db:reset`) rebuilds the local database from the consolidated
migrations and then loads a **complete, interconnected development world**: eighteen real personas
(one of them the platform operator), three teams, two businesses, seven projects in every hiring and
delivery state, funded and released escrows, a computed wallet ledger, product and service orders,
direct messages, project channels, read/unread notifications, and published schedules with working
hours, time off and discovery calls — with profile photos, banners, brand marks, product/service
covers and submission deliverables served from the local storage buckets.

Everything below is **generated**, and it is the ONLY copy of this data: the discovery surfaces
(`/explore`, `/view/[id]`, the landing page) and the booking surfaces (a listing's Book modal and
Contact menu, `/[handle]/availability`, `/view/[id]/schedule`) read it live, so there is no in-app
fixture for it to drift from. The source of truth is three places:

| Source                                    | Owns                                                                                                  |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `supabase/seeds/gen/corpus.ts` (the listings) | The authored listing content — nine services with their stage templates, intake questions, team roles and session terms; eight products with manifests, specs and compatibility; five articles with block bodies. One Pipeline is **tiered** (North Loop's Realtime MVP build: `tieredIntensity`, the seller's own Low and High price on every stage, CREATE category `create`); the other two sell at one fixed intensity. One 1-on-1 block carries a **session plan** (Studio Fern's Design mentorship block: a title and a description for each of its six sittings, Decision #411). Seed-only: nothing outside `supabase/seeds/` imports it. |
| `supabase/seeds/gen/reviews.ts`           | The service listing reviews (21), each by a persona key, two with the provider's reply; the 16 product reviews held for CK1 (Decision #487 ruling 5); the one completed engagement left unreviewed for the live path. |
| `supabase/seeds/gen/world.ts` (the world) | Everything a running product accumulates — who is a member of what, who was hired into which stage, which tickets were paid, who messaged whom, what is unread. |
| `supabase/seeds/gen/schedules.ts`         | Ten schedules: each owner's timezone, working hours (where every call is booked, Decision #408 — the generator refuses a seeded call outside them), time off, call settings and platforms, their busy events, and four discovery calls; plus the stage calendar facts `06_projects.sql` reads — five fixed stage deadlines (`STAGE_DEADLINES`) and one fixed stage start (`STAGE_STARTS`: Meridian's documentation stage). |

`supabase/seeds/generate.ts` resolves them into `supabase/seeds/0*.sql` and the image tree under
`supabase/seed-assets/`, and **both outputs are committed** so a clone resets with no toolchain.
Regenerate after editing either source, then commit the result:

```sh
deno task db:seed:generate   # rewrites supabase/seeds/*.sql + supabase/seed-assets/**
deno task db:reset           # supabase db reset --local --yes
```

**Embeddings are not seeded.** `db:reset` leaves every discovery vector (`search.*_index.embedding`)
empty, so semantic ranking has nothing to rank with — search and the `/view` "Similar" rails keep
their heuristic order even with the switch on — until the backfill runs (Decision #179):

```sh
deno task embeddings:backfill --dry-run   # entity count, token estimate, cost — no Voyage call
deno task embeddings:backfill             # needs VOYAGE_API_KEY in .env.local; skips unchanged items
```

On the seed world that is 49 public entities and about 1.6K tokens (≈ $0.0001); a second run embeds
nothing.

**Editorial content is not seed data** (Decision #274). The help centre, the changelog and
Projective's articles must exist in every environment, and this seed runs only on a local reset, so
their rows are category-5 MIGRATIONS instead — `supabase/migrations/0000507x_seed_editorial_*.sql`,
one per surface, generated from the Zod-validated content sources in
`packages/backend/services/editorial/content/` by `deno task db:editorial:generate` (see
[editorial/Tables.md](editorial/Tables.md)). They therefore never reference a persona, a team or a
storage object this seed creates. Community activity (helpfulness votes, feedback ideas) IS
world-shaped demo data and belongs here, in `gen/world.ts`, authored by existing personas.

## What a reset loses

`deno task db:reset` rebuilds everything, so an account you signed up with locally is gone, along with
its connected accounts, sealed tokens and synced busy time. The provider keeps its grant: connect again.
A connection that published also keeps its Projective calendar at the provider, and connecting again
makes a second one, because the rebuilt database no longer knows the first, so delete the old one there.

## Sign-in

Every account uses the password **`password123`** at `<username>@projective.dev`. The access-token
hook stamps each session's `active_context` (handle, `isFreelancer`/`isClient`, `onboarded: true`), so
every persona lands on the authenticated shell directly.

| Username         | Person          | Role                                   | Member of                     | Notable state                                                   |
| :--------------- | :-------------- | :------------------------------------- | :---------------------------- | :-------------------------------------------------------------- |
| `marisdelacroix` | Maris Delacroix | Freelancer (product design lead)       | —                             | KYC verified, Pro plan, 2 funded tickets, 1 released, Income Smoother enrolled, monthly payouts |
| `renkoda`        | Ren Koda        | Freelancer (3D & motion)               | —                             | Pending invitation from Theo (draft project), sells a product   |
| `juno`           | Juno Park       | Freelancer (frontend)                  | —                             | KYC pending, pending invitation + pending application, building Noor's site; on Helia's Meridian docs stage (Helia's second bench freelancer), which opens on a fixed day after her Haddad Studio deadline so the two seats never overlap (AC6) |
| `noor`           | Noor Haddad     | Client (creative director)             | — (invited to Helia Finance)  | Owns an individual project, 2 product orders, basket, unread DM; a pending Member invitation from Helia |
| `theo`           | Theo Almeida    | Client (founder)                       | —                             | Draft project with a placeholder invitation, service + product orders |
| `inesduarte`     | Inês Duarte     | Freelancer, **owns Atelier Nova**      | Atelier Nova (owner)          | Claimed the one-off Verdant ticket, escrow held for the team    |
| `kwamemensah`    | Kwame Mensah    | Freelancer, **owns North Loop**        | North Loop (owner)            | Two released team escrows, a payout, threshold schedule   |
| `saoirsebyrne`   | Saoirse Byrne   | Freelancer, **owns Studio Fern**       | Studio Fern (owner)           | Pending team invite to Chloe, service inquiry thread, auto-response |
| `priyaraman`     | Priya Raman     | Operator, **owns Helia Finance**       | Helia Finance (owner)         | KYB verified, USD vault with a pending spend approval; has invited Noor to Helia |
| `danielokafor`   | Daniel Okafor   | Operator, **owns Atlas Labs**          | Atlas Labs (owner)            | KYB pending, reviews North Loop, unread submission              |
| `lenamueller`    | Lena Müller     | Freelancer                             | Atelier Nova (admin)          | Rejected application                                            |
| `tomaszwojcik`   | Tomasz Wójcik   | Freelancer                             | North Loop (member)           | Completed ticket, team split credit, payout, pending application |
| `aikotanaka`     | Aiko Tanaka     | Freelancer                             | Atelier Nova + Studio Fern    | Member of two teams                                             |
| `samuelnkemelu`  | Samuel Nkemelu  | Freelancer                             | North Loop (lead)             | Ticket in review with a revision round, pending invitation      |
| `hannahcole`     | Hannah Cole     | Operator                               | Helia Finance (admin)         | Runs two projects, spending cap on the vault, unread applications |
| `miguelsantos`   | Miguel Santos   | Operator                               | Atlas Labs (member)           | Owns the hiring-stage Loop mobile project; plain Member role **plus two per-member grants** (`hire`, `manage_projects`) |
| `chloewinters`   | Chloe Winters   | Freelancer (new account)               | — (invited to Studio Fern)    | Unverified, pending application, booked a review session        |
| `rosalindqvist`  | Rosa Lindqvist  | **Platform operator** (`ops.admin_users`) | —                          | The one `security.is_admin()` account: receives `contact.received`, reads the contact intake, the dispute desk (`/admin/disputes`) and Archived feedback ideas, and is the actor on every seeded feedback-board move. A plain account otherwise — no listings, memberships or money — so nothing else it reads is explained by anything but the role (Decision #296 (E)) |

## What is seeded, by file

| File                   | Contents                                                                                                                                                  |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_identities.sql`    | `auth.users` + `auth.identities`, `org.users_public`, every persona's `org.legal_acceptances` at the versions in effect when it was generated (`currentLegalVersions()`, surface `join`, Decision #446 — so no seeded login meets the re-accept gate; regenerate after publishing a material version), the platform operator's `ops.admin_users` row (personas with `platformOperator`), emails, preferences (display currency/locale), freelancer profiles (KYC), skills, languages, links, KYC cases |
| `02_assets.sql`        | One `files.items` row per image (real size, SHA-256, dimensions in a schema-valid `AssetMetadata` envelope); avatar/banner links; education + experience (with employer logos) |
| `03_entities.sql`      | Teams + businesses (brand marks); both businesses `active` and `visibility = 'public'` (the column defaults to `invite_only`; seeded ones are listed so discovery has buyers, BB5); each entity's **preset** role rows (Owner · Admin · Lead · Member for a team, no Lead for a business — name, summary, `preset` = `base_preset`, no stored capabilities, exactly what `org.fn_seed_preset_roles` writes); memberships with titles, the held `role_id`, and per-member `granted_capabilities` (Miguel's two); seven `reports_to` org-chart edges (written after both rosters exist — Lena → Inês, Aiko → Lena, Samuel → Kwame, Tomasz → Samuel, Aiko → Saoirse, Hannah → Priya, Miguel → Daniel); team contribution splits (no stake starts `held`) + split rules; KYB cases; two pending invitations (Studio Fern → Chloe, Helia Finance → Noor) addressed through `team_role_id` / `business_role_id`; follows, bookmarks; **recent views** (`org.recent_views`, Decision #178 — Noor's and Maris's histories anchor "Because you viewed" for a client and a freelancer, and four people on the brand sprint plus three each on Maris and the Helia wallet put three items past Trending's three-person floor; times are relative to the reset, so after a week Trending falls back to "New on Projective") |
| `04_marketplace.sql`   | Nine service blueprints (all five delivery models, team-owned where the corpus says so) with covers, stage templates (priced per stage; the tiered Pipeline's stages also carry `lowPriceCents` / `highPriceCents` under `allow_tiered_intensity`, Decision #417), intake questions, team roles, deliverables and session terms (the mentorship block's six-entry `session_plan`) |
| `05_catalogue.sql`     | Products (`prd-…` slugs, format, file manifest, specs, compatibility, licence), articles (`art-…` slugs, block bodies whose images are storage objects, covers), a published listing per product AND per service with its gallery (`file_id`), skills and tags, and one plan-allocated 7-day promoted placement per sponsored listing, at most one per seller (Atelier Nova's Brand identity sprint on `explore_home`, Maris Delacroix's Iconography set on `explore_results`; Decision #454) |
| `06_projects.sql`      | Seven projects with stable `prj-…` slugs, stages, participants, assignments (individual + team), invitations (pending/accepted/declined/placeholder), applications, tickets with history, submissions with deliverable files and a revision chain, starred projects (a project's own reviews are `06_reviews.sql`'s) |
| `06_reviews.sql`       | Every seeded review on the anchor that proves it (Decision #487; `gen/emit-reviews.ts`): for each service review a completed engagement bought from the listing (the provider's project, `client_user_id` the reviewer, one paid stage, the provider's completed seat, its status history) or, on a session listing, the provider's session engagement with a completed cohort seat and one completed sitting; the review targets the provider, names the listing (`service_blueprint_id`) and is dated inside its 30-day window; two replies; and Noor's completed, unreviewed Landing page in a week, the live path's starting point. |
| `07_finance.sql`       | Wallets (and each team's `treasury_wallet_id`), a **computed** ledger, escrows (funded + released), team payout splits, invoices with line items, orders + lines (products, services, a booked session, a refund), every card payment a settled `inbound_payments` row (the seed conserves money: `finance.v_conservation_identity` reads 0, FBP DB16), baskets, cards, payment methods, payout accounts/schedules/payouts, subscriptions, a spending cap, a pending spend approval, the vault audit trail (`finance.ledger_audit`, **derived** from the ledger — see below), Income Smoother, pots — plus the checkout's own states (see [§ Checkout states](#checkout-states)). **No `finance.vault_permissions` rows are written**: the wallet insert trigger projects them from the workspace roles (`org.fn_sync_vault_permissions`), so the seed cannot disagree with the console about who may spend |
| `08_comms.sql`         | General + per-stage project channels with messages and participants, DM/group/service-inquiry threads with per-participant read state, **entity channels** (Decision #306, `gen/world.ts` `ENTITY_CHANNELS`): every team's and business's `general` is made by the entity-insert trigger (an idempotent `comms.fn_ensure_default_channel` backfill covers the rest), Atelier Nova and North Loop also get `delivery-sync` and `client-updates`; participants are added by trigger from the active rosters, so the seed writes only the extra channels, their messages and each member's `last_read_at`; 44 catalog-typed notifications (16 unread), auto-responses |
| `08_scheduling.sql`    | Ten schedules (nine published, Chloe's a draft) in their owners' own timezones: 50 weekly `working_hours` bands (one layer, Decision #408), three blackouts (one private label, two public), eight call-settings rows with twelve platforms, eight events (five busy blocks, two syncs, and Chloe's booked review at the same instant as her order line), and four discovery calls — one proposed, two confirmed (one paid) and one completed. And one cohort taking bookings on the group-session listing "Design systems workshop" (`svc-ruxa6p25af`, Maris), shaped as `projects.open_cohort` leaves one (Decision #498, closing #453 (e)): its group engagement and "Sessions" stage, the cohort at the listing's cohort size (16) with a minimum of 4, its one two-hour sitting on the Tuesday three weeks out at 18:00 Europe/London, enrolment closing a day before, and the sitting's calendar mirror on Maris's schedule |
| `09_search.sql`        | Hand-written projection of everything above into the `search.*` indexes — products and articles into `search.catalogue_index` (Decision #179). No vectors: see the backfill above |
| `10_profiles.sql`      | The public profile's presentation layer (`gen/profiles.ts`): 30 showcase slots across seven freelancers and three teams (slot 1 always a still), 12 "Selected work" pieces with covers, 4 certifications (two platform-verified), and 4 privacy rows — Maris and Juno allow their photo to be opened full size, Ren hides the local clock, Theo hides the location line |
| `11_standing.sql`      | Hand-written: every seller's Standing inputs **derived from the seeded record**, then the rung computed by the platform's own `org.fn_recompute_standing` (see [§ Standing](#standing)) |
| `12_community_feedback.sql` | The feedback board (`gen/world.ts` `FEEDBACK_IDEAS`, Decision #272): sixteen ideas by the personas — four Shipped, three In progress, five Planned, three under review (each visible only to its author), one Archived — each with its submission and every move in `community.feedback_status_events`, the author's own vote plus its voters (`vote_count` kept by the trigger), and team responses on nine. Stable `fbk-…` slugs from the idea's key. The fixture road serves the same sixteen (`feedback-fixtures.contract.test.ts`). |
| `13_analytics.sql`     | Hand-written (MARKETPLACE SC5): 91 days (91 days ago → yesterday, UTC) of anonymous guest traffic on every published service and product listing — impressions (two keyword queries per listing, so most days clear the k ≥ 5 line), clicks and page views, every figure from `hashtext(listing ‖ day)` — then `analytics.fn_backfill_listing_rollups` over the same days, which writes the sellers' Analytics rollups and derives `catalogue.listings.view_count` / `order_count` (the corpus's placeholder counters are zeroed first). No persona gets a browsing trail; ~78k `search.interest_events` rows, ~10k rollup rows |

## Standing

`org.entity_standing` is a cache that a recompute sweep maintains, and nothing in this file is typed
in: every input is a count over rows the earlier files wrote, and the score, the components and the
rung come from `org.fn_recompute_standing` — the same function a live sweep runs. The inputs, for
each freelancer (by user id) and team (by team id):

| Input                  | Derived from                                                                                           |
| :--------------------- | :----------------------------------------------------------------------------------------------------- |
| `stages_completed`     | Completed `projects.stage_assignments` — the ladder's volume floor counts these                         |
| `completion_rate`      | Delivered tickets ÷ (delivered + held tickets a workload report was filed on)                          |
| `on_time_rate`         | Delivered tickets whose ACCEPTED submission arrived by the due date ÷ delivered (the client's later approval is not the freelancer's delay; no due date cannot be late) |
| `client_rating_avg`    | The platform's cached `rating_average` (maintained from `reviews.entity_reviews`)                      |
| `peer_rating_avg`      | 0 — the platform records no peer reviews yet, so a one-track record is honestly halved by the formula |
| `dispute_rate`         | Disputed ÷ all escrows the subject was the payee of                                                    |
| `workload_reliability` | Held tickets with no workload report ÷ held tickets                                                    |
| `tenure_days`          | Days since the account (or team) was created                                                            |
| `penalty_severity`     | Active, unexpired `security.penalties`                                                                  |

The same recompute also materialises each subject's `active_adornments` and a freelancer's
`verification_stamp` (Decision #155). The stamp was already written when `01_identities.sql`
inserted the seller's `org.freelancer_profiles` row (`trg_freelancer_profiles_verification_stamp`),
so the `ON CONFLICT DO UPDATE` here keeps it. With no seller past five completed stages and no
streak or achievement writer in the seeded world, most sellers hold few or no trust signals — the
honest result, as with the rung below.

**Every seller reads as "New" (L1), and that is the honest result.** The ladder has two gates — a
score and a completed-stage floor (5 for Established) — and nobody in the seeded world has completed
five stages. Scores still differ by record: Maris scores 90 on one on-time delivery rated 5.0 (held at
L1 by the floor, which is the Standing gauge's "stage floor" case), North Loop 89.6, Kwame 80, Tomasz
77.5, and sellers with no delivery yet 15–30 (tenure, the dispute-free share and, where they hold
work, reliability). `org.profiles_index` projects the rung publicly (`standing_level` /
`standing_label`), so the listing, the card, the profile and the wallet all read the same row.

## Checkout states

The checkout reads everything live, so the states a developer needs to see are DATA, not switches
(the Dev Context Switcher's fake basket/checkout axes were removed with the fixtures).

| Buyer                  | Basket                                                                                                                       | Saved details              | What it exercises                                                                                   |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :------------------------- | :-------------------------------------------------------------------------------------------------- |
| `noor` (AED display)   | Motion primitives (product) · a 1-on-1 portfolio review booked for next Tuesday 15:00 Dubai time · a one-off service, parked | Complete (Dubai address)   | Currency conversion; a line the wallet cannot settle (the session) blocking until it is parked       |
| `theo` (USD display)   | Grain — Lightroom pack + Dashboard blocks, **WELCOME10 applied** (−10%)                                                      | **None**                   | The Details step on a first purchase; a promo priced by the page and re-validated by the charge      |
| Helia Finance (as `hannahcole`) | Packaging art direction (direct deliverable) · 3 seats on the design-systems workshop                               | Complete company record    | A business basket spending from a KYB-verified vault under a spending cap; monthly invoicing eligible |

Product lines carry the buyer's email as their delivery address — what the app's add path writes by
default. Five promotional codes cover every state a buyer can meet: `WELCOME10` (10%) and `STUDIO20`
($20) redeemable, `SPRING15` expired, `FOUNDERS50` fully redeemed, `BETA5` withdrawn. A code's label
states only what the table enforces — there is no minimum-order or first-order column, so no label
claims one.

A wallet payment consumes the lines it pays for, so a purchase made while exploring leaves the basket
emptier than seeded; `deno task db:reset` restores it.

## Images

`test_images/` is the source (it is not tracked). The generator copies each file into
`supabase/seed-assets/<bucket>/<anchor>/<name>` — the object-name layout the storage RLS policies key
on, where the first segment is a user, team, business or project id — and `db reset` uploads that
tree through the storage API from `[storage.buckets.*].objects_path` in `config.toml`.

| Bucket          | Anchor        | Holds                                                                   |
| :-------------- | :------------ | :---------------------------------------------------------------------- |
| `avatars`       | user / entity | 24 — profile photos and banners, team marks, business logos, team banners, employer logos |
| `catalogue`     | seller user   | 23 — product covers, service covers, and each article's cover and inline image |
| `project`       | project       | 5 submission deliverables (private; reachable only through project access) |
| `showcase`      | user / team   | 30 — profile showcase slots, laid out exactly as the media pipeline writes a rendition (`{owner}/showcase/{rendition}/full.{ext}`, `purpose = 'showcase'`) |
| `public_assets` | user · `platform/` | 12 portfolio covers (`{user}/portfolio/{n}.{ext}`, library uploads the owner can pick again from the media picker) + 1 landing hero (`platform/marketing/hero.webp`). The hero is platform-owned, so it has no `files.items` row; the app builds its URL from bucket + path like every other public object. |
| `personal`      | `users/{seller}` | 4 sale files (Decision #488): what *Iconography set — 640* (Maris Delacroix) and *Grain — Lightroom pack* (Ren Koda) deliver, two each (`SALE_FILES` in `gen/world.ts`), as private library uploads (`users/{seller}/library/{product}-{n}/{name}`). Each product's `file_manifest` names them by `fileId`. |
| `originals`     | product       | The same 4 files at `{product}/{version}/{file}`: each product's frozen version 1, ready (`catalogue.product_versions` in `05_catalogue.sql`). No `files.items` row and no storage policy — reached only by `/api/downloads/*`. A fresh reset can therefore be bought and downloaded end to end. |

`files.items` carries `bucket_id` + `storage_path` (no FK onto `storage.objects`), so the SQL seed and
the upload are independent halves that agree by construction — the reset verifies 94 = 94 (plus the
one platform asset). No image anywhere in the seed or the app is an external hotlink.

The two `.avif` covers were converted to WebP: the CLI infers an upload's MIME type from its
extension, does not know `.avif`, and the storage API refuses `application/octet-stream`.

## Invariants the generator enforces

- **Ledger.** Every `balance_after_cents` is a running balance over a chronologically sorted event
  list per wallet; the generator refuses to emit if any balance would go negative, and same-day
  rows are staggered by seconds so `ORDER BY created_at` reproduces the walk. **Nothing is minted**:
  the platform's opening-credit trigger is gone (Decision #61), so each business opens with a real
  dated `topup` of 2,500,000 minor units from its owner's funding card on the day it was created.
  Platform fee 5%; team income = 10% vault retention + `contribution_agreements` split.
- **The vault audit is derived, not typed.** Every `topup` credit to a business or team wallet
  becomes one `finance.ledger_audit` `add_funds` row attributed to the entity's owner (the opening
  one noted "Opening deposit", Helia's and Atlas's later ones "Q4 hiring budget" / "Analytics
  platform build"), so the Money module's contribution ledger and the wallet's transactions cannot
  disagree.
- **Roles are presets; rank is derived.** Role rows store no capabilities (a preset's bundle is
  `org.fn_preset_capabilities`), and every membership row passes through `org.fn_member_role_sync`,
  which derives `role` from the held role and enforces the one-owner invariant — the seed's own
  `role` column is overwritten to agree.
- **Idempotency.** Every id derives from a natural key; every insert is `ON CONFLICT DO NOTHING`,
  except stages and tickets, which use `INSERT … SELECT … WHERE NOT EXISTS` because
  `fn_enforce_structure_variation` is a BEFORE INSERT trigger and would count the duplicate before
  the conflict clause could drop it, and showcase slots, whose arbiter is the SLOT
  `(owner_type, owner_id, position)` rather than the row id — once an owner has placed their own
  picture in a slot, a re-run leaves it there instead of failing on the slot's uniqueness. Re-running
  all thirteen files on a seeded database is a no-op — `11_standing.sql` re-derives the same inputs and
  recomputes the same rungs (each run appends a `recomputed` row to `org.standing_events`, as a live
  sweep would), and `13_analytics.sql` finds its `seed-…` sessions already there, inserts no traffic
  and re-derives the same rollups and counters.
- **Stable addresses.** Project, stage and ticket slugs are minted deterministically in the CHECKed
  shape, so `/projects/prj-…` links survive a reset.
- **Relative time.** A schedule is only useful if it is about THIS week, so every scheduled instant
  — an event, a blackout, a discovery call, a booked session's `scheduled_at` — is written as a
  Postgres expression anchored on `date_trunc('week', now() AT TIME ZONE <owner's zone>)` rather than
  as a fixed timestamp. A reset on any date lands the same world on the current and following
  weeks, at the right local wall-clock time in each owner's own zone (DST included).
- **Bands are well-formed.** The generator refuses to emit a band whose end is not after its start,
  or two bands of one kind that overlap on the same day — the same shapes the table's CHECK and the
  booking gate would reject later, caught at generation instead.
- **Offerable currencies only.** A persona's display currency must be one of `DISPLAY_CURRENCIES`
  (the Zod SSOT, imported by the generator): an unofferable one falls back to GBP at read time with
  nothing saying why, so the generator refuses it instead. Theo reads USD and Tomasz EUR for that
  reason (BRL and PLN are not offered).
- **Basket lines match their listings.** A service line's kind must match the listing's delivery
  model (the live basket refuses a mismatch), a session line must carry a time, and every line's
  price snapshot follows the live basket's own pricing rule — so a seeded basket reads exactly as one
  built through the app.
- **Fees round half-up**, per line, as `platformFeeFor` and the wallet checkout do — a seeded sale
  and a live one are charged by the same arithmetic.
- **Offer terms the listing door would accept** (`emit-catalogue.ts` `assertServiceTerms`). Tier
  prices only on a tiered Pipeline, each stage's Low ≤ Standard ≤ High (Decision #417); a session
  plan only on a session listing, with no more entries than its sitting count and each title and
  description within 80 / 600 characters (Decision #411). `catalogue.save_listing` refuses the same
  shapes on a live save.
- **Triggers stay on.** `handle_new_user` is a no-op without `username`/`dob` metadata; the
  `users_public` triggers seed preferences, notification prefs and the search index; the ticket
  triggers derive each freelancer's `current_workload_intensity`; the review trigger derives ratings.

## Known gaps

- An individual client (Noor, Theo) cannot fund escrow — `finance.escrows.payer_business_id` is
  `NOT NULL` — so Juno's in-progress ticket on Noor's site is `unpaid` (Decision #56(a)).
- ~~A live team split would miss its members~~ — **resolved 2026-09-28**: `fn_split_team_payout`
  now credits the wallet each person actually holds (`finance.fn_person_wallet_type`, creating it if
  missing), so the seed's one-wallet-per-person layout is paid correctly.
- Only the PUBLIC scheduling surfaces read the seeded `scheduling.*` rows so far. The project
  calendar and the personal `/calendar` agenda still derive their events in the app, so the busy
  blocks on a provider's public schedule are not yet the same events their own calendar shows.
- Two products have no cover of their own (six product images, eight products); their galleries
  lead with the seller's other work, so every card still shows a picture.
- The two businesses (Helia Finance, Atlas Labs) have no banner, so the projects they post show the
  tonal band rather than a cover on the landing page and the project view.
- Five freelancers and five users have no profile photo (eight photos for eighteen personas); their
  avatars render the temporary default picture (`test_images/profile_1.jpg`, Decision #127), with
  initials beneath it.
- **Product downloads never arrive.** A product describes its files (`catalogue.products.file_manifest`)
  but no stored file backs them, `finance.order_lines.asset_id` has nothing to point at, and
  `files.fn_can_read` has no clause letting a buyer read a file attached to their order. Every
  product line — seeded or bought live from the wallet — therefore reads "the seller hasn't attached
  the files yet". Closing it is a feature (a product → file link, the purchase attaching it, a buyer
  read grant, storage policy), not seed data.
- Only digital products can be paid for: a service or session line needs escrow, which requires a
  project stage and a business payer (Decision #56(a)), so the checkout says so on those lines.
- Only one listing carries a CREATE category (Realtime MVP build, `create`); the other sixteen are
  untyped, so a buyer of any other seeded Pipeline gets untyped stages. No 1-on-1 listing is sold
  rolling (`session_rolling`): the corpus has no field for it yet (SC2, #417 (c) and (f), #411 (f)).
- Seeded images carry no WebP tiers (`files.item_variants` is empty for them): the generator copies
  originals rather than running the media pipeline, so a seeded avatar, showcase slot or cover is
  served at its original size with no `srcset` until its owner re-uploads through the pipeline.
