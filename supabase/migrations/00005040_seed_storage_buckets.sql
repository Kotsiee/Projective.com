-- Seed: storage.buckets (from 0207)

INSERT INTO
    storage.buckets (id, name, public)
VALUES (
        'quarantine',
        'quarantine',
        false
    ) ON CONFLICT (id) DO NOTHING;

INSERT INTO
    storage.buckets (id, name, public)
VALUES ('project', 'project', false) ON CONFLICT (id) DO NOTHING;

INSERT INTO
    storage.buckets (id, name, public)
VALUES (
        'public_assets',
        'public_assets',
        true
    ) ON CONFLICT (id) DO NOTHING;

INSERT INTO
    storage.buckets (id, name, public)
VALUES ('personal', 'personal', false) ON CONFLICT (id) DO NOTHING;
