import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const meters = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

meters.use('/*', authMiddleware)

async function propagatePrevious(db: D1Database, room_id: string) {
  const { results } = await db.prepare(`
    SELECT id, water_unit_current, electric_unit_current
    FROM meter_readings
    WHERE room_id = ?
    ORDER BY DATE(reading_date) ASC, created_at ASC
  `).bind(room_id).all() as { results: { id: string; water_unit_current: number; electric_unit_current: number }[] }

  for (let i = 0; i < results.length; i++) {
    const prev = i === 0 ? null : results[i - 1]
    await db.prepare(`
      UPDATE meter_readings
      SET water_unit_previous = ?, electric_unit_previous = ?
      WHERE id = ?
    `).bind(
      prev?.water_unit_current ?? 0,
      prev?.electric_unit_current ?? 0,
      results[i].id
    ).run()
  }
}

meters.get('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const rows = await db.prepare(`
      SELECT mr.id, mr.reading_date, mr.room_id, mr.contract_id,
        mr.water_unit_current, mr.electric_unit_current,
        mr.water_unit_previous, mr.electric_unit_previous,
        r.room_number, f.floor_number
      FROM meter_readings mr
      JOIN rooms r ON r.id = mr.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ?
      ORDER BY mr.reading_date DESC
    `).bind(dormitoryId).all()
    return c.json({ success: true, data: rows.results || [] })
  }
)

meters.get('/:dormitoryId/dates',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const rows = await db.prepare(`
      SELECT DISTINCT mr.reading_date
      FROM meter_readings mr
      JOIN rooms r ON r.id = mr.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ?
      ORDER BY mr.reading_date DESC
    `).bind(dormitoryId).all()
    return c.json({ success: true, data: rows.results || [] })
  }
)

meters.get('/:dormitoryId/date/:readingDate',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const readingDate = c.req.param('readingDate')
    const rows = await db.prepare(`
      SELECT mr.id, mr.reading_date, mr.room_id, mr.contract_id,
        mr.water_unit_current, mr.electric_unit_current,
        mr.water_unit_previous, mr.electric_unit_previous,
        r.room_number, f.floor_number
      FROM meter_readings mr
      JOIN rooms r ON r.id = mr.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ? AND mr.reading_date = ?
      ORDER BY f.floor_number ASC, r.room_number ASC
    `).bind(dormitoryId, readingDate).all()
    return c.json({ success: true, data: rows.results || [] })
  }
)

meters.get('/:dormitoryId/rooms-with-prev',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const readingDate = c.req.query('date')
    if (!readingDate) return c.json({ error: 'กรุณาระบุ ?date=YYYY-MM-DD' }, 400)

    const roomRows = await db.prepare(`
      SELECT r.id AS room_id, r.room_number, r.status, f.floor_number
      FROM rooms r
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ?
      ORDER BY f.floor_number ASC, r.room_number ASC
    `).bind(dormitoryId).all()

    const rooms: any[] = roomRows.results || []
    const result = await Promise.all(rooms.map(async (room) => {
      const contract = await db.prepare(`
        SELECT id FROM contracts WHERE room_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(room.room_id).first<{ id: string }>()

      const prev = await db.prepare(`
        SELECT water_unit_current, electric_unit_current, reading_date
        FROM meter_readings
        WHERE room_id = ? AND DATE(reading_date) < DATE(?)
        ORDER BY DATE(reading_date) DESC LIMIT 1
      `).bind(room.room_id, readingDate).first<{
        water_unit_current: number; electric_unit_current: number; reading_date: string
      }>()

      const today = await db.prepare(`
        SELECT id, water_unit_current, electric_unit_current
        FROM meter_readings
        WHERE room_id = ? AND DATE(reading_date) = DATE(?) LIMIT 1
      `).bind(room.room_id, readingDate).first<{
        id: string; water_unit_current: number; electric_unit_current: number
      }>()

      return {
        room_id: room.room_id,
        room_number: room.room_number,
        floor_number: room.floor_number,
        status: room.status,
        contract_id: contract?.id ?? null,
        water_prev: prev?.water_unit_current ?? null,
        electric_prev: prev?.electric_unit_current ?? null,
        prev_date: prev?.reading_date ?? null,
        meter_id: today?.id ?? null,
        water_current: today?.water_unit_current ?? null,
        electric_current: today?.electric_unit_current ?? null,
      }
    }))
    return c.json({ success: true, data: result })
  }
)

meters.get('/:dormitoryId/contracts/:contractId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')
    const record = await db.prepare(`
      SELECT * FROM meter_readings WHERE contract_id = ?
      ORDER BY reading_date DESC LIMIT 1
    `).bind(contractId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)
    return c.json({ success: true, data: record })
  }
)

meters.post('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const body = await c.req.json()
    const { room_id, contract_id, reading_date, water_unit_current, electric_unit_current } = body

    if (!room_id || !reading_date || water_unit_current == null || electric_unit_current == null)
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ (room_id, reading_date, water, electric)' }, 400)

    if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0)
      return c.json({ error: 'เลขมิเตอร์ต้องไม่ติดลบ' }, 400)

    const room = await db.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(room_id).first()
    if (!room) return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)

    if (contract_id) {
      const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`).bind(contract_id).first()
      if (!contract) return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }

    const id = crypto.randomUUID()

    await db.prepare(`
      INSERT INTO meter_readings (
        id, room_id, contract_id, reading_date,
        water_unit_current, electric_unit_current,
        water_unit_previous, electric_unit_previous
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `).bind(
      id,
      room_id,
      contract_id ?? null,
      reading_date,
      Number(water_unit_current),
      Number(electric_unit_current)
    ).run()

    await propagatePrevious(db, room_id)

    const record = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(id).first()

    return c.json({ success: true, data: record }, 201)
  }
)

meters.post('/:dormitoryId/init',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const body = await c.req.json()
    const { room_id, contract_id, reading_date, water_unit_current, electric_unit_current } = body

    if (!room_id || !reading_date || water_unit_current == null || electric_unit_current == null)
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)

    if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0)
      return c.json({ error: 'เลขมิเตอร์ต้องไม่ติดลบ' }, 400)

    const room = await db.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(room_id).first()
    if (!room) return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)

    if (contract_id) {
      const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`).bind(contract_id).first()
      if (!contract) return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }
    if (contract_id) {
      const existing = await db.prepare(
        `SELECT id FROM meter_readings WHERE contract_id = ? LIMIT 1`
      ).bind(contract_id).first()
      if (existing) return c.json({ error: 'มีการบันทึกมิเตอร์สำหรับสัญญานี้แล้ว' }, 409)
    }

    const id = crypto.randomUUID()

    await db.prepare(`
      INSERT INTO meter_readings (
        id, room_id, contract_id, reading_date,
        water_unit_current, electric_unit_current,
        water_unit_previous, electric_unit_previous
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `).bind(
      id,
      room_id,
      contract_id ?? null,
      reading_date,
      Number(water_unit_current),
      Number(electric_unit_current)
    ).run()

    const record = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(id).first()
    return c.json({ success: true, data: record }, 201)
  }
)

meters.patch('/:dormitoryId/contracts/:contractId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')
    const { water_unit_current, electric_unit_current } = await c.req.json()

    if (water_unit_current == null || electric_unit_current == null)
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)

    const record = await db.prepare(
      `SELECT id, room_id FROM meter_readings WHERE contract_id = ? ORDER BY reading_date DESC LIMIT 1`
    ).bind(contractId).first<{ id: string; room_id: string }>()

    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET water_unit_current = ?, electric_unit_current = ? WHERE id = ?`
    ).bind(Number(water_unit_current), Number(electric_unit_current), record.id).run()

    await propagatePrevious(db, record.room_id)

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(record.id).first()

    return c.json({ success: true, data: updated })
  }
)

meters.patch('/:dormitoryId/reading/:meterId/water',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { water_unit_current } = await c.req.json()

    if (water_unit_current == null)
      return c.json({ error: 'กรุณากรอก water_unit_current' }, 400)

    const record = await db.prepare(
      `SELECT id, room_id FROM meter_readings WHERE id = ?`
    ).bind(meterId).first<{ id: string; room_id: string }>()

    if (!record)
      return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET water_unit_current = ? WHERE id = ?`
    ).bind(Number(water_unit_current), meterId).run()

    await propagatePrevious(db, record.room_id)

    const updated = await db.prepare(
      `SELECT * FROM meter_readings WHERE id = ?`
    ).bind(meterId).first()

    return c.json({ success: true, data: updated })
  }
)

meters.patch('/:dormitoryId/reading/:meterId/electric',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { electric_unit_current } = await c.req.json()

    if (electric_unit_current == null)
      return c.json({ error: 'กรุณากรอก electric_unit_current' }, 400)

    const record = await db.prepare(
      `SELECT id, room_id FROM meter_readings WHERE id = ?`
    ).bind(meterId).first<{ id: string; room_id: string }>()

    if (!record)
      return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET electric_unit_current = ? WHERE id = ?`
    ).bind(Number(electric_unit_current), meterId).run()

    await propagatePrevious(db, record.room_id)

    const updated = await db.prepare(
      `SELECT * FROM meter_readings WHERE id = ?`
    ).bind(meterId).first()

    return c.json({ success: true, data: updated })
  }
)

meters.patch('/:dormitoryId/reading/:meterId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { water_unit_current, electric_unit_current } = await c.req.json()

    if (water_unit_current == null || electric_unit_current == null)
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)

    const record = await db.prepare(
      `SELECT id, room_id FROM meter_readings WHERE id = ?`
    ).bind(meterId).first<{ id: string; room_id: string }>()

    if (!record)
      return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET water_unit_current = ?, electric_unit_current = ? WHERE id = ?`
    ).bind(Number(water_unit_current), Number(electric_unit_current), meterId).run()

    await propagatePrevious(db, record.room_id)

    const updated = await db.prepare(
      `SELECT * FROM meter_readings WHERE id = ?`
    ).bind(meterId).first()

    return c.json({ success: true, data: updated })
  }
)

meters.delete('/:dormitoryId/reading/:meterId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')

    const record = await db.prepare(
      `SELECT id, room_id FROM meter_readings WHERE id = ?`
    ).bind(meterId).first<{ id: string; room_id: string }>()

    if (!record)
      return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `DELETE FROM meter_readings WHERE id = ?`
    ).bind(meterId).run()

    await propagatePrevious(db, record.room_id)

    return c.json({ success: true, message: 'ลบข้อมูลมิเตอร์สำเร็จ' })
  }
)

export default meters