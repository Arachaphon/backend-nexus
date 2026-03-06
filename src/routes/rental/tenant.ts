import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const tenants = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

tenants.use('/*', authMiddleware)

// GET tenants by dormitory_id
tenants.get(
  '/dormitories/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']), 
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
  requireRole(['owner', 'manager']), 
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
tenants.post('/dormitories/:dormitoryId',
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

tenants.post(
  '/dormitories/:dormitoryId/:contractId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const user = c.get('jwtPayload')
    const contractId = c.req.param('contractId')

    const contract = await db.prepare(`
      SELECT c.id, f.dormitories_id
      FROM contracts c
      JOIN rooms r ON r.id = c.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE c.id = ?
    `).bind(contractId).first()

    if (!contract) {
      return c.json({ error: 'ไม่พบสัญญา' }, 404)
    }

    const staff = await db.prepare(`
      SELECT role FROM dormitory_users
      WHERE dormitory_id = ? AND user_id = ?
    `).bind(contract.dormitories_id, user.userId).first()

    if (!staff) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const body = await c.req.json()
    const { tenant_id, is_primary = 0 } = body

    if (!tenant_id) {
      return c.json({ error: 'กรุณาระบุ tenant_id' }, 400)
    }

    const tenant = await db.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(tenant_id).first()
    if (!tenant) {
      return c.json({ error: 'ไม่พบข้อมูลผู้เช่า' }, 404)
    }

    const existing = await db.prepare(`
      SELECT id FROM contract_tenants
      WHERE contract_id = ? AND tenant_id = ?
    `).bind(contractId, tenant_id).first()

    if (existing) {
      return c.json({ error: 'ผู้เช่านี้อยู่ในสัญญานี้แล้ว' }, 409)
    }

    if (is_primary === 1) {
      await db.prepare(`
        UPDATE contract_tenants SET is_primary = 0
        WHERE contract_id = ?
      `).bind(contractId).run()
    }

    const id = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO contract_tenants (id, contract_id, tenant_id, is_primary)
      VALUES (?, ?, ?, ?)
    `).bind(id, contractId, tenant_id, is_primary).run()

    return c.json({ success: true, data: { id, contract_id: contractId, tenant_id, is_primary } }, 201)
  }
)

export default tenants