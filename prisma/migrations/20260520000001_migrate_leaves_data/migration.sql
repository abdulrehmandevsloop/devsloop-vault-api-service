-- Migrate existing leave_requests into dynamic_requests (typeKey = 'LEAVE').
-- Legacy leave_requests table is kept side-by-side; this migration is additive.
-- IDs are preserved so any existing workflow_instances.requestId references remain valid,
-- and rows already present in dynamic_requests (leaves submitted via the dynamic path) are skipped.
--
-- LeaveStatus → DynamicRequestStatus mapping:
--   PENDING              → PENDING
--   TEAM_LEAD_APPROVED   → IN_PROGRESS   (intermediate stage, awaiting HR)
--   TEAM_LEAD_REJECTED   → REJECTED      (terminal)
--   APPROVED             → APPROVED
--   REJECTED             → REJECTED
--   CANCELLED            → CANCELLED
--   MODIFIED             → APPROVED      (HR-modified leaves are effectively approved; modification metadata kept in formData)

INSERT INTO "dynamic_requests" ("id", "typeKey", "requesterId", "formData", "status", "createdAt", "updatedAt")
SELECT
  lr.id,
  'LEAVE',
  lr."employeeId",
  jsonb_build_object(
    'leaveType',              lr."leaveType",
    'dateRange',              jsonb_build_object(
                                'from', to_char(lr."startDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                'to',   to_char(lr."endDate"   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                              ),
    'halfDayPeriod',          lr."halfDayPeriod",
    'daysConsumed',           lr."daysConsumed",
    'reason',                 lr.reason,
    'medicalCertificateUrl',  lr."medicalCertificateUrl",
    'reportingManagerId',     lr."reportingManagerId",
    'teamLeadId',             lr."teamLeadId",
    'teamLeadComment',        lr."teamLeadComment",
    'teamLeadReviewedAt',     lr."teamLeadReviewedAt",
    'requiresClientApproval', lr."requiresClientApproval",
    'hrId',                   lr."hrId",
    'hrComment',              lr."hrComment",
    'hrReviewedAt',           lr."hrReviewedAt",
    'category',               lr.category,
    'unpaidDays',             lr."unpaidDays",
    'originalLeaveType',      lr."originalLeaveType",
    'appliedByHrId',          lr."appliedByHrId",
    'modifiedByHrId',         lr."modifiedByHrId",
    'modifiedAt',             lr."modifiedAt",
    'modificationReason',     lr."modificationReason",
    'legacyStatus',           lr.status
  ),
  CASE lr.status
    WHEN 'PENDING'            THEN 'PENDING'::"DynamicRequestStatus"
    WHEN 'TEAM_LEAD_APPROVED' THEN 'IN_PROGRESS'::"DynamicRequestStatus"
    WHEN 'TEAM_LEAD_REJECTED' THEN 'REJECTED'::"DynamicRequestStatus"
    WHEN 'APPROVED'           THEN 'APPROVED'::"DynamicRequestStatus"
    WHEN 'REJECTED'           THEN 'REJECTED'::"DynamicRequestStatus"
    WHEN 'CANCELLED'          THEN 'CANCELLED'::"DynamicRequestStatus"
    WHEN 'MODIFIED'           THEN 'APPROVED'::"DynamicRequestStatus"
  END,
  lr."createdAt",
  lr."updatedAt"
FROM "leave_requests" lr
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety checks: abort the transaction if anything looks off.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  legacy_count            INT;
  migrated_count          INT;
  null_status_count       INT;
  type_def_exists         BOOLEAN;
  orphan_workflow_count   INT;
BEGIN
  -- 1. The LEAVE request-type definition must exist (typeKey is a free-text FK by convention).
  SELECT EXISTS (SELECT 1 FROM "request_type_definitions" WHERE "key" = 'LEAVE') INTO type_def_exists;
  IF NOT type_def_exists THEN
    RAISE EXCEPTION 'Migration aborted: request_type_definitions row for key=LEAVE is missing';
  END IF;

  -- 2. Status mapping must have covered every legacy row (CASE returns NULL on unknown enum value).
  SELECT COUNT(*) INTO null_status_count
  FROM "dynamic_requests"
  WHERE "typeKey" = 'LEAVE' AND "status" IS NULL;
  IF null_status_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % LEAVE rows have NULL status (unmapped LeaveStatus value)', null_status_count;
  END IF;

  -- 3. Row-count parity: every leave_requests row must now exist in dynamic_requests with the same id.
  SELECT COUNT(*) INTO legacy_count   FROM "leave_requests";
  SELECT COUNT(*) INTO migrated_count
  FROM "dynamic_requests" dr
  WHERE dr."typeKey" = 'LEAVE'
    AND EXISTS (SELECT 1 FROM "leave_requests" lr WHERE lr.id = dr.id);
  IF migrated_count < legacy_count THEN
    RAISE EXCEPTION 'Leave migration row-count mismatch: legacy=%, migrated=%', legacy_count, migrated_count;
  END IF;

  -- 4. Any workflow_instances pointing at a leave_requests id must now resolve in dynamic_requests
  --    (IDs are preserved, so this guards against accidental data loss).
  SELECT COUNT(*) INTO orphan_workflow_count
  FROM "workflow_instances" wi
  JOIN "leave_requests" lr ON lr.id = wi."requestId"
  WHERE NOT EXISTS (SELECT 1 FROM "dynamic_requests" dr WHERE dr.id = wi."requestId");
  IF orphan_workflow_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % workflow_instances reference a leave_requests id that did not land in dynamic_requests', orphan_workflow_count;
  END IF;

  RAISE NOTICE 'Leave migration verified: legacy=%, migrated=%', legacy_count, migrated_count;
END $$;
