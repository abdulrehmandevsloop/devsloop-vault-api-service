-- Populate LEAVE request type fieldSchema with leave-specific fields + conditions.
-- Guard: only runs if fieldSchema is still empty (no partial re-runs).
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
      { "label": "Casual", "value": "CASUAL" },
      { "label": "Sick", "value": "SICK" },
      { "label": "Half Day", "value": "HALF_DAY" },
      { "label": "Work From Home", "value": "WFH" },
      { "label": "Maternity", "value": "MATERNITY" },
      { "label": "Wedding", "value": "WEDDING" },
      { "label": "Umrah / Hajj", "value": "UMRAH_HAJJ" },
      { "label": "Other", "value": "OTHER" }
    ]
  },
  {
    "id": "startDate",
    "label": "Start Date",
    "type": "DATE",
    "required": true,
    "order": 1
  },
  {
    "id": "endDate",
    "label": "End Date",
    "type": "DATE",
    "required": true,
    "order": 2,
    "conditions": [
      { "fieldId": "leaveType", "operator": "neq", "value": "HALF_DAY" },
      { "fieldId": "leaveType", "operator": "neq", "value": "WFH" }
    ]
  },
  {
    "id": "halfDayPeriod",
    "label": "Half-Day Period",
    "type": "SELECT",
    "required": true,
    "order": 3,
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Morning", "value": "FIRST_HALF" },
      { "label": "Afternoon", "value": "SECOND_HALF" }
    ],
    "conditions": [
      { "fieldId": "leaveType", "operator": "eq", "value": "HALF_DAY" }
    ]
  },
  {
    "id": "reason",
    "label": "Reason",
    "type": "TEXTAREA",
    "required": true,
    "order": 4,
    "maxLength": 2000
  },
  {
    "id": "medicalCertificateUrl",
    "label": "Medical Certificate",
    "type": "FILE_UPLOAD",
    "required": false,
    "order": 5,
    "conditions": [
      { "fieldId": "leaveType", "operator": "in", "value": ["SICK", "MATERNITY"] }
    ]
  },
  {
    "id": "reportingManagerId",
    "label": "Reporting Manager",
    "type": "SELECT",
    "required": true,
    "order": 6,
    "dataSource": "USER"
  }
]'::jsonb
WHERE "key" = 'LEAVE'
  AND "fieldSchema" = '[]'::jsonb;
