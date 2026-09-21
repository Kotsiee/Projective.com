# Development seed

`supabase db reset` (or `deno task db:reset`) rebuilds the local database from the consolidated
migrations and then loads a **complete, interconnected development world**: seventeen real personas,
three teams, two businesses, seven projects in every hiring and delivery state, funded and released
escrows, a computed wallet ledger, product and service orders, direct messages, project channels,
and read/unread notifications — with profile photos, banners, brand marks, product/service covers
and submission deliverables served from the local storage buckets.

Everything below is **generated**. The source of truth is two places:

| Source                                   | Owns                                                                                                  |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `packages/backend/mocks/` (the corpus)   | The identities and listings the app renders from fixtures — `@juno`, `@ateliernova`, every service, product, article and the five corpus projects. |
| `supabase/seeds/gen/world.ts` (the world) | Everything a running product accumulates — who is a member of what, who was hired into which stage, which tickets were paid, who messaged whom, what is unread. |

`supabase/seeds/generate.ts` resolves both into `supabase/seeds/0*.sql` and the image tree under
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
| `04_marketplace.sql`   | Nine service blueprints (all five delivery models, team-owned where the corpus says so) with covers                                                     |
| `05_catalogue.sql`     | Products, articles, a published listing per product AND per service, listing media via `file_id`                                                       |
| `06_projects.sql`      | Seven projects with stable `prj-…` slugs, stages, participants, assignments (individual + team), invitations (pending/accepted/declined/placeholder), applications, tickets with history, submissions with deliverable files and a revision chain, starred projects, dual-track reviews |
| `07_finance.sql`       | Wallets, a **computed** ledger, escrows (funded + released), team payout splits, invoices with line items, orders + lines (products, services, a booked session, a refund), baskets, cards, payment methods, payout accounts/schedules/payouts, subscriptions, vault permissions, a spending cap, a pending spend approval, Income Smoother, pots |
| `08_comms.sql`         | General + per-stage project channels with messages and participants, DM/group/service-inquiry threads with per-participant read state, 44 catalog-typed notifications (16 unread), auto-responses |
| `09_search.sql`        | Hand-written projection of everything above into the `search.*` indexes                                                                                  |

## Images

`test_images/` is the source (it is not tracked). The generator copies each file into
`supabase/seed-assets/<bucket>/<anchor>/<name>` — the object-name layout the storage RLS policies key
on, where the first segment is a user, team, business or project id — and `db reset` uploads that
tree through the storage API from `[storage.buckets.*].objects_path` in `config.toml`.

| Bucket      | Anchor        | Holds                                                                   |
| :---------- | :------------ | :---------------------------------------------------------------------- |
| `avatars`   | user / entity | 8 profile photos, 7 profile banners, 3 team marks, 2 business logos, 2 team banners, 2 employer logos |
| `catalogue` | seller user   | 6 product covers, 7 service covers                                       |
| `project`   | project       | 5 submission deliverables (private; reachable only through project access) |

`files.items` carries `bucket_id` + `storage_path` (no FK onto `storage.objects`), so the SQL seed and
the upload are independent halves that agree by construction — the reset verifies 42 = 42.

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
  the conflict clause could drop it. Re-running all nine files on a seeded database is a no-op.
- **Stable addresses.** Project, stage and ticket slugs are minted deterministically in the CHECKed
  shape, so `/projects/prj-…` links survive a reset.
- **Triggers stay on.** `handle_new_user` is a no-op without `username`/`dob` metadata; the
  `users_public` triggers seed preferences, notification prefs and the search index; the ticket
  triggers derive each freelancer's `current_workload_intensity`; the review trigger derives ratings.

## Known gaps

- An individual client (Noor, Theo) cannot fund escrow — `finance.escrows.payer_business_id` is
  `NOT NULL` — so Juno's in-progress ticket on Noor's site is `unpaid` (Decision #56(a)).
- `fn_release_ticket_escrow` credits a `'freelancer'` wallet while `fn_split_team_payout` credits
  `'user'` wallets; the seed gives each person ONE wallet (`freelancer` for sellers, `user` for
  everyone else), so a live team split would miss its members until those two functions agree.
- No `scheduling.*` rows (availability, events, discovery calls) are seeded yet.
- Two corpus products have no cover image (six images, eight products).
