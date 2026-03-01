import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'

const meters = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

meters.use('/*', authMiddleware)

// GET /api/rental/meters/contract/:contractId

meters.get('/contract/:contractId',
    requireDormitoryAccess,
    async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')

    const record = await db.prepare(`
        SELECT * FROM meter_readings
        WHERE contract_id = ? AND reading_type = 'check_in'
    `).bind(contractId).first()

    if (!record) {
        return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)
    }

    return c.json({ success: true, data: record })
})

meters.post('/', async (c) => {
    const db = c.env.DB
    const body = await c.req.json()

    const {
        room_id,
        contract_id,
        reading_date,
        water_unit_current,
        electric_unit_current,
    } = body

    // --- Validate ---
    if (!room_id || !contract_id || !reading_date || water_unit_current == null || electric_unit_current == null) {
        return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0) {
        return c.json({ error: 'เลขมิเตอร์ต้องไม่ติดลบ' }, 400)
    }

    // --- ตรวจสอบว่า room และ contract มีอยู่จริง ---
    const room = await db.prepare(`SELECT id FROM rooms WHERE id = ?`)
        .bind(room_id).first()
    if (!room) {
        return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)
    }

    const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`)
        .bind(contract_id).first()
    if (!contract) {
        return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }

    // --- ป้องกัน check_in ซ้ำ ---
    const existing = await db.prepare(`
        SELECT id FROM meter_readings
        WHERE contract_id = ? AND reading_type = 'check_in'
    `).bind(contract_id).first()

    if (existing) {
        return c.json({ error: 'บันทึกเลขมิเตอร์วันเข้าพักสำหรับสัญญานี้ไปแล้ว' }, 409)
    }

    // --- INSERT meter_readings ---
    const id = crypto.randomUUID()
    const formattedDate = new Date(reading_date).toISOString().split('T')[0]

    await db.prepare(`
        INSERT INTO meter_readings (
            id, 
            room_id, 
            contract_id,
            reading_type, 
            reading_date,
            water_unit_current, electric_unit_current,
            water_unit_previous, electric_unit_previous
        ) VALUES (?, ?, ?, 'check_in', ?, ?, ?, NULL, NULL)
    `)
    .bind(
        id,
        room_id,
        contract_id,
        formattedDate,
        Number(water_unit_current),
        Number(electric_unit_current)
    ).run()

    const record = await db.prepare(`
        SELECT * FROM meter_readings WHERE id = ?
    `).bind(id).first()

    return c.json({ success: true, data: record }, 201)
})

export default meters