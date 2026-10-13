INSERT INTO plans (
    scope,
    name,
    monthly_allowance,
    max_units_per_request,
    is_builtin
)
VALUES
    ('account', 'Starter', 10000, 100, TRUE),
    ('account', 'Pro', 100000, 1000, TRUE),
    ('user', 'Basic', 1000, 20, TRUE),
    ('user', 'Premium', 10000, 100, TRUE)
ON CONFLICT (scope, name) WHERE is_builtin = TRUE
DO NOTHING;