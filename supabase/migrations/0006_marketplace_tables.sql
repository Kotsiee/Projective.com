CREATE TYPE marketplace.pricing_model AS ENUM ('flat_fee', 'per_seat', 'recurring_retainer');


CREATE TABLE marketplace.service_blueprints (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    freelancer_profile_id uuid NOT NULL,
    title text NOT NULL,
    description jsonb NOT NULL DEFAULT '{}'::jsonb,
    description_text text NOT NULL DEFAULT ''::text,
    pricing_model marketplace.pricing_model NOT NULL DEFAULT 'per_seat'::marketplace.pricing_model,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    currency text NOT NULL DEFAULT 'USD'::text,
    requires_upfront_escrow boolean NOT NULL DEFAULT true,
    max_seats_per_cohort integer NOT NULL DEFAULT 1,
    allow_continuous_enrollment boolean NOT NULL DEFAULT false,
    enrollment_window_days integer DEFAULT 7,
    session_template_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_published boolean NOT NULL DEFAULT false,
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    
    CONSTRAINT service_blueprints_pkey PRIMARY KEY (id),
    CONSTRAINT service_blueprints_freelancer_fkey FOREIGN KEY (freelancer_profile_id) REFERENCES org.freelancer_profiles(user_id)
);