-- Replace separate startDate + endDate fields with a single DATE_RANGE field
-- in the LEAVE request type field schema.
--
-- The DATE_RANGE field stores { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }.
-- For HALF_DAY and WFH (single-day leave), from === to.
-- Existing formData in dynamic_requests is migrated so the old startDate/endDate
-- keys are replaced with a single dateRange key.

-- 1. Update the LEAVE fieldSchema definition
UPDATE "request_type_definitions"
SET "fieldSchema" = '[
  {
    "id": "leaveType",
    "label": "Leave Type",
    "type": "SELECT",
    "required": true,
    "order": 0,
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Casual",        "value": "CASUAL" },
      { "label": "Sick",          "value": "SICK" },
      { "label": "Half Day",      "value": "HALF_DAY" },
      { "label": "Work From Home","value": "WFH" },
      { "label": "Maternity",     "value": "MATERNITY" },
      { "label": "Wedding",       "value": "WEDDING" },
      { "label": "Umrah / Hajj",  "value": "UMRAH_HAJJ" },
      { "label": "Other",         "value": "OTHER" }
    ]
  },
  {
    "id": "dateRange",
    "label": "Date Range",
    "type": "DATE_RANGE",
    "required": true,
    "order": 1,
    "placeholder": "Select date range"
  },
  {
    "id": "halfDayPeriod",
    "label": "Half-Day Period",
    "type": "SELECT",
    "required": true,
    "order": 2,
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Morning",   "value": "FIRST_HALF" },
      { "label": "Afternoon", "value": "SECOND_HALF" }
    ],
    "showWhen": {
      "fieldId": "leaveType",
      "values": ["HALF_DAY"]
    }
  },
  {
    "id": "reason",
    "label": "Reason",
    "type": "TEXTAREA",
    "required": true,
    "order": 3,
    "maxLength": 2000
  },
  {
    "id": "medicalCertificateUrl",
    "label": "Medical Certificate",
    "type": "FILE_UPLOAD",
    "required": false,
    "order": 4,
    "showWhen": {
      "fieldId": "leaveType",
      "values": ["SICK", "MATERNITY"]
    }
  },
  {
    "id": "reportingManagerId",
    "label": "Reporting Manager",
    "type": "SELECT",
    "required": true,
    "order": 5,
    "dataSource": "USER"
  }
]'::jsonb
WHERE "key" = 'LEAVE';

-- 2. Migrate existing dynamic_requests formData:
--    merge { startDate, endDate } → { dateRange: { from, to } }
UPDATE "dynamic_requests"
SET "formData" = (
  "formData"
  - 'startDate'
  - 'endDate'
  || jsonb_build_object(
       'dateRange',
       jsonb_build_object(
         'from', "formData" ->> 'startDate',
         'to',   COALESCE("formData" ->> 'endDate', "formData" ->> 'startDate')
       )
     )
)
WHERE "typeKey" = 'LEAVE'
  AND "formData" ? 'startDate';
