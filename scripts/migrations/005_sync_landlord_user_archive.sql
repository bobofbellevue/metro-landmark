-- Update archive_landlord to also archive the linked user
-- This ensures dashboard user counts stay in sync with landlord counts

CREATE OR REPLACE FUNCTION archive_landlord(
    p_landlord_id INTEGER,
    p_archived_by_user_id INTEGER,
    p_archive_reason TEXT DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id INTEGER;
BEGIN
    -- Get the user_id linked to this landlord
    SELECT user_id INTO v_user_id
    FROM landlords
    WHERE landlord_id = p_landlord_id;
    
    -- Archive the landlord (and cascade to properties/units if enabled)
    PERFORM archive_entity(
        'landlords',
        p_landlord_id,
        p_archived_by_user_id,
        p_archive_reason,
        p_cascade
    );
    
    -- Also archive the linked user
    IF v_user_id IS NOT NULL THEN
        PERFORM archive_entity(
            'users',
            v_user_id,
            p_archived_by_user_id,
            COALESCE(p_archive_reason, 'Archived with landlord'),
            false  -- Don't cascade from user
        );
    END IF;
END;
$$;
