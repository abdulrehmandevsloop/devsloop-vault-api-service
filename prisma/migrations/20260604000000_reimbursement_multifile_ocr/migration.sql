-- Reimbursement built-in form: receipts now drive the amount via OCR.
--
-- 1. Remove the manually-entered `amount` NUMBER field. The total is derived from
--    the verified receipt amounts on the client and stored in `formData.amount`.
-- 2. Remove the top-level `merchantName` and `transactionDate` fields — each receipt
--    now captures its own merchant / amount / date during OCR verification.
-- 3. Promote the single `receiptFile` (FILE_UPLOAD) to a multi-file upload so several
--    receipts can be attached and scanned (OCR is applied in the portal).
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
    "id": "description",
    "label": "Description",
    "type": "TEXTAREA",
    "required": true,
    "order": 2,
    "placeholder": "Describe your expense...",
    "maxLength": 2000
  },
  {
    "id": "processingType",
    "label": "Processing Type",
    "type": "SELECT",
    "required": true,
    "order": 3,
    "placeholder": "Select processing type",
    "dataSource": "STATIC",
    "staticOptions": [
      { "label": "Salary Adjustment", "value": "SALARY_ADJUSTMENT" },
      { "label": "Separate Payment",  "value": "SEPARATE_PAYMENT"  }
    ]
  },
  {
    "id": "receiptFile",
    "label": "Receipt Upload",
    "type": "MULTI_FILE_UPLOAD",
    "required": true,
    "order": 4,
    "helpText": "Upload one or more receipts. Each receipt is scanned and its amount is added to the total once verified.",
    "acceptedTypes": ["application/pdf", "image/jpeg", "image/png"],
    "maxFileSizeMb": 5,
    "maxFiles": 10
  }
]'::jsonb,
"updatedAt" = NOW()
WHERE "key" = 'REIMBURSEMENT';
