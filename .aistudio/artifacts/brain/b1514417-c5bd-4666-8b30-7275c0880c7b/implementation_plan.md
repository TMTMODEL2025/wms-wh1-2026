# แผนการเชื่อมต่อฐานข้อมูล Cloud Database (Free Plan) สำหรับ WMS Warehouse 1

แผนงานแนะนำและออกแบบสถาปัตยกรรมฐานข้อมูลคลาวด์แบบใช้งานฟรี 100% (Free Tier) รองรับการซิงค์ข้อมูลแบบ Real-time ทันทีระหว่างอุปกรณ์มือถือ (Mobile Barcode Scanner) และคอมพิวเตอร์ (Desktop Warehouse Monitor) เพื่อทดสอบการทำงานของระบบส่วนงานสลิต (Slit Film) เป็นลำดับแรก ก่อนขยายผลสู่ 4 ส่วนงานที่เหลือ

## User Review & Critical Decisions

> [!IMPORTANT] สรุปผลการตัดสินใจและข้อแนะนำตามความต้องการของผู้ใช้งาน:
> 1. **บริการฐานข้อมูลที่เลือกใช้**: **Firebase Firestore (Spark Plan - ฟรี 100% ไม่ต้องผูกบัตรเครดิต)**
>    - *เหตุผล*: ปริมาณงาน 500 รายการ/วัน คิดเป็นเพียง ~2.5% ของโควตาฟรีต่อวัน (Firestore ให้ฟรี 20,000 Writes/วัน และ 50,000 Reads/วัน)
>    - *จุดเด่นสำคัญ*: มีฟีเจอร์ Real-time Sync (`onSnapshot`) ในตัวจาก Client SDK โดยตรง ทำให้แอปพลิเคชันที่ Deploy บน **Vercel** สามารถซิงค์ข้อมูลระหว่างมือถือและคอมพิวเตอร์ได้ทันทีในระดับมิลลิวินาที โดยไม่ต้องสร้าง WebSocket Server เพิ่มเติม
> 2. **ขอบเขตการทดสอบระยะแรก**: เชื่อมต่อและทดสอบเฉพาะ **ส่วนงานสลิต (Slit Film Management)** ซึ่งครอบคลุม:
>    - รายการรับเข้า (Inbound Records)
>    - รายการเบิกจ่าย / จ่ายออก (Outbound / Operator Receive Records)
>    - ประวัติการเคลื่อนย้ายและย้าย Layout (Movement & Relocation History)
>    - สต็อกคงคลังและพื้นที่จัดเก็บ (Stock Balance & Space Allocation)
> 3. **กลยุทธ์รักษาความปลอดภัยและระบบสำรอง (Zero Downtime / Offline Fallback)**:
>    - หากเกิดเหตุขัดข้องหรือไม่มีสัญญาณอินเทอร์เน็ต ระบบจะยังคงทำงานต่อได้ด้วย Local Persistence แคชของ Firestore ร่วมกับ LocalStorage เดิม ทำให้การทำงานในคลังสินค้าไม่หยุดชะงัก

---

## 1. Overview & Core Concept

- **เป้าหมาย**: ปรับเปลี่ยนจากการจัดเก็บข้อมูลชั่วคราวใน LocalStorage/Mock Data ไปสู่ Cloud Database จริงที่มีประสิทธิภาพสูง ปลอดภัย และซิงค์ข้อมูลทันทีระหว่างผู้ใช้งานหลายคน
- **ผู้ใช้งานและบริบทการใช้งาน**:
  - เจ้าหน้าที่หน้างาน (Forklift Operator / Material Handler): ใช้มือถือยิงบาร์โค้ดรับเข้า/จ่ายออก
  - เจ้าหน้าที่คลังและหัวหน้างาน (Warehouse Controller / Supervisor): เปิดคอมพิวเตอร์ดู Dashboard, Layout, และสต็อกคงคลังที่อัปเดตสดทันที
- **ปริมาณการใช้งาน**: ประมาณ 500 รายการ/วัน อยู่ในเกณฑ์ Free Tier ของ Firestore อย่างปลอดภัยตลอดอายุการใช้งาน

---

## 2. Technical Architecture & Real-Time Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        WMS Warehouse 1 Architecture                    │
└────────────────────────────────────────────────────────────────────────┘

  [ Mobile Device (Android/iOS) ]         [ Desktop PC (Control Room) ]
  • กล้องสแกนบาร์โค้ด Batch               • Dashboard ตรวจสอบสต็อก
  • รับเข้า / จ่ายออก หน้างาน              • บริหารจัดการผัง Layout / พื้นที่
              │                                      ▲
              │ (1) ยิงสแกน & บันทึก                    │ (3) onSnapshot Listener
              ▼                                      │     อัปเดตสดทันที (<100ms)
  ┌──────────────────────────────────────────────────┴───────────────────┐
  │                 Vercel Deployment (Vite + React SPA)                 │
  │  • src/services/firebase.ts (SDK Init & Configuration)               │
  │  • src/services/slitDataService.ts (CRUD & Real-time Subscriptions)  │
  └──────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │               Google Cloud Firebase Firestore (Spark Plan)           │
  │  ┌───────────────────────┐         ┌──────────────────────────────┐  │
  │  │ slit_inventory        │         │ slit_movements               │  │
  │  │ (สต็อกม้วนสลิตปัจจุบัน)   │         │ (ประวัติการย้ายและทำรายการ)       │  │
  │  └───────────────────────┘         └──────────────────────────────┘  │
  │  ┌───────────────────────┐         ┌──────────────────────────────┐  │
  │  │ slit_inbound_sessions │         │ slit_space_layout            │  │
  │  │ (รอบการสแกนรับเข้า)      │         │ (ตำแหน่งและพิกัด Bay คลัง 1)    │  │
  │  └───────────────────────┘         └──────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Strategy (Slit Film Module)

โครงสร้าง Collection สำหรับส่วนงานสลิตใน Firestore:

1. **`slit_inventory`** (ข้อมูลม้วนสลิตที่อยู่ในคลัง):
   - `id`: Document ID (สร้างจาก Batch Number เช่น `2603412001`)
   - `batch`: string (10 หลัก)
   - `coilNo`: string
   - `materialCode`: string
   - `spec`: string
   - `thick`: number
   - `width`: number
   - `weight`: number
   - `location`: string (เช่น `WH1-A01`, `HOLD-01`)
   - `status`: `'Available' | 'Reserved' | 'In-Transit' | 'Hold'`
   - `inboundAt`: timestamp
   - `updatedAt`: timestamp
   - `operator`: string

2. **`slit_movements`** (ประวัติการเคลื่อนไหว Inbound/Outbound/Relocate):
   - `id`: auto-generated UUID
   - `batch`: string
   - `action`: `'inbound' | 'outbound' | 'relocate' | 'return'`
   - `fromLocation`: string
   - `toLocation`: string
   - `weight`: number
   - `timestamp`: timestamp
   - `operator`: string
   - `remark`: string

3. **`slit_inbound_sessions`** (บันทึกรอบการสแกนรับเข้าจากเครื่องจักร):
   - `sessionId`: string
   - `machine`: string (เช่น `SM03`)
   - `totalItems`: number
   - `totalWeight`: number
   - `totalWidth`: number
   - `scannedBatches`: array of batch objects
   - `completedAt`: timestamp

---

## 4. Key Implementation Steps

1. **ขั้นตอนที่ 1: ติดตั้ง Firebase Client SDK**
   - ติดตั้ง `firebase` แพ็กเกจในโปรเจกต์
   - ตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables) สำหรับเชื่อมต่อ Firebase Config ผ่าน `.env` และระบบ Environment ของ Vercel

2. **ขั้นตอนที่ 2: สร้าง Service Layer (`slitDataService.ts`)**
   - ฟังก์ชันบันทึกข้อมูลรับเข้า (Create Inbound)
   - ฟังก์ชันบันทึกการเบิกจ่าย / คืนคลัง (Update/Issue Outbound)
   - ฟังก์ชัน Real-time Subscription (`subscribeToSlitInventory`, `subscribeToSlitMovements`) ที่คืนค่า Unsubscribe เมื่อ Component Unmount เพื่อประหยัด Connection

3. **ขั้นตอนที่ 3: เชื่อมต่อเข้ากับ `SlitFilmManagement.tsx`**
   - เชื่อมต่อ State เดิมเข้ากับ Firestore Listener
   - รองรับ Data Fallback อัตโนมัติ (หาก Offline จะดึง Local Cache และซิงค์ขึ้น Cloud เมื่อกลับมา Online)
   - ทดสอบการสแกนบาร์โค้ดผ่านมือถือ และตรวจเช็คผลการแสดงผลบนคอมพิวเตอร์แบบทันที (Instant Sync)

4. **ขั้นตอนที่ 4: การรักษาความปลอดภัย (Security Rules)**
   - กำหนดสิทธิ์การอ่าน/เขียนข้อมูลตามมาตรฐานความปลอดภัย และป้องกันข้อมูลเสียหาย

---

## 5. แผนการขยายผลสู่อีก 4 ส่วนงานในอนาคต

เมื่อทดสอบส่วนงานสลิตจนเสร็จสมบูรณ์และมั่นใจแล้ว สามารถนำ Service Pattern นี้ไปเชื่อมต่อกับอีก 4 ส่วนงานได้อย่างรวดเร็วและเป็นระบบ:
- ส่วนงานเหล็กแผ่น (RM Steel Sheet)
- ส่วนงานเหล็กม้วน (Steel Coil)
- ส่วนงานยานพาหนะและเครื่องจักร (Transport & Material Handling)
- ส่วนงานผู้ปฏิบัติงานและงานบริหาร (Admin Workforce)
