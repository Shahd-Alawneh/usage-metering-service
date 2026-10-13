CREATE OR REPLACE FUNCTION validate_account_plan_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    plan_scope TEXT;
    plan_owner UUID;
BEGIN
    IF NEW.current_plan_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT scope, owner_account_id
    INTO plan_scope, plan_owner
    FROM plans
    WHERE id = NEW.current_plan_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected account plan does not exist';
    END IF;

    IF plan_scope <> 'account' THEN
        RAISE EXCEPTION 'An account must use an account-scoped plan';
    END IF;

    IF plan_owner IS NOT NULL AND plan_owner <> NEW.id THEN
        RAISE EXCEPTION 'An account cannot use another account''s custom plan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_user_plan_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    plan_scope TEXT;
    plan_owner UUID;
BEGIN
    IF NEW.current_plan_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT scope, owner_account_id
    INTO plan_scope, plan_owner
    FROM plans
    WHERE id = NEW.current_plan_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected user plan does not exist';
    END IF;

    IF plan_scope <> 'user' THEN
        RAISE EXCEPTION 'A user must use a user-scoped plan';
    END IF;

    IF plan_owner IS NOT NULL AND plan_owner <> NEW.account_id THEN
        RAISE EXCEPTION 'A user cannot use another account''s custom plan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_validate_plan
BEFORE INSERT OR UPDATE OF current_plan_id, id
ON accounts
FOR EACH ROW
EXECUTE FUNCTION validate_account_plan_assignment();

CREATE TRIGGER users_validate_plan
BEFORE INSERT OR UPDATE OF current_plan_id, account_id
ON users
FOR EACH ROW
EXECUTE FUNCTION validate_user_plan_assignment();
