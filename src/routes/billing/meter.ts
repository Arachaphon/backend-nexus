import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const meters = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

meters.use('/*', authMiddleware)

meters.get('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    const rows = await db.prepare(`
      SELECT
        mr.id,
        mr.reading_date,
        mr.room_id,
        mr.contract_id,
        mr.water_unit_current,
        mr.electric_unit_current,
        mr.water_unit_previous,
        mr.electric_unit_previous,
        r.room_number,
        f.floor_number
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
      SELECT
        mr.id,
        mr.reading_date,
        mr.room_id,
        mr.contract_id,
        mr.water_unit_current,
        mr.electric_unit_current,
        mr.water_unit_previous,
        mr.electric_unit_previous,
        r.room_number,
        f.floor_number
      FROM meter_readings mr
      JOIN rooms r ON r.id = mr.room_id
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ? AND mr.reading_date = ?
      ORDER BY f.floor_number ASC, r.room_number ASC
    `).bind(dormitoryId, readingDate).all()

    return c.json({ success: true, data: rows.results || [] })
  }
)

meters.get('/:dormitoryId/contracts/:contractId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')

    const record = await db.prepare(`
      SELECT * FROM meter_readings
      WHERE contract_id = ?
      ORDER BY reading_date DESC
      LIMIT 1
    `).bind(contractId).first()

    if (!record) {
      return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)
    }

    return c.json({ success: true, data: record })
  }
)

meters.post('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const body = await c.req.json()

    const {
      room_id,
      contract_id,
      reading_date,
      water_unit_current,
      electric_unit_current,
    } = body

    if (!room_id || !contract_id || !reading_date || water_unit_current == null || electric_unit_current == null) {
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0) {
      return c.json({ error: 'เลขมิเตอร์ต้องไม่ติดลบ' }, 400)
    }

    const room = await db.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(room_id).first()
    if (!room) return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)

    const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`).bind(contract_id).first()
    if (!contract) return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)

    const prev = await db.prepare(`
      SELECT water_unit_current, electric_unit_current
      FROM meter_readings
      WHERE contract_id = ?
      ORDER BY reading_date DESC
      LIMIT 1
    `).bind(contract_id).first<{ water_unit_current: number; electric_unit_current: number }>()

    const id = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO meter_readings (
        id, room_id, contract_id, reading_date,
        water_unit_current, electric_unit_current,
        water_unit_previous, electric_unit_previous
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      room_id,
      contract_id,
      reading_date,
      Number(water_unit_current),
      Number(electric_unit_current),
      prev ? prev.water_unit_current : null,
      prev ? prev.electric_unit_current : null
    ).run()

    const record = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(id).first()
    return c.json({ success: true, data: record }, 201)
  }
)

meters.post('/:dormitoryId/bulk',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const body = await c.req.json()

    const { reading_date, readings } = body

    if (!reading_date) {
      return c.json({ error: 'กรุณาระบุวันที่จดมิเตอร์' }, 400)
    }
    if (!Array.isArray(readings) || readings.length === 0) {
      return c.json({ error: 'กรุณาระบุข้อมูลมิเตอร์อย่างน้อย 1 ห้อง' }, 400)
    }

    const inserted: string[] = []
    for (const item of readings) {
      const { room_id, contract_id, water_unit_current, electric_unit_current } = item

      if (!room_id || !contract_id || water_unit_current == null || electric_unit_current == null) continue
      if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0) continue

      const prev = await db.prepare(`
        SELECT water_unit_current, electric_unit_current
        FROM meter_readings
        WHERE contract_id = ?
        ORDER BY reading_date DESC LIMIT 1
      `).bind(contract_id).first<{ water_unit_current: number; electric_unit_current: number }>()

      const id = crypto.randomUUID()
      await db.prepare(`
        INSERT INTO meter_readings (
          id, room_id, contract_id, reading_date,
          water_unit_current, electric_unit_current,
          water_unit_previous, electric_unit_previous
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, room_id, contract_id, reading_date,
        Number(water_unit_current), Number(electric_unit_current),
        prev ? prev.water_unit_current : null,
        prev ? prev.electric_unit_current : null
      ).run()
      inserted.push(id)
    }

    return c.json({ success: true, inserted_count: inserted.length }, 201)
  }
)

meters.patch('/:dormitoryId/contracts/:contractId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')
    const body = await c.req.json()
    const { water_unit_current, electric_unit_current } = body

    if (water_unit_current == null || electric_unit_current == null) {
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    const record = await db.prepare(
      `SELECT id FROM meter_readings WHERE contract_id = ? ORDER BY reading_date DESC LIMIT 1`
    ).bind(contractId).first<{ id: string }>()

    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET water_unit_current = ?, electric_unit_current = ? WHERE id = ?`
    ).bind(Number(water_unit_current), Number(electric_unit_current), record.id).run()

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(record.id).first()
    return c.json({ success: true, data: updated })
  }
)

meters.patch('/:dormitoryId/:meterId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const body = await c.req.json()
    const { water_unit_current, electric_unit_current } = body

    if (water_unit_current == null || electric_unit_current == null) {
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    const record = await db.prepare(`SELECT id FROM meter_readings WHERE id = ?`).bind(meterId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(
      `UPDATE meter_readings SET water_unit_current = ?, electric_unit_current = ? WHERE id = ?`
    ).bind(Number(water_unit_current), Number(electric_unit_current), meterId).run()

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(meterId).first()
    return c.json({ success: true, data: updated })
  }
)

meters.delete('/:dormitoryId/:meterId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')

    const record = await db.prepare(`SELECT id FROM meter_readings WHERE id = ?`).bind(meterId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(`DELETE FROM meter_readings WHERE id = ?`).bind(meterId).run()
    return c.json({ success: true, message: 'ลบข้อมูลมิเตอร์สำเร็จ' })
  }
)

export default meters