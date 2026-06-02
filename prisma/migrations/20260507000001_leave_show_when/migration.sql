-- Replace LEAVE fieldSchema with the new showWhen visibility model.
-- showWhen: { fieldId, values[] } — field is shown only when formData[fieldId]
-- is one of values. Omit to always show.
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
    "showWhen": {
      "fieldId": "leaveType",
      "values": ["CASUAL", "SICK", "MATERNITY", "WEDDING", "UMRAH_HAJJ", "OTHER"]
    }
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
    "order": 4,
    "maxLength": 2000
  },
  {
    "id": "medicalCertificateUrl",
    "label": "Medical Certificate",
    "type": "FILE_UPLOAD",
    "required": false,
    "order": 5,
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
    "order": 6,
    "dataSource": "USER"
  }
]'::jsonb
WHERE "key" = 'LEAVE';
