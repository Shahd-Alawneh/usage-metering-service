ALTER TABLE usage_requests
    ADD COLUMN account_plan_id UUID REFERENCES plans(id),
    ADD COLUMN user_plan_id UUID REFERENCES plans(id),
    ADD COLUMN account_monthly_allowance BIGINT,
    ADD COLUMN account_max_units_per_request BIGINT,
    ADD COLUMN user_monthly_allowance BIGINT,
    ADD COLUMN user_max_units_per_request BIGINT;
