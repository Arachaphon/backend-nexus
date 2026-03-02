import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'

const tenants = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

tenants.use('/*', authMiddleware)

// GET tenants by dormitory_id
tenants.get(
  '/dormitories/:dormitoryId',
  requireDormitoryAccess,
  async (c) => {
    try {
        const db = c.env.DB
        const dormitoryId = c.req.param('dormitoryId')
        const result = await db.prepare(`
        SELECT DISTINCT
            t.*,
            r.id as room_id

        FROM tenants t
        JOIN contract_tenants ct ON t.id = ct.tenant_id
        JOIN contracts con ON con.id = ct.contract_id
        JOIN rooms r ON r.id = con.room_id
        JOIN floors f ON r.floor_id = f.id

        WHERE f.dormitories_id = ?
        `)
        .bind(dormitoryId)
        .all()

        return c.json({
            success: true,
            data: result.results
        })

    } catch (err) {
      console.error("GET TENANTS BY DORM ERROR:", err)
      return c.json({ error: 'server error' }, 500)
    }
  }
)

// GET tenants by room_id
tenants.get(
  '/dormitories/:dormitoryId/rooms/:roomId',
  requireDormitoryAccess,
  async (c) => {
    const db = c.env.DB
    const roomId = c.req.param('roomId')

    const result = await db.prepare(`
      SELECT 
        t.*,
        ct.contract_id,
        ct.is_primary
      FROM contracts con
      JOIN contract_tenants ct ON con.id = ct.contract_id
      JOIN tenants t ON t.id = ct.tenant_id
      WHERE con.room_id = ?
      ORDER BY ct.is_primary DESC
    `)
    .bind(roomId)
    .all()

    const tenants = result.results

    if (!tenants.length) {
      return c.json({ success: true, data: [] })
    }

    return c.json({
      success: true,
      data: tenants
    })
  }
)

// POST /api/rental/tenants
// สร้างผู้เช่าใหม่
tenants.post('/',
    requireDormitoryAccess, 
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