-- Seed default field schemas for built-in request types.
--
-- Only updates rows whose fieldSchema is still the empty array written by the
-- original migration, so this is safe to run on databases that already have
-- custom schemas configured.

-- ─── LOAN ─────────────────────────────────────────────────────────────────────

UPDATE "request_type_definitions"
SET "fieldSchema" = '[
  {
    "id": "amount",
    "label": "Loan Amount (PKR)",
    "type": "NUMBER",
    "required": true,
    "order": 1,
    "placeholder": "e.g. 50000",
    "min": 1
  },
  {
    "id": "requestedRepaymentMonths",
    "label": "Preferred Repayment Term",
    "type": "SELECT",
    "required": true,
    "order": 2,
    "placeholder": "Select months",
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "1 month",  "value": "1"  },
      { "label": "2 months", "value": "2"  },
      { "label": "3 months", "value": "3"  },
      { "label": "4 months", "value": "4"  },
      { "label": "5 months", "value": "5"  },
      { "label": "6 months", "value": "6"  },
      { "label": "9 months", "value": "9"  },
      { "label": "12 months","value": "12" },
      { "label": "18 months","value": "18" },
      { "label": "24 months","value": "24" },
      { "label": "36 months","value": "36" }
    ]
  },
  {
    "id": "purpose",
    "label": "Purpose / Reason",
    "type": "TEXTAREA",
    "required": true,
    "order": 3,
    "placeholder": "Why you need this loan and how you plan to repay",
    "minLength": 10,
    "maxLength": 2000
  },
  {
    "id": "notes",
    "label": "Additional Notes",
    "type": "TEXTAREA",
    "required": false,
    "order": 4,
    "placeholder": "Optional context for your reviewer",
    "maxLength": 1000
  }
]'::jsonb,
"updatedAt" = NOW()
WHERE "key" = 'LOAN'
  AND "fieldSchema" = '[]'::jsonb;

-- ─── ADVANCE SALARY ───────────────────────────────────────────────────────────

UPDATE "request_type_definitions"
SET "fieldSchema" = '[
  {
    "id": "reason",
    "label": "Reason",
    "type": "TEXTAREA",
    "required": true,
    "order": 1,
    "placeholder": "Brief reason for this advance",
    "minLength": 10,
    "maxLength": 2000
  },
  {
    "id": "notes",
    "label": "Additional Notes",
    "type": "TEXTAREA",
    "required": false,
    "order": 2,
    "placeholder": "Optional notes for your reviewer",
    "maxLength": 1000
  }
]'::jsonb,
"updatedAt" = NOW()
WHERE "key" = 'ADVANCE_SALARY'
  AND "fieldSchema" = '[]'::jsonb;

-- ─── REIMBURSEMENT ────────────────────────────────────────────────────────────

UPDATE "request_type_definitions"
SET "fieldSchema" = '[
  {
    "id": "reimbursementType",
    "label": "Reimbursement Type",
    "type": "SELECT",
    "required": true,
    "order": 1,
    "placeholder": "Select reimbursement type",
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Medical",         "value": "MEDICAL"          },
      { "label": "Food",            "value": "FOOD"             },
      { "label": "Fuel / Travel",   "value": "FUEL_TRAVELLING"  },
      { "label": "IT Gadgets",      "value": "IT_GADGETS"       },
      { "label": "Other",           "value": "OTHER"            }
    ]
  },
  {
    "id": "amount",
    "label": "Amount (PKR)",
    "type": "NUMBER",
    "required": true,
    "order": 2,
    "placeholder": "0",
    "min": 1
  },
  {
    "id": "transactionDate",
    "label": "Transaction Date",
    "type": "DATE",
    "required": true,
    "order": 3
  },
  {
    "id": "description",
    "label": "Description",
    "type": "TEXTAREA",
    "required": true,
    "order": 4,
    "placeholder": "Describe your expense...",
    "maxLength": 2000
  },
  {
    "id": "merchantName",
    "label": "Merchant Name",
    "type": "TEXT",
    "required": false,
    "order": 5,
    "placeholder": "Where did you make the purchase?"
  },
  {
    "id": "processingType",
    "label": "Processing Type",
    "type": "SELECT",
    "required": true,
    "order": 6,
    "placeholder": "Select processing type",
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Salary Adjustment", "value": "SALARY_ADJUSTMENT" },
      { "label": "Separate Payment",  "value": "SEPARATE_PAYMENT"  }
    ]
  },
  {
    "id": "receiptFile",
    "label": "Receipt",
    "type": "FILE_UPLOAD",
    "required": true,
    "order": 7,
    "helpText": "Max 5 MB. PDF, JPG, or PNG accepted.",
    "acceptedTypes": ["application/pdf", "image/jpeg", "image/png"],
    "maxFileSizeMb": 5
  }
]'::jsonb,
"updatedAt" = NOW()
WHERE "key" = 'REIMBURSEMENT'
  AND "fieldSchema" = '[]'::jsonb;
