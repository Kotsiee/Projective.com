# Development seed

`supabase db reset` (or `deno task db:reset`) rebuilds the local database from the consolidated
migrations and then loads a **complete, interconnected development world**: seventeen real personas,
three teams, two businesses, seven projects in every hiring and delivery state, funded and released
escrows, a computed wallet ledger, product and service orders, direct messages, project channels,
read/unread notifications, and published schedules with working hours, call windows, time off and
discovery calls — with profile photos, banners, brand marks, product/service covers and submission
deliverables served from the local storage buckets.

Everything below is **generated**, and it is the ONLY copy of this data: the discovery surfaces
(`/explore`, `/view/[id]`, the landing page) and the booking surfaces (a listing's Book modal and
Contact menu, `/[handle]/availability`, `/view/[id]/schedule`) read it live, so there is no in-app
fixture for it to drift from. The source of truth is three places:

| Source                                    | Owns                                                                                                  |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `supabase/seeds/gen/corpus.ts` (the listings) | The authored listing content — nine services with their stage templates, intake questions, team roles and session terms; eight products with manifests, specs and compatibility; five articles with block bodies. Seed-only: nothing outside `supabase/seeds/` imports it. |
| `supabase/seeds/gen/reviews.ts`           | The listing reviews (21 on services, 16 on products), each by a persona key.                           |
| `supabase/seeds/gen/world.ts` (the world) | Everything a running product accumulates — who is a member of what, who was hired into which stage, which tickets were paid, who messaged whom, what is unread. |
| `supabase/seeds/gen/schedules.ts`         | Ten schedules: each owner's timezone, working hours, call windows, time off, call settings and platforms, their busy events, and four discovery calls. |

`supabase/seeds/generate.ts` resolves them into `supabase/seeds/0*.sql` and the image tree under
`supabase/seed-assets/`, and **both outputs are committed** so a clone resets with no toolchain.
Regenerate after editing either source, then commit the result:

```sh
deno task db:seed:generate   # rewrites supabase/seeds/*.sql + supabase/seed-assets/**
deno task db:reset           # supabase db reset --local --yes
```

## Sign-in

Every account uses the password **`password123`** at `<username>@projective.dev`. The access-token
hook stamps each session's `active_context` (handle, `isFreelancer`/`isClient`, `onboarded: true`), so
every persona lands on the authenticated shell directly.

| Username         | Person          | Role                                   | Member of                     | Notable state                                                   |
| :--------------- | :-------------- | :------------------------------------- | :---------------------------- | :-------------------------------------------------------------- |
| `marisdelacroix` | Maris Delacroix | Freelancer (product design lead)       | —                             | KYC verified, Pro plan, 2 funded tickets, 1 released, Income Smoother enrolled, monthly payouts |
| `renkoda`        | Ren Koda        | Freelancer (3D & motion)               | —                             | Pending invitation from Theo (draft project), sells a product   |
| `juno`           | Juno Park       | Freelancer (frontend)                  | —                             | KYC pending, pending invitation + pending application, building Noor's site |
| `noor`           | Noor Haddad     | Client (creative director)             | —                             | Owns an individual project, 2 product orders, basket, unread DM |
| `theo`           | Theo Almeida    | Client (founder)                       | —                             | Draft project with a placeholder invitation, service + product orders |
| `inesduarte`     | Inês Duarte     | Freelancer, **owns Atelier Nova**      | Atelier Nova (owner)          | Claimed the one-off Verdant ticket, escrow held for the team    |
| `kwamemensah`    | Kwame Mensah    | Freelancer, **owns North Loop**        | North Loop (owner)            | Two released team escrows, instant payout, threshold schedule   |
| `saoirsebyrne`   | Saoirse Byrne   | Freelancer, **owns Studio Fern**       | Studio Fern (owner)           | Pending team invite to Chloe, service inquiry thread, auto-response |
| `priyaraman`     | Priya Raman     | Operator, **owns Helia Finance**       | Helia Finance (owner)         | KYB verified, USD vault with a pending spend approval           |
| `danielokafor`   | Daniel Okafor   | Operator, **owns Atlas Labs**          | Atlas Labs (owner)            | KYB pending, reviews North Loop, unread submission              |
| `lenamueller`    | Lena Müller     | Freelancer                             | Atelier Nova (admin)          | Rejected application                                            |
| `tomaszwojcik`   | Tomasz Wójcik   | Freelancer                             | North Loop (member)           | Completed ticket, team split credit, payout, pending application |
| `aikotanaka`     | Aiko Tanaka     | Freelancer                             | Atelier Nova + Studio Fern    | Member of two teams                                             |
| `samuelnkemelu`  | Samuel Nkemelu  | Freelancer                             | North Loop (lead)             | Ticket in review with a revision round, pending invitation      |
| `hannahcole`     | Hannah Cole     | Operator                               | Helia Finance (admin)         | Runs two projects, spending cap on the vault, unread applications |
| `miguelsantos`   | Miguel Santos   | Operator                               | Atlas Labs (member)           | Owns the hiring-stage Loop mobile project                       |
| `chloewinters`   | Chloe Winters   | Freelancer (new account)               | — (invited to Studio Fern)    | Unverified, pending application, booked a review session        |

## What is seeded, by file

| File                   | Contents                                                                                                                                                  |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_identities.sql`    | `auth.users` + `auth.identities`, `org.users_public`, emails, preferences (display currency/locale), freelancer profiles (KYC), skills, languages, links, KYC cases |
| `02_assets.sql`        | One `files.items` row per image (real size, SHA-256, dimensions in a schema-valid `AssetMetadata` envelope); avatar/banner links; education + experience (with employer logos) |
| `03_entities.sql`      | Teams + businesses (brand marks), system roles, memberships with titles, team contribution splits + split rules, KYB cases, a pending team invitation, follows, bookmarks |
| `04_marketplace.sql`   | Nine service blueprints (all five delivery models, team-owned where the corpus says so) with covers, stage templates (priced per stage), intake questions, team roles, deliverables and session terms |
| `05_catalogue.sql`     | Products (`prd-…` slugs, format, file manifest, specs, compatibility, licence), articles (`art-…` slugs, block bodies whose images are storage objects, covers), a published listing per product AND per service with its gallery (`file_id`), skills and tags, the listing reviews, and paid placements for the sponsored listings |
| `06_projects.sql`      | Seven projects with stable `prj-…` slugs, stages, participants, assignments (individual + team), invitations (pending/accepted/declined/placeholder), applications, tickets with history, submissions with deliverable files and a revision chain, starred projects, dual-track reviews |
| `07_finance.sql`       | Wallets, a **computed** ledger, escrows (funded + released), team payout splits, invoices with line items, orders + lines (products, services, a booked session, a refund), baskets, cards, payment methods, payout accounts/schedules/payouts, subscriptions, vault permissions, a spending cap, a pending spend approval, Income Smoother, pots |
| `08_comms.sql`         | General + per-stage project channels with messages and participants, DM/group/service-inquiry threads with per-participant read state, 44 catalog-typed notifications (16 unread), auto-responses |
| `08_scheduling.sql`    | Ten schedules (nine published, Chloe's a draft) in their owners' own timezones: 65 weekly bands (50 `working_hours`, 15 `call_window`), three blackouts (one private label, two public), eight call-settings rows with twelve platforms, eight events (five busy blocks, two syncs, and Chloe's booked review at the same instant as her order line), and four discovery calls — one proposed, two confirmed (one paid) and one completed |
| `09_search.sql`        | Hand-written projection of everything above into the `search.*` indexes                                                                                  |
| `10_profiles.sql`      | The public profile's presentation layer (`gen/profiles.ts`): 30 showcase slots across seven freelancers and three teams (slot 1 always a still), 12 "Selected work" pieces with covers, 4 certifications (two platform-verified), and 4 privacy rows — Maris and Juno allow their photo to be opened full size, Ren hides the local clock, Theo hides the location line |

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

`files.items` carries `bucket_id` + `storage_path` (no FK onto `storage.objects`), so the SQL seed and
the upload are independent halves that agree by construction — the reset verifies 94 = 94 (plus the
one platform asset). No image anywhere in the seed or the app is an external hotlink.

The two `.avif` covers were converted to WebP: the CLI infers an upload's MIME type from its
extension, does not know `.avif`, and the storage API refuses `application/octet-stream`.

## Invariants the generator enforces

- **Ledger.** Every `balance_after_cents` is a running balance over a chronologically sorted event
  list per wallet; the generator refuses to emit if any balance would go negative, and same-day
  rows are staggered by seconds so `ORDER BY created_at` reproduces the walk. The business-wallet
  opening-credit trigger is disabled around the wallet insert and replaced by a **dated** opening
  credit. Platform fee 5%; team income = 10% vault retention + `contribution_agreements` split.
- **Idempotency.** Every id derives from a natural key; every insert is `ON CONFLICT DO NOTHING`,
  except stages and tickets, which use `INSERT … SELECT … WHERE NOT EXISTS` because
  `fn_enforce_structure_variation` is a BEFORE INSERT trigger and would count the duplicate before
  the conflict clause could drop it, and showcase slots, whose arbiter is the SLOT
  `(owner_type, owner_id, position)` rather than the row id — once an owner has placed their own
  picture in a slot, a re-run leaves it there instead of failing on the slot's uniqueness. Re-running
  all eleven files on a seeded database is a no-op.
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
- **Triggers stay on.** `handle_new_user` is a no-op without `username`/`dob` metadata; the
  `users_public` triggers seed preferences, notification prefs and the search index; the ticket
  triggers derive each freelancer's `current_workload_intensity`; the review trigger derives ratings.

## Known gaps

- An individual client (Noor, Theo) cannot fund escrow — `finance.escrows.payer_business_id` is
  `NOT NULL` — so Juno's in-progress ticket on Noor's site is `unpaid` (Decision #56(a)).
- `fn_release_ticket_escrow` credits a `'freelancer'` wallet while `fn_split_team_payout` credits
  `'user'` wallets; the seed gives each person ONE wallet (`freelancer` for sellers, `user` for
  everyone else), so a live team split would miss its members until those two functions agree.
- Only the PUBLIC scheduling surfaces read the seeded `scheduling.*` rows so far. The project
  calendar and the personal `/calendar` agenda still derive their events in the app, so the busy
  blocks on a provider's public schedule are not yet the same events their own calendar shows.
- Two products have no cover of their own (six product images, eight products); their galleries
  lead with the seller's other work, so every card still shows a picture.
- The two businesses (Helia Finance, Atlas Labs) have no banner, so the projects they post show the
  tonal band rather than a cover on the landing page and the project view.
- Five freelancers and four users have no profile photo (eight photos for seventeen personas); their
  avatars render initials.
- Seeded images carry no WebP tiers (`files.item_variants` is empty for them): the generator copies
  originals rather than running the media pipeline, so a seeded avatar, showcase slot or cover is
  served at its original size with no `srcset` until its owner re-uploads through the pipeline.
