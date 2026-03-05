import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const tenants = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

tenants.use('/*', authMiddleware)

// GET /api/rental/tenants/:id
// ดึงข้อมูลผู้เช่า
tenants.get('/:id',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),  
    async (c) => {
    const db = c.env.DB
    const id = c.req.param('id')

    const tenant = await db.prepare(`SELECT * FROM tenants WHERE id = ?`).bind(id).first()

    if (!tenant) {
        return c.json({ error: 'ไม่พบข้อมูลผู้เช่า' }, 404)
    }

    return c.json({ success: true, data: tenant })
})

// POST /api/rental/tenants
// สร้างผู้เช่าใหม่
tenants.post('/',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),  
    async (c) => {
    const db = c.env.DB
    const body = await c.req.json()

    const {
        first_name,
        last_name,
        phone_number,
        id_card_or_passport,
        address,
        emergency_contact_name,
        emergency_contact_relation,
        emergency_contact_phone,
        note,
    } = body

    // Validate required fields
    if (!first_name || !last_name || !phone_number || !id_card_or_passport) {
        return c.json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' }, 400)
    }

    const id = crypto.randomUUID()

    await db.prepare(`
        INSERT INTO tenants (
            id,
            first_name, last_name,
            phone_number, id_card_or_passport,
            address,
            emergency_contact_name,
            emergency_contact_relation,
            emergency_contact_phone,
            note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id,
        first_name, last_name,
        phone_number, id_card_or_passport,
        address ?? null,
        emergency_contact_name ?? null,
        emergency_contact_relation ?? null,
        emergency_contact_phone ?? null,
        note ?? null
    ).run()

    const tenant = await db.prepare(`SELECT * FROM tenants WHERE id = ?`).bind(id).first()

    return c.json({ success: true, data: tenant }, 201)
})

export default tenants