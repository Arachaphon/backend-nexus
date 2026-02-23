import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../utils/authMiddleware'

const utilities = new Hono<{ Bindings: { DB: D1Database } }>()

utilities.use('/*', authMiddleware)

utilities.post('/save-settings', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const { dormitoryId, water, electric } = body;

        // 1. ตรวจสอบว่ามี dormitoryId ส่งมาหรือไม่
        if (!dormitoryId) {
            return c.json({ success: false, message: "Missing dormitoryId" }, 400);
        }

        // 2. ฟังก์ชันช่วยจัดการแปลงตัวเลข ป้องกัน NaN
        const parseNum = (val: any) => {
            const num = Number(val);
            return isNaN(num) ? null : num;
        };

        // เตรียมข้อมูล Water
        const waterData = {
            id: crypto.randomUUID(),
            dormId: dormitoryId,
            type: water.type,
            price: (water.type !== 'flat_rate') ? parseNum(water.price) : null,
            min: (water.type === 'meter_min') ? parseNum(water.min) : null,
            flat: (water.type === 'flat_rate') ? parseNum(water.price) : null
        };

        // เตรียมข้อมูล Electric
        const electricData = {
            id: crypto.randomUUID(),
            dormId: dormitoryId,
            type: electric.type,
            price: (electric.type !== 'flat_rate') ? parseNum(electric.price) : null,
            min: (electric.type === 'meter_min') ? parseNum(electric.min) : null,
            flat: (electric.type === 'flat_rate') ? parseNum(electric.price) : null
        };

        // 3. ใช้ ON CONFLICT โดยต้องมั่นใจว่ารัน schema01.sql แล้ว
        const waterStmt = db.prepare(`
            INSERT INTO water_rate_templates (id, dormitories_id, charge_type, price_per_unit, minimum_charge, flat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dormitories_id) DO UPDATE SET
                charge_type = EXCLUDED.charge_type,
                price_per_unit = EXCLUDED.price_per_unit,
                minimum_charge = EXCLUDED.minimum_charge,
                flat_rate = EXCLUDED.flat_rate
        `).bind(
            waterData.id, waterData.dormId, waterData.type, 
            waterData.price, waterData.min, waterData.flat
        );

        const electricStmt = db.prepare(`
            INSERT INTO electric_rate_templates (id, dormitories_id, charge_type, price_per_unit, minimum_charge, flat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dormitories_id) DO UPDATE SET
                charge_type = EXCLUDED.charge_type,
                price_per_unit = EXCLUDED.price_per_unit,
                minimum_charge = EXCLUDED.minimum_charge,
                flat_rate = EXCLUDED.flat_rate
        `).bind(
            electricData.id, electricData.dormId, electricData.type, 
            electricData.price, electricData.min, electricData.flat
        );

        // รันแบบ Batch
        await db.batch([waterStmt, electricStmt]);
        
        return c.json({ success: true }, 200);

    } catch (err: any) {
        console.error("Database Error:", err.message);
        return c.json({ 
            success: false, 
            message: "Backend Error: " + err.message,
            stack: err.stack 
        }, 500);
    }
});

export default utilities;