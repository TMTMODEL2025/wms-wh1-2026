# Implementation Plan: External Inbound Flow (รับเข้าภายนอก / Supplier Purchase)

Integrate a dedicated **"รับเข้าภายนอก" (External Inbound / Purchase from Customer/Supplier)** workflow alongside the existing internal machine inbound (SM01-SM04), allowing operators to scan 10-digit batch barcodes, select target warehouse storage locations (Building H, F, E9, E10, I + Row/Basket), sync stock matching data to Cloud Firestore, and highlight external inbound items with clear badges in the Daily Inbound Report.

---

## User Review & Confirmed Decisions

> [!IMPORTANT]
> The following choices were confirmed by the user in Phase 1:

- **10-Digit Batch Scanning**: Scans 10-digit batch barcodes as usual (with automatic SAP Master record matching for material name, grade, thickness, width, and weight).
- **Storage Location Selection**: Dedicated building dropdown (H, F, E9, E10, I) + Row and Basket selector during external inbound scanning.
- **Unified Daily Inbound Report**: Integrated directly into the main Inbound report table in `DailyReportView.tsx`, with a distinct badge `[รับเข้าภายนอก]` (External Inbound) alongside `[SM01-SM04]` machine tags.

---

## 1. Overview & Core Concept

### What It Does
- **Inbound Mode Switch**: In `SlitFilmManagement.tsx` (Inbound Tab), operators can toggle between:
  1. `รับเข้าจากเครื่องจักร (SM01-SM04)` — Internal Machine Inbound
  2. `รับเข้าภายนอก (ซื้อจากลูกค้า/Supplier)` — External Inbound
- **Barcode & Location Workflow**:
  - Scanning or typing a 10-digit Batch barcode looks up SAP Master data automatically.
  - Operator selects the target storage location (`Building` e.g., H, F, E9, E10, I + `Row` e.g., A-Z + `Basket` e.g., H-A01).
- **Data Persistence & Cloud Sync**:
  - Records created with `inboundType: "external"` (or `machine: "EXTERNAL"` / `conditionText: "รับเข้าภายนอก"`).
  - Saved to local storage and automatically batch-synced to Cloud Firestore (`tmt_wms_slit_inbound_records`).
- **Reporting & Visual Badges**:
  - In `DailyReportView.tsx`, Section 1 "รายงานการรับเข้า" displays both internal machine records and external inbound records seamlessly.
  - External inbound items feature a distinctive badge: `[รับเข้าภายนอก]` (Cyan / Indigo badge) to differentiate from `[SM01]`, `[SM02]`, etc.

---

## 2. User Experience & Visual Design

### Inbound Workflow (SlitFilmManagement.tsx)
1. **Mode Switcher Bar**:
   - Clean segmented control at the top of Inbound Section:
     - `[ 🏭 รับจากเครื่องจักร (SM01-SM04) ]` (Default)
     - `[ 🚛 รับเข้าภายนอก (ซื้อลูกค้า/Supplier) ]`
2. **External Inbound Panel**:
   - **Barcode Input / Camera Scanner**: Accepts 10-digit batch barcode input.
   - **Location Selector**:
     - Building Selector (`อาคาร H`, `อาคาร F`, `อาคาร E9`, `อาคาร E10`, `อาคาร I`)
     - Row & Basket Picker (e.g. `แถว A`, `ตะกร้า 01` -> `H-A01`).
   - **Real-time SAP Material Match Card**: Shows Grade, Thickness, Width, and Weight (kg) preview upon scanning.
   - **Continuous Scanner Mode**: Retains scanner window open for rapid multi-batch receiving.

### Reporting Experience (DailyReportView.tsx)
- In **Section 1: รายงานการรับเข้า**, external inbound entries are tagged with a bold badge `[รับเข้าภายนอก]` and supplier notes if applicable.
- Full filter support for selected Date, Shift, and Pagination.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unified Inbound Data Structure**:
  - *Choice*: Extend existing `InboundCoilRecord` schema with `inboundType: "internal" | "external"` and set `machine: "EXTERNAL"` or `conditionText: "รับเข้าภายนอก (ซื้อลูกค้า)"`.
  - *Rationale*: Avoids duplicating database collections or report components, maintaining 100% backward compatibility and Zero Code Regression.

- **Decision 2: Location Picker Integration**:
  - *Choice*: Reuse `getStoredMasterBasketLayout()` building & row structure to populate target location options.
  - *Rationale*: Guarantees valid location codes (e.g., `H-A01`, `F-B05`) that immediately populate the Warehouse Storage Space grid.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SlitFilmManagement (Inbound View)                     │
│                                                                        │
│  [ Toggle: รับจากเครื่องจักร (SM) ] | [ Toggle: รับเข้าภายนอก (External) ]│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
   [ Internal SM01-SM04 ]                  [ External Inbound ]
   - Machine: SM01-SM04                    - Source: External / Supplier
   - Location: Machine Rack                - Target: Building H/F/E9/E10/I
               │                                         │
               └────────────────────┬────────────────────┘
                                    │
                                    ▼
                      InboundCoilRecord Object
              { batch, inboundType: "external", ... }
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
            localStorage Storage          Cloud Firestore Sync
         (tmt_wms_slit_inbound)       (tmt_wms_slit_inbound_records)
                                                   │
                                                   ▼
                                           DailyReportView.tsx
                                      [Badge: รับเข้าภายนอก]
```

### Proposed Changes Across Files

1. **`src/types/` / `SlitFilmManagement.tsx`**:
   - Extend `InboundCoilRecord` interface: `inboundType?: "internal" | "external"; supplierName?: string;`.
2. **`src/components/SlitFilmManagement.tsx`**:
   - Add state `inboundSourceType: "internal" | "external"`.
   - Add External Inbound form panel with Location Picker (`selectedExternalBuilding`, `selectedExternalRow`, `selectedExternalBasket`).
   - Connect barcode scanner to create external inbound records.
3. **`src/components/DailyReportView.tsx`**:
   - Update Section 1 title and machine badge rendering: render `[รับเข้าภายนอก]` badge when `r.inboundType === "external"` or `r.machine === "EXTERNAL"`.
4. **`src/config/version.ts`**:
   - Bump app version to `v2.8.0`.

---

## Verification Plan

### Automated Build & Syntax Verification
1. Run `compile_applet` and `lint_applet` together to ensure build succeeds with 0 TypeScript/ESLint errors.
2. Restart dev server using `restart_dev_server`.

### Manual Testing Scenarios
1. **External Inbound Scan**: Switch to "รับเข้าภายนอก", scan a 10-digit batch code, select Building H / Row A / Basket 01, and confirm receiving.
2. **Storage Grid Verification**: Verify the scanned batch appears in Building H-A01 storage basket.
3. **Daily Report Verification**: Check Section 1 in Daily Report to confirm the record displays with `[รับเข้าภายนอก]` badge.
