
CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores company accounts and API key hashes.
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    current_plan_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores built-in and custom usage plans.
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('account', 'user')),
    name TEXT NOT NULL,
    monthly_allowance BIGINT NOT NULL CHECK (monthly_allowance >= 0),
    max_units_per_request BIGINT NOT NULL
        CHECK (max_units_per_request > 0),
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (is_builtin = TRUE AND owner_account_id IS NULL)
        OR
        (is_builtin = FALSE AND owner_account_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX plans_builtin_unique
    ON plans (scope, name)
    WHERE is_builtin = TRUE;

CREATE UNIQUE INDEX plans_custom_unique
    ON plans (owner_account_id, scope, name)
    WHERE is_builtin = FALSE;

-- Stores users and their assigned plans.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    current_plan_id UUID REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (id, account_id)
);

ALTER TABLE accounts
    ADD CONSTRAINT accounts_current_plan_fk
    FOREIGN KEY (current_plan_id) REFERENCES plans(id);

-- Tracks monthly usage totals for accounts and individual users.
CREATE TABLE usage_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID,
    period_start DATE NOT NULL,
    units_consumed BIGINT NOT NULL DEFAULT 0
        CHECK (units_consumed >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (EXTRACT(DAY FROM period_start) = 1),

    FOREIGN KEY (user_id, account_id)
        REFERENCES users(id, account_id)
);

CREATE UNIQUE INDEX usage_account_period_unique
    ON usage_periods (account_id, period_start)
    WHERE user_id IS NULL;

CREATE UNIQUE INDEX usage_user_period_unique
    ON usage_periods (account_id, user_id, period_start)
    WHERE user_id IS NOT NULL;

-- Records each usage request and its decision.
CREATE TABLE usage_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    request_id TEXT NOT NULL,
    units BIGINT NOT NULL CHECK (units > 0),
    status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
    rejection_scope TEXT CHECK (
        rejection_scope IN ('account', 'user')
    ),
    rejection_rule TEXT,
    period_start DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (user_id, account_id)
        REFERENCES users(id, account_id),

    UNIQUE (account_id, request_id),

    CHECK (
        (status = 'accepted'
            AND rejection_scope IS NULL
            AND rejection_rule IS NULL)
        OR
        (status = 'rejected'
            AND rejection_scope IS NOT NULL
            AND rejection_rule IS NOT NULL)
    )
);

CREATE INDEX usage_requests_history_idx
    ON usage_requests (account_id, created_at DESC, id DESC);

CREATE INDEX usage_requests_user_history_idx
    ON usage_requests (account_id, user_id, created_at DESC, id DESC);
