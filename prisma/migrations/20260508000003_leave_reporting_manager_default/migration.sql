-- Change reportingManagerId field dataSource from USER to REPORTING_MANAGER
-- so the field auto-populates with the employee's assigned reporting manager.
UPDATE "request_type_definitions"
SET "fieldSchema" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = 'reportingManagerId'
      THEN jsonb_set(elem, '{dataSource}', '"REPORTING_MANAGER"')
      ELSE elem
    END
    ORDER BY (elem->>'order')::int
  )
  FROM jsonb_array_elements("fieldSchema") elem
)
WHERE "key" = 'LEAVE';
