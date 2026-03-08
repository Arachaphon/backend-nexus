import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const repairs = new Hono<{ Bindings: { DB: D1Database } }>()

repairs.use('/*', authMiddleware)

/* GET repairs — /api/dormitories/repairs/:dormitoryId?status=pending|completed */
repairs.get('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const status = c.req.query('status')

    if (status && !['pending', 'completed'].includes(status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400)
    }

    let query = `
      SELECT
        rr.id, rr.room_id, rr.report_date, rr.appoint_date,
        rr.details, rr.status, rr.complete_date, rr.cost,
        rr.complete_details, rr.created_at,
        r.room_number, f.floor_number
      FROM repair_requests rr
      JOIN rooms r ON rr.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE f.dormitories_id = ?
    `
    const bindings: any[] = [dormitoryId]

    if (status) {
      query += ` AND rr.status = ?`
      bindings.push(status)
    }

    query += ` ORDER BY rr.created_at DESC`

    const { results } = await db.prepare(query).bind(...bindings).all()
    return c.json({ success: true, data: results })
  }
)

/* POST — สร้างรายการซ่อม */
repairs.post('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const body = await c.req.json()
    const { room_id, report_date, appoint_date, details } = body

    if (!room_id || !report_date || !appoint_date || !details) {
      return c.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }
    if (details.length > 70) {
      return c.json({ success: false, error: 'รายละเอียดต้องไม่เกิน 70 ตัวอักษร' }, 400)
    }

    // ตรวจสอบว่าห้องนี้อยู่ในหอพักนี้จริง
    const room = await db.prepare(`
      SELECT r.id FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE r.id = ? AND f.dormitories_id = ?
    `).bind(room_id, dormitoryId).first()

    if (!room) return c.json({ success: false, error: 'ไม่พบห้องที่ระบุ' }, 404)

    const id = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO repair_requests (id, room_id, report_date, appoint_date, details, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).bind(id, room_id, report_date, appoint_date, details).run()

    const record = await db.prepare(`SELECT * FROM repair_requests WHERE id = ?`).bind(id).first()
    return c.json({ success: true, data: record }, 201)
  }
)

/* PATCH /:dormitoryId/:repairId — แก้ไขรายการ (pending เท่านั้น) */
repairs.patch('/:dormitoryId/:repairId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const repairId = c.req.param('repairId')
    const body = await c.req.json()
    const { room_id, report_date, appoint_date, details } = body

    if (!room_id || !report_date || !appoint_date || !details) {
      return c.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }
    if (details.length > 70) {
      return c.json({ success: false, error: 'รายละเอียดต้องไม่เกิน 70 ตัวอักษร' }, 400)
    }

    const existing = await db.prepare(`
      SELECT rr.id, rr.status FROM repair_requests rr
      JOIN rooms r ON rr.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE rr.id = ? AND f.dormitories_id = ?
    `).bind(repairId, dormitoryId).first<{ id: string; status: string }>()

    if (!existing) return c.json({ success: false, error: 'ไม่พบรายการซ่อม' }, 404)
    if (existing.status !== 'pending') return c.json({ success: false, error: 'ไม่สามารถแก้ไขรายการที่เสร็จแล้ว' }, 400)

    await db.prepare(`
      UPDATE repair_requests SET room_id=?, report_date=?, appoint_date=?, details=? WHERE id=?
    `).bind(room_id, report_date, appoint_date, details, repairId).run()

    const updated = await db.prepare(`SELECT * FROM repair_requests WHERE id=?`).bind(repairId).first()
    return c.json({ success: true, data: updated })
  }
)

/* PATCH /:dormitoryId/:repairId/complete — บันทึกการเข้าซ่อม */
repairs.patch('/:dormitoryId/:repairId/complete',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const repairId = c.req.param('repairId')
    const body = await c.req.json()
    const { complete_date, cost, complete_details } = body

    if (!complete_date || cost == null || !complete_details) {
      return c.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }
    if (complete_details.length > 70) {
      return c.json({ success: false, error: 'รายละเอียดต้องไม่เกิน 70 ตัวอักษร' }, 400)
    }

    const existing = await db.prepare(`
      SELECT rr.id, rr.status FROM repair_requests rr
      JOIN rooms r ON rr.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE rr.id = ? AND f.dormitories_id = ?
    `).bind(repairId, dormitoryId).first<{ id: string; status: string }>()

    if (!existing) return c.json({ success: false, error: 'ไม่พบรายการซ่อม' }, 404)
    if (existing.status !== 'pending') return c.json({ success: false, error: 'รายการนี้เสร็จสิ้นแล้ว' }, 400)

    await db.prepare(`
      UPDATE repair_requests
      SET status='completed', complete_date=?, cost=?, complete_details=?
      WHERE id=?
    `).bind(complete_date, Number(cost), complete_details, repairId).run()

    const updated = await db.prepare(`SELECT * FROM repair_requests WHERE id=?`).bind(repairId).first()
    return c.json({ success: true, data: updated })
  }
)

export default repairs
