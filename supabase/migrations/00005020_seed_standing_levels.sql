-- Seed: org standing ladder + achievements (from 20260724111000)
-- Ordered before the billing seed: finance.standing_commission_tiers FKs org.standing_levels(level).

INSERT INTO org.standing_levels
    (level, code, label, min_score, min_completed_stages, listing_base, proposal_bonus, discovery_weight_bp, description) VALUES
    (1, 'l1_new',         'New',         0.00,   0, 10,  0, 10000, 'Everyone starts here. Full free footprint — a new subject is never starved.'),
    (2, 'l2_established', 'Established', 55.00,  5, 15, 10, 10500, 'A consistent early track record.'),
    (3, 'l3_trusted',     'Trusted',     70.00, 20, 20, 20, 11000, 'Reliably delivers; low dispute exposure.'),
    (4, 'l4_expert',      'Expert',      82.00, 50, 30, 30, 11500, 'Sustained high accuracy and on-time delivery.'),
    (5, 'l5_elite',       'Elite',       92.00, 120, 50, 40, 12000, 'Top of the ladder. Boosted discovery and the lowest commission.')
ON CONFLICT (level) DO NOTHING;

INSERT INTO org.achievements (code, label, description, tier, is_public) VALUES
    ('first_payout',       'First Payout',        'Received a first released escrow payout.',                    'milestone', true),
    ('first_five_star',    'First Five Star',     'Earned a first 5-star client review.',                        'milestone', true),
    ('repeat_client',      'Trusted Again',       'A client returned for a second engagement.',                  'silver',    true),
    ('squad_ten_stages',   'Squad of Ten',        'Delivered ten stages as a single team unit.',                 'gold',      true),
    ('dispute_free_year',  'Clean Record',        'Twelve months of delivery with no upheld dispute.',           'gold',      true),
    ('architect',          'Architect',           'Consistently leads multi-person stages with high velocity and accuracy; unlocks leading Team-based stages and authoring Marketplace stage templates.', 'designation', true)
ON CONFLICT (code) DO NOTHING;
