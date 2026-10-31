# แผนการเชื่อมต่อระบบ "เตรียมเบิก" (Outbound Preparation) เข้าสู่ Cloud Database แบบ Real-time [เสร็จสมบูรณ์ 100%]

แผนงานนี้จัดทำขึ้นและดำเนินการเสร็จสิ้นเรียบร้อยแล้ว ในการเชื่อมต่อฟังก์ชันงานส่วน **เตรียมเบิก (Outbound Prep & Pick Lists)** เข้ากับฐานข้อมูล **Firebase Firestore** ตามคำตอบและการตัดสินใจของผู้ใช้ โดยยึดถือกฎเหล็ก **ห้ามเปลี่ยนหรือแก้ไข Workflow และ Logic เดิมโดยเด็ดขาด (Zero Regression & Strict Flow Preservation)**

---

## 1. ผลการดำเนินงานตามขอบเขต (Implementation Completed)
- [x] **เชื่อมต่อการนำเข้าใบสั่งเบิก (Pick List Import)**: เมื่อเจ้าหน้าที่นำเข้าข้อมูลใบสั่งเบิก (Excel / TSV / BOM) ระบบจะบันทึกและซิงค์ขึ้น Cloud Firestore (`slit_picklists`) ทันทีทุกใบสั่ง
- [x] **เชื่อมต่อการสแกนตรวจสอบบาร์โค้ดหน้างาน (Outbound Scan Verification)**: เมื่อพนักงานยิงบาร์โค้ด 10 หลักผ่านแต่ละม้วน สถานะ `verified`, เวลาที่สแกน และจำนวนที่ตรวจสอบสำเร็จจะซิงค์ขึ้น Cloud แบบ Real-time ทันที
- [x] **เชื่อมต่อการบันทึกฉบับร่างและการยืนยันเตรียมเบิก (Save Draft & Confirm Prep)**: บันทึกสถานะ `in_progress` หรือ `completed` พร้อมบันทึกรายการจ่ายออกลงคอลเลกชัน `slit_outbound` และอัปเดตเลขอ้างอิงใบสั่งในสต็อก
- [x] **เชื่อมต่อการลบใบสั่งเบิก (Delete Order)**: ลบข้อมูลออกจาก Cloud เพื่อให้ทุกเครื่องแสดงผลตรงกัน
- [x] **ซิงค์ข้อมูลเดิมอัตโนมัติ (Seamless Migration)**: ตรวจสอบและซิงค์ใบสั่งเบิกที่มีอยู่ในเครื่องขึ้น Cloud ให้อัตโนมัติเมื่อเริ่มต้นระบบ

---

## 2. รายละเอียดการปรับปรุงโค้ดที่ทำเสร็จแล้ว (Executed Code Details)

### A. Service Layer (`src/services/slitDataService.ts`)
1. **เพิ่มฟังก์ชัน `batchSavePickListsToCloud(orders: PickListOrder[])`**:
   - รองรับการบันทึกและอัปเดตใบสั่งเบิกจำนวนมากพร้อมกันผ่าน Firestore `writeBatch` เมื่อนำเข้าใบสั่งเบิก
2. **เพิ่มฟังก์ชัน `deletePickListFromCloud(orderIdOrNo: string)`**:
   - ลบเอกสารใบสั่งเบิกออกจากคอลเลกชัน `slit_picklists` เมื่อผู้ใช้กดยืนยันการลบ
3. **ปรับปรุง `syncLocalDataToFirestoreIfEmpty`**:
   - เพิ่มการตรวจสอบและซิงค์รายการใบสั่งเบิกเดิมจาก LocalStorage ขึ้นสู่คอลเลกชัน `slit_picklists` อัตโนมัติหากบน Cloud ยังว่างอยู่

### B. คอมโพเนนต์หลัก (`src/components/SlitFilmManagement.tsx`)
1. **จุดนำเข้าใบสั่งเบิก (`handleSaveImportedPickList`)**:
   - ภายหลังจากการ Validate และคำนวณ `createdOrders` ตาม Logic เดิมครบถ้วน มีการเรียก `batchSavePickListsToCloud(createdOrders)` ทันที
2. **จุดสแกนตรวจสอบบาร์โค้ด (`processOutboundBarcodeScan`)**:
   - เมื่อบาร์โค้ดผ่านการตรวจสอบและจับคู่รายการใน Order สำเร็จ มีการเรียก `savePickListToCloud(updatedActiveOrder)` เพื่อซิงค์สถานะ Real-time ทันที
3. **จุดบันทึกฉบับร่าง (`handleSaveOutboundDraft`)**:
   - เมื่อกดบันทึกฉบับร่าง มีการเรียก `savePickListToCloud` สำหรับ Order นั้นด้วยสถานะ `in_progress`
4. **จุดยืนยันการเตรียมเบิก (`handleConfirmOutboundFinal`)**:
   - เรียก `savePickListToCloud` ด้วยสถานะ `completed`
   - เรียก `batchSaveInboundToCloud` เพื่อบันทึกการอ้างอิงใบสั่งเบิกและสถานะในสต็อกคลังสินค้า
5. **จุดลบใบสั่งเบิก (`handleConfirmDeleteOrder`)**:
   - เมื่อผู้ใช้ยืนยันลบใบสั่งเบิก มีการเรียก `deletePickListFromCloud(ordNo)`
6. **การรับข้อมูล Real-time (`subscribeToSlitPickLists`)**:
   - รักษากระบวนการ Merge ข้อมูลเพื่อไม่ให้รบกวนหน้าจอที่ผู้ใช้กำลังสแกนอยู่ และอัปเดตตัวเลขความคืบหน้าให้ตรงกันทุกเครื่อง

---

## 3. การปฏิบัติตามกฎเหล็กความปลอดภัย (Strict Rule Compliance)
- **Zero Code Regression**: ไม่ลบ ไม่เปลี่ยนชื่อตัวแปร CSS หรือฟังก์ชันเดิม
- **Preserve App Flow**: คงขั้นตอนการทำงานเดิม 100% (เลือกเครื่อง -> เลือกใบสั่งเบิก -> สแกนบาร์โค้ด -> บันทึก/ยืนยัน)
- **No Mock/Dummy Data**: ใช้ข้อมูลจริงที่ผู้ใช้นำเข้าหรือสแกนผ่านระบบเท่านั้น
- **Clean Production UI**: ไม่เพิ่มปุ่มซ้ำซ้อน ไม่ใส่ข้อความส่วนเกิน ใช้ฟอนต์ **Noto Sans Thai** เป็นหลัก

---

## 4. ผลการตรวจสอบความถูกต้อง (Verification Results)
- [x] **TypeScript Validation (`lint_applet`)**: ผ่านสมบูรณ์ 0 errors
- [x] **Build Compilation (`compile_applet`)**: ผ่านสมบูรณ์ (Build succeeded - the applet is compiled)
