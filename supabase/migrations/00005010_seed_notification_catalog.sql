-- Seed: comms.notification_types catalog (from 20260724090000)

INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
-- ── money ─────────────────────────────────────────────────────────────────────────────────────
('escrow.funded',            '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'Escrow secured for a stage — work may begin.'),
('escrow.needs_funding',     '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A lock trigger fired and the hold was refused — fund the ticket so work can start.'),
('escrow.released',         '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/wallet/transactions',                      NULL, 'Held escrow was released to the payee.'),
('escrow.refunded',          '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/transactions',                      NULL, 'Escrow was returned to the payer.'),
('order.line_refunded',      '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/transactions',                      NULL, 'A sale was refunded to its buyer before it cleared; its earnings were taken back (FBP DB21).'),
('escrow.disputed',          '{}',                'money',     'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/wallet/activity',                          NULL, 'Funds moved to the Dispute Lockbox.'),
('payout.sent',              '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/payouts',                           NULL, 'A payout left the platform toward your bank.'),
('payout.failed',            '{}',                'money',     'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/wallet/payouts',                           NULL, 'A payout could not be completed.'),
('payout.paid',              '{}',                'money',     'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  true,  NULL,              '/wallet/payouts',                           NULL, 'A payout reached your bank account.'),
('payout.reversed',          '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/payouts',                           NULL, 'A sent payout was reversed and returned to the wallet.'),
('payout.method_required',   '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, '7 days',          '/wallet/methods',                           NULL, 'Earnings are waiting but no payout method is set up.'),
('payout.schedule_paused',   '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/payouts',                           NULL, 'Scheduled payouts stopped after three runs in a row could not be sent.'),
('wallet.topup_succeeded',   '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  true,  NULL,              '/wallet/transactions',                      NULL, 'A top-up landed in the wallet.'),
('wallet.topup_failed',      '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/wallet/methods',                           NULL, 'A top-up was declined.'),
('wallet.low_balance',       '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '3 days',          '/wallet',                                   NULL, 'Balance fell below the configured floor.'),
('wallet.funds_pending',     '{}',                'money',     'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/wallet',                                   NULL, 'Released funds entered the 7-day safety window.'),
('wallet.funds_available',   '{}',                'money',     'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/wallet',                                   NULL, 'Pending funds cleared and are now withdrawable.'),
('invoice.issued',           '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, NULL,              '/wallet/invoices',                          NULL, 'An invoice was issued.'),
('invoice.overdue',          '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, false, '1 day',           '/wallet/invoices',                          NULL, 'An invoice passed its due date.'),
('statement.ready',          '{}',                'money',     'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/wallet/invoices',                          NULL, 'A monthly statement is ready to download.'),
('chargeback.opened',        '{}',                'money',     'critical', ARRAY['in_app','email']::comms.notification_channel[],        true,  true,  false, true,  NULL,              '/wallet/activity',                          NULL, 'A card chargeback was opened against a payment.'),
('chargeback.won',           '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/activity',                          NULL, 'A card chargeback was resolved in the payment''s favour — held escrow is released.'),
('chargeback.lost',          '{}',                'money',     'critical', ARRAY['in_app','email']::comms.notification_channel[],        true,  true,  false, true,  NULL,              '/wallet/activity',                          NULL, 'A card chargeback was upheld — the disputed amount was taken back from the wallet.'),
('spend_approval.requested', '{}',                'money',     'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, true,  NULL,              '/wallet/access',                            NULL, 'A vault member requested approval to spend.'),
('spend.approved',           '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/access',                            NULL, 'A spend you requested was approved.'),
('spend.rejected',           '{}',                'money',     'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/wallet/access',                            NULL, 'A spend you requested was declined.'),
('spend_approval.decided',   '{}',                'money',     'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  true,  NULL,              '/wallet/access',                            NULL, 'A spend request was approved or rejected.'),
('split.distributed',        '{}',                'money',     'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  true,  NULL,              '/wallet/transactions',                      NULL, 'A team split paid out your share.'),
('smoother.deposit',         '{}',                'money',     'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/wallet',                                   NULL, 'The Income Smoother made its scheduled deposit.'),
-- ── work ──────────────────────────────────────────────────────────────────────────────────────
('stage.funded',             '{stage_funded}',    'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage''s escrow was funded — work can begin.'),
('stage.approved',           '{stage_approved}',  'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage was approved and the payout released.'),
('sale_request.received',    '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A freelancer asks to sell work made on your project, for a royalty to you (MARKETPLACE SC7).'),
('sale_request.approved',    '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'The client granted your request to sell; its draft product is ready to price and publish.'),
('sale_request.declined',    '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'The client declined your request to sell; you may ask again.'),
('sale_request.withdrawn',   '{}',                'work',      'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A freelancer withdrew a request to sell work made on your project.'),
('sale_request.shared_listed','{}',               'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'Work made on your project under shared ownership is being listed for sale; shared ownership needs no grant.'),
('stage.cancelled',          '{stage_cancelled}', 'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A stage was cancelled under fair exit.'),
('stage.invite',             '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'You were invited to join a stage.'),
('stage.deadline_approaching','{}',               'work',      'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '12 hours',        '/projects/{context_id}',                    '2 days', 'A stage deadline is close.'),
('stage.deadline_missed',    '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'A stage deadline passed without delivery.'),
('ticket.assigned',          '{}',                'work',      'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A ticket was assigned to you.'),
('ticket.claimed',           '{}',                'work',      'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '30 minutes',      '/projects/{context_id}/board',              NULL, 'A freelancer claimed a ticket.'),
('ticket.revision_requested','{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A revision was requested on a ticket.'),
('ticket.completed',         '{}',                'work',      'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '30 minutes',      '/projects/{context_id}/board',              NULL, 'A ticket moved to completed.'),
('ticket.awaiting_funding', '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A stage of your ticket was approved and the ticket moved on, but its next stage''s escrow isn''t held yet.'),
('ticket.claim_expired',    '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/board',              NULL, 'A claim on a ticket expired before work started, and the ticket went back to the pool (Decision #516): to the lapsed claimant, and to the client when the ticket is still funded.'),
('submission.received',      '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/submissions',        NULL, 'A deliverable was submitted for review.'),
('submission.accepted',      '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission was accepted.'),
('submission.revision_requested','{}',            'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission needs revision.'),
('submission.awaiting_review','{}',               'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, '1 day',           '/projects/{context_id}/submissions',        '3 days', 'A submission has been waiting on the client (ghosting reminder).'),
('submission.auto_approved', '{}',                'work',      'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/projects/{context_id}/submissions',        NULL, 'A submission auto-approved after the review window elapsed.'),
('project.handover',         '{project_handover}','work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A project completed — contact sharing and files unlocked.'),
('project.completed',        '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/projects/{context_id}',                    NULL, 'A project reached its terminal state.'),
('project.cancelled',        '{project_cancelled}','work',     'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A project or service was cancelled by its client after its money was settled (Decision #467).'),
('project.member_joined',    '{}',                'work',      'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 hour',          '/projects/{context_id}/members',            NULL, 'Someone joined a project you are on.'),
('application.received',     '{}',                'work',      'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '1 hour',          '/projects/{context_id}',                    NULL, 'Someone applied to your project or stage.'),
('application.accepted',     '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}',                    NULL, 'Your application was accepted.'),
('application.declined',     '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              '/projects',                                 NULL, 'Your application was declined.'),
('application.withdrawn',    '{}',                'work',      'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              NULL,                                        NULL, 'An applicant withdrew their application to your project or stage.'),
-- The inviter's side of `stage.invite`: the invitee's answer to an outbound invitation. The accept is
-- high-signal (a seat just filled and money may move next); the decline is routine and digestible.
-- Templates are NULL because the router cannot address a project by slug — the emitter passes an
-- explicit slug-addressed `/projects/{slug}/members` link (Decision #88 retired the uuid address).
('invitation.accepted',      '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'Someone accepted your invitation to a project or stage.'),
('invitation.declined',      '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              NULL,                                        NULL, 'Someone declined your invitation to a project or stage.'),
-- ── messages ──────────────────────────────────────────────────────────────────────────────────
('message.new',              '{}',                'messages',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, '5 minutes',       '/messages/{entity_id}',                     NULL, 'A new message arrived in a conversation.'),
('message.mention',          '{}',                'messages',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, '5 minutes',       '/messages/{entity_id}',                     NULL, 'You were @mentioned.'),
('message.reaction',         '{}',                'messages',  'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '15 minutes',      '/messages/{entity_id}',                     NULL, 'Someone reacted to your message.'),
('channel.invited',          '{}',                'messages',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/projects/{context_id}',                    NULL, 'You were added to a channel.'),
-- ── schedule ──────────────────────────────────────────────────────────────────────────────────
('session.booked',           '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A session was booked.'),
('session.rescheduled',      '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A session moved to a new time.'),
('session.cancelled',        '{}',                'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, true,  NULL,              '/projects/{context_id}/calendar',           NULL, 'A session was cancelled.'),
('session.reminder_60m',     '{}',                'schedule',  'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '1 hour', 'A session starts in an hour.'),
('session.reminder_15m',     '{}',                'schedule',  'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '15 minutes', 'A session starts in 15 minutes.'),
('session.reminder_5m',      '{}',                'schedule',  'critical', ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/projects/{context_id}/calendar',           '5 minutes', 'A session is about to start.'),
('session.reschedule_vote',  '{}',                'schedule',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A cohort reschedule vote is open.'),
('session.scheduling_requested', '{}',           'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A set-session block was paid for: its remaining sittings are pencilled in weekly and their times are to be agreed (Decision #211).'),
('session.scheduling_reminder', '{}',            'schedule',  'high',     ARRAY['in_app','email','push']::comms.notification_channel[], false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'A day before the deadline to agree a set-session block''s remaining times (Decision #211).'),
('session.scheduling_lapsed', '{}',              'schedule',  'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              '/projects/{context_id}/calendar',           NULL, 'No other time was agreed by the deadline, so a sitting keeps its pencilled-in time (Decision #211).'),
-- The seller's cue that a cohort closed below its minimum and may be cancelled (Decision #498). The
-- template is NULL because the emitter links the listing's workspace by its slug.
('session.cohort_under_filled', '{}',            'schedule',  'high',     ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A cohort''s enrolment closed below its minimum; the seller may cancel it before its first session and refund every seat.'),
('availability.booking_request','{}',             'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/{handle}/availability',                    NULL, 'Someone requested a slot in your availability.'),
-- A cohort waitlist (Decision #455). In-app only until email is wired (COMMS NT3); the template is NULL
-- because a listing is addressed by its slug, which the emitter passes as `/view/{slug}`.
('waitlist.invited',         '{}',                'schedule',  'high',     ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A seat on a group session you are waiting for is held for you until the invite lapses.'),
('waitlist.invite_expired',  '{}',                'schedule',  'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              NULL,                                        NULL, 'A held waitlist seat lapsed unused and passed to the next person in the queue.'),
-- A buyer's shared seat was claimed through their seat link (Decision #522); links the engagement.
('session.seat_claimed',     '{}',                'schedule',  'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              NULL,                                        NULL, 'Someone claimed one of the seats a buyer shared through their seat link.'),
('waitlist.cohort_cancelled', '{}',              'schedule',  'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              NULL,                                        NULL, 'A cohort of a group session the person is waiting for was cancelled before it started; they keep their place (Decision #498).'),
-- ── discovery ─────────────────────────────────────────────────────────────────────────────────
-- Tells the owning party's followers of a listing's first publish (Decision #494 (C)): one notice per
-- seller per day, a batch included; the template is NULL because the emitter passes `/view/{slug}`.
('catalogue.listing_published','{}',              'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 day',           NULL,                                        NULL, 'A seller you follow put a listing on sale for the first time.'),
('catalogue.listing_paused', '{}',                'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, NULL,              '/catalogue/{entity_id}',                    NULL, 'A listing was paused.'),
('suggestion.next_steps',    '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '7 days',          '/explore',                                  NULL, 'Suggested next steps based on recent activity.'),
-- The two review notices (Decision #487) carry no template: reviews.fn_notify_received addresses a review
-- of a listing's provider to `/view/{slug}#evp-reviews` and any other to `/@{handle}/reviews`, and the
-- reminder to `/projects/{slug}?review={slug}`; a template cannot spell either.
('review.received',          '{}',                'discovery', 'medium',   ARRAY['in_app','push','email']::comms.notification_channel[], false, false, true,  false, NULL,              NULL,                                        NULL, 'You received a review.'),
('review.reminder',          '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '7 days',          NULL,                                        '3 days', 'A completed engagement is waiting on your review.'),
('profile.followed',         '{}',                'discovery', 'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 day',           '/{handle}',                                 NULL, 'Someone followed your profile.'),
('search.saved_alert',       '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '1 day',           '/explore',                                  NULL, 'New results matched a saved search.'),
-- ── account ───────────────────────────────────────────────────────────────────────────────────
('account.email_verified',   '{}',                'account',   'medium',   ARRAY['in_app']::comms.notification_channel[],                true,  false, false, true,  NULL,              '/settings',                                 NULL, 'An email address was confirmed.'),
('account.email_undeliverable', '{}',             'account',   'high',     ARRAY['in_app']::comms.notification_channel[],                true,  false, false, false, NULL,              '/settings/account#emails',                  NULL, 'Mail to your address bounced, so nothing more is sent to it until you change it or confirm it again (COMMS NT3; Decision #339, ruling N3 (b)).'),
('account.sign_in_changed',  '{}',                'account',   'critical', ARRAY['in_app']::comms.notification_channel[],                true,  true,  false, false, NULL,              '/settings/account',                         NULL, 'The address the account signs in with was changed.'),
('account.password_changed', '{}',                'account',   'critical', ARRAY['in_app','email']::comms.notification_channel[],        true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'The account password was changed.'),
('account.new_device_login', '{}',                'account',   'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'A sign-in came from an unrecognised device.'),
('account.kyc_submitted',    '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification was submitted.'),
('account.kyc_verified',     '{}',                'account',   'high',     ARRAY['in_app','email','push']::comms.notification_channel[], true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification succeeded.'),
('account.kyc_rejected',     '{}',                'account',   'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Identity verification was rejected.'),
('account.role_changed',     '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/settings',                                 NULL, 'Your capabilities on the platform changed.'),
('account.data_export_ready', '{}',               'account',   'high',     ARRAY['in_app']::comms.notification_channel[],                true,  false, false, false, NULL,              '/settings/account',                         NULL, 'Your copy of your data is ready to download for 7 days.'),
('account.data_export_failed', '{}',              'account',   'medium',   ARRAY['in_app']::comms.notification_channel[],                true,  false, false, false, NULL,              '/settings/account',                         NULL, 'Your copy of your data could not be prepared.'),
('team.invite',             '{}',                'account',   'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/teams',                                    NULL, 'You were invited to a team.'),
('team.member_joined',       '{}',                'account',   'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 hour',          '/teams',                                    NULL, 'Someone joined your team.'),
('team.member_removed',      '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/teams',                                    NULL, 'You were removed from a team.'),
('team.ownership_transferred','{}',               'account',   'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/teams',                                    NULL, 'Ownership of a team was transferred to you.'),
('business.invite',          '{}',                'account',   'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/businesses',                               NULL, 'You were invited to a business.'),
('business.member_joined',   '{}',                'account',   'low',      ARRAY['in_app']::comms.notification_channel[],                false, false, true,  false, '1 hour',          '/businesses',                               NULL, 'Someone joined your business.'),
-- Ask-to-join links (Decision #318): the request to the people who answer it, and the answer back.
('team.join_request',        '{}',                'account',   'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  true,  '1 hour',          '/teams',                                    NULL, 'Someone asked to join your team through its invite link.'),
('team.join_request_accepted','{}',               'account',   'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/teams',                                    NULL, 'Your request to join a team was approved.'),
('team.join_request_declined','{}',               'account',   'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, false, true,  NULL,              '/teams',                                    NULL, 'Your request to join a team was declined.'),
('business.join_request',    '{}',                'account',   'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, true,  true,  '1 hour',          '/businesses',                               NULL, 'Someone asked to join your business through its invite link.'),
('business.join_request_accepted','{}',           'account',   'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, true,  NULL,              '/businesses',                               NULL, 'Your request to join a business was approved.'),
('business.join_request_declined','{}',           'account',   'medium',   ARRAY['in_app']::comms.notification_channel[],                false, false, false, true,  NULL,              '/businesses',                               NULL, 'Your request to join a business was declined.'),
('business.member_removed',  '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/businesses',                               NULL, 'You were removed from a business.'),
('business.ownership_transferred','{}',           'account',   'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/businesses',                               NULL, 'Ownership of a business was transferred to you.'),
('enterprise.domain_colleague',     '{}',                'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '1 day',           '/settings',                                 NULL, 'A colleague from your corporate domain joined (PRODUCT_SPEC §Enterprises).'),
('business.permission_changed','{}',              'account',   'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/businesses',                               NULL, 'Your permissions on a business or vault changed.'),
-- ── system ────────────────────────────────────────────────────────────────────────────────────
('system.security_alert',    '{}',                'system',    'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/settings',                                 NULL, 'A security event needs your attention.'),
('system.maintenance',       '{}',                'system',    'medium',   ARRAY['in_app']::comms.notification_channel[],                true,  false, false, false, NULL,              NULL,                                        NULL, 'Planned maintenance affecting the platform.'),
('system.policy_update',     '{}',                'system',    'medium',   ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'Terms, privacy, or fee policy changed.'),
('dispute.opened',           '{}',                'system',    'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute was opened on an engagement.'),
('dispute.resolved',         '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute reached a resolution.'),
('dispute.response_requested','{}',               'system',    'critical', ARRAY['in_app','email','push']::comms.notification_channel[], true,  true,  false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute needs your response before its deadline, or it goes to an auditor.'),
('dispute.escalated',        '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/projects/{context_id}',                    NULL, 'A dispute went to a Projective auditor for a ruling.'),
('dispute.review_overdue',   '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              '/admin/disputes',                           NULL, 'Operators only: a dispute under review passed its review deadline without a ruling.'),
('report.filed',             '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'Content you own was reported.'),
('moderation.action',        '{}',                'system',    'high',     ARRAY['in_app','email']::comms.notification_channel[],        true,  false, false, true,  NULL,              NULL,                                        NULL, 'A moderation decision was applied to your account or content.'),
-- ── marketing (opt-in only; `mandatory` is barred by CHECK) ────────────────────────────────────
('marketing.newsletter',     '{}',                'marketing', 'low',      ARRAY['email']::comms.notification_channel[],                 false, false, true,  false, NULL,              NULL,                                        NULL, 'Platform newsletter (double opt-in, per topic; community.newsletter_subscriptions).'),
-- The abandoned-basket nudge (CK5, Decision #492, ruling A): Marketing, so opt-in and stopped by an
-- unsubscribe; email only, because an inbox row has no one-step opt-out; not digestible, as every
-- reminder; opens /checkout, which reprices. Sent by comms.fn_enqueue_basket_nudges, off until counsel.
('basket.abandoned',         '{}',                'marketing', 'low',      ARRAY['email']::comms.notification_channel[],                 false, false, false, false, '3 days',          '/checkout',                                 '1 day', 'A personal basket left idle: one reminder per idle spell, to an opted-in adult (comms.fn_enqueue_basket_nudges).'),
('marketing.product_update', '{}',                'marketing', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              NULL,                                        NULL, 'New platform features and product news.')
ON CONFLICT (key) DO NOTHING;


-- ── public & community surfaces (Decision #274) ─────────────────────────────────────────────────
-- One region per surface, each holding its OWN complete statement — `INSERT INTO
-- comms.notification_types (<the column list above>) VALUES ('<key>', …) ON CONFLICT (key) DO
-- NOTHING;` — so parallel work orders never edit the shared VALUES list above. Start every row on
-- its own line with `('<key>',` (packages/types/comms/catalog.contract.test.ts reads them), and add
-- each key to KNOWN_NOTIFICATION_TYPES in packages/types/comms/catalog.ts, in the same-named region.

-- #region [contact] Contact requests (P3)
-- Operators only (Decision #276): sent by ops.submit_contact_request to every ops.admin_users row. Not
-- mandatory and digestible — a burst of requests may arrive as a digest; the body names the intent and
-- the reference, never the sender's words. No action URL: there is no operator contact desk yet.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('contact.received',         '{}',                'system',    'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, NULL,              NULL,                                        NULL, 'Operators only: a request arrived through /contact.')
ON CONFLICT (key) DO NOTHING;
-- #endregion


-- #region [feedback] Feedback board status changes (P7)
-- Sent by community.set_feedback_idea_status to an idea's author and everyone who voted for it (never
-- the operator who moved it), linking `/feedback?idea=<slug>`. Opt-out-able and digestible; a second
-- move of the same idea within a day collapses into the first (`group_key` = `feedback:<slug>`).
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('feedback.status_changed',  '{}',                'discovery', 'low',      ARRAY['in_app','email']::comms.notification_channel[],        false, false, true,  false, '1 day',           NULL,                                        NULL, 'An idea you suggested or voted for on the feedback board moved to Planned, In progress, Shipped or Archived.')
ON CONFLICT (key) DO NOTHING;
-- #endregion


-- #region [integrations] A connection lost its grant (Decision #343, ruling C4)
-- Sent by integrations.fn_record_refresh_failure when a refresh answers invalid_grant: the connection
-- is `expired`, and only its owner can consent again. Not mandatory, and not digestible, because a
-- digest would hold back a reconnect that a booking may be waiting on (providers spec §7.6).
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('integration.reconnect_required', '{}',          'account',   'high',     ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              '/settings/integrations',                    NULL, 'A connected calendar or conferencing account stopped accepting Projective''s access, and needs reconnecting.')
ON CONFLICT (key) DO NOTHING;
-- #endregion


-- #region [quotes] Quote requests and offers (Decision #458)
-- Sent by the doors in 00001177 to the other party. Each door passes its own link — the host to the
-- buyer in their client pipeline, the buyer to the conversation with the host — so no template is
-- set. A sales lead, so `work` and not digestible: a digest would sit on an offer that expires.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('quote.requested',          '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'A buyer asked you to price custom scope on one of your services.'),
('quote.offer_received',     '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'A seller answered your quote request with a priced offer, or revised it.'),
('quote.offer_withdrawn',    '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A seller withdrew the offer they sent you.'),
('quote.declined',           '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A seller declined your quote request.'),
('quote.offer_accepted',     '{}',                'work',      'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'A buyer accepted your offer; nothing is charged until they pay at checkout.'),
('quote.offer_declined',     '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A buyer declined your offer.'),
('quote.withdrawn',          '{}',                'work',      'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A buyer withdrew their quote request.')
ON CONFLICT (key) DO NOTHING;
-- #endregion


-- #region [scheduling] Discovery-call expiry (S-11)
-- Sent by scheduling.fn_expire_discovery_calls to the requester and the host of a call request nobody
-- answered within discovery_call_proposal_ttl_hours or before its start. Shaped like
-- `availability.booking_request`, at medium urgency: nothing is left to act on. No action URL: an
-- expired call leaves both calendars.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('call.expired',             '{}',                'schedule',  'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'A discovery call request expired: nobody confirmed it within the proposal window or before its start time.')
ON CONFLICT (key) DO NOTHING;
-- #endregion


-- #region [scheduling] Discovery-call doors and reminders (S-10, S-18; Decision #343, ruling C3)
-- Sent by the five doors in 00001510 §7b to the other party, and by scheduling.fn_enqueue_due_reminders.
-- A declined or cancelled call leaves both calendars, so those two carry no action URL.
-- The two event.reminder keys are one alert on two channels (Decision #388): a person picks how each
-- alert arrives, the channels live on the type, and their preferences still narrow either one.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('event.reminder',           '{}',                'schedule',  'medium',   ARRAY['in_app','push']::comms.notification_channel[],         false, false, false, false, NULL,              '/calendar?event={entity_id}',               NULL, 'A calendar entry is coming up, at a lead its person chose.'),
('event.reminder_email',     '{}',                'schedule',  'medium',   ARRAY['email']::comms.notification_channel[],                 false, false, false, false, NULL,              '/calendar?event={entity_id}',               NULL, 'A calendar entry is coming up, by email, at a lead its person chose.'),
('schedule.event_invite',     '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/calendar?filter=invitations&event={entity_id}', NULL, 'Somebody invited you to an entry on their calendar.'),
('schedule.event_invite_withdrawn','{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL, NULL, 'The host withdrew your invitation, so the entry left your calendar.'),
('schedule.event_reschedule', '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/calendar?event={entity_id}', NULL, 'A new time was offered, put to a vote or agreed for an entry you are on.'),
('call.confirmed',           '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/calendar',                                 NULL, 'A discovery call was confirmed.'),
('call.declined',            '{}',                'schedule',  'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              NULL,                                        NULL, 'The host declined a discovery call request.'),
('call.time_proposed',       '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              '/calendar',                                 NULL, 'The other party proposed a new time for a discovery call.'),
('call.cancelled',           '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'A confirmed discovery call was cancelled.'),
('call.no_show',             '{}',                'schedule',  'medium',   ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              '/calendar',                                 NULL, 'The other party reported a no-show on a discovery call.'),
('call.reminder',            '{}',                'schedule',  'high',     ARRAY['in_app','push']::comms.notification_channel[],         false, true,  false, false, NULL,              '/calendar',                                 NULL, 'A confirmed discovery call starts soon.'),
('room.failed',              '{}',                'schedule',  'high',     ARRAY['in_app','email']::comms.notification_channel[],        false, false, false, false, NULL,              '/settings/integrations',                    NULL, 'A meeting room could not be created at its provider.'),
('session.review_requested', '{}',                'schedule',  'high',     ARRAY['in_app','push','email']::comms.notification_channel[], false, false, false, false, NULL,              NULL,                                        NULL, 'A session with no attendance record is waiting for the attendee to say whether it happened.')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region [ops] Alerts to the operators (OPS5)
-- Sent by ops.fn_deliver_alert_in_app to every ops.admin_users row: the in-app channel of the alert
-- sweep, beside the webhook and the email digest. Mandatory, so an operator cannot mute a money or job
-- alert; not digestible, because an alert waits for nobody. A repeat of the same alert group within a
-- day refreshes the operator's notice (`group_key` = `ops.alert:<group>`) instead of adding another.
-- The body is figures, short ids and codes only.
INSERT INTO comms.notification_types
    (key, aliases, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible, audit, group_window, action_url_template, default_lead_time, description)
VALUES
('ops.alert',                '{}',                'system',    'high',     ARRAY['in_app']::comms.notification_channel[],                true,  false, false, true,  '1 day',           '/admin/ledger',                             NULL, 'Operators only: a money error, a failed or stalled job, a failing webhook, a silent nightly check or a drill, from the alert sweep.')
ON CONFLICT (key) DO NOTHING;
-- #endregion
