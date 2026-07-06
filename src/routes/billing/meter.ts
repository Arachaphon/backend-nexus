import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const meters = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

meters.use('/*', authMiddleware)

// GET /api/meters/:dormitoryId
meters.get('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    const rows = await db.prepare(`
      SELECT
        mr.id, mr.reading_date, mr.room_id, mr.contract_id,
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

// GET /api/meters/:dormitoryId/dates
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

// GET /api/meters/:dormitoryId/date/:readingDate
meters.get('/:dormitoryId/date/:readingDate',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const readingDate = c.req.param('readingDate')

    const rows = await db.prepare(`
      SELECT
        mr.id, mr.reading_date, mr.room_id, mr.contract_id,
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

// GET /api/meters/:dormitoryId/rooms-with-prev?date=YYYY-MM-DD
// ดึงห้องทุกห้องพร้อม:
//   - prev  = มิเตอร์ครั้งล่าสุด "ก่อน" วันที่ date (จาก room_id)
//   - today = มิเตอร์วันที่ date ถ้ามี (null ถ้ายังไม่ได้จด)
//   - contract_id ล่าสุดของห้อง
meters.get('/:dormitoryId/rooms-with-prev',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const readingDate = c.req.query('date')

    if (!readingDate) {
      return c.json({ error: 'กรุณาระบุ ?date=YYYY-MM-DD' }, 400)
    }

    // ห้องทั้งหมดในหอพัก
    const roomRows = await db.prepare(`
      SELECT r.id AS room_id, r.room_number, r.status, f.floor_number
      FROM rooms r
      JOIN floors f ON f.id = r.floor_id
      WHERE f.dormitories_id = ?
      ORDER BY f.floor_number ASC, r.room_number ASC
    `).bind(dormitoryId).all()

    const rooms: any[] = roomRows.results || []

    const result = await Promise.all(rooms.map(async (room) => {
      // contract ล่าสุดของห้อง (ไม่กรอง check_out_date)
      const contract = await db.prepare(`
        SELECT id FROM contracts
        WHERE room_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(room.room_id).first<{ id: string }>()

      // prev = มิเตอร์ครั้งล่าสุดก่อน date นี้ (by room_id) — ใช้ DATE() เพื่อให้ compare ถูกต้องใน SQLite
      const prev = await db.prepare(`
        SELECT water_unit_current, electric_unit_current, reading_date
        FROM meter_readings
        WHERE room_id = ? AND DATE(reading_date) < DATE(?)
        ORDER BY DATE(reading_date) DESC
        LIMIT 1
      `).bind(room.room_id, readingDate).first<{
        water_unit_current: number
        electric_unit_current: number
        reading_date: string
      }>()

      // today = มิเตอร์วันที่ date (ถ้ามี)
      const today = await db.prepare(`
        SELECT id, water_unit_current, electric_unit_current
        FROM meter_readings
        WHERE room_id = ? AND DATE(reading_date) = DATE(?)
        LIMIT 1
      `).bind(room.room_id, readingDate).first<{
        id: string
        water_unit_current: number
        electric_unit_current: number
      }>()

      return {
        room_id:              room.room_id,
        room_number:          room.room_number,
        floor_number:         room.floor_number,
        status:               room.status,
        contract_id:          contract?.id             ?? null,
        // prev (ครั้งก่อน)
        water_prev:           prev?.water_unit_current    ?? null,
        electric_prev:        prev?.electric_unit_current ?? null,
        prev_date:            prev?.reading_date          ?? null,
        // today (วันที่จด — null = ยังไม่ได้จด)
        meter_id:             today?.id                   ?? null,
        water_current:        today?.water_unit_current   ?? null,
        electric_current:     today?.electric_unit_current ?? null,
      }
    }))

    return c.json({ success: true, data: result })
  }
)

// GET /api/meters/:dormitoryId/contracts/:contractId
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

    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)
    return c.json({ success: true, data: record })
  }
)

// POST /api/meters/:dormitoryId
// บันทึกมิเตอร์ใหม่ — prev ดึงจาก room_id อัตโนมัติ
meters.post('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const body = await c.req.json()
    const { room_id, contract_id, reading_date, water_unit_current, electric_unit_current } = body

    if (!room_id || !reading_date || water_unit_current == null || electric_unit_current == null) {
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ (room_id, reading_date, water, electric)' }, 400)
    }
    if (Number(water_unit_current) < 0 || Number(electric_unit_current) < 0) {
      return c.json({ error: 'เลขมิเตอร์ต้องไม่ติดลบ' }, 400)
    }

    const room = await db.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(room_id).first()
    if (!room) return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)

    if (contract_id) {
      const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`).bind(contract_id).first()
      if (!contract) return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }

    // prev จาก room_id ก่อน reading_date นี้
    const prev = await db.prepare(`
      SELECT water_unit_current, electric_unit_current
      FROM meter_readings
      WHERE room_id = ? AND DATE(reading_date) < DATE(?)
      ORDER BY DATE(reading_date) DESC
      LIMIT 1
    `).bind(room_id, reading_date).first<{ water_unit_current: number; electric_unit_current: number }>()

    const id = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO meter_readings (
        id, room_id, contract_id, reading_date,
        water_unit_current, electric_unit_current,
        water_unit_previous, electric_unit_previous
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, room_id, contract_id ?? null, reading_date,
      Number(water_unit_current), Number(electric_unit_current),
      prev?.water_unit_current    ?? null,
      prev?.electric_unit_current ?? null
    ).run()

    const record = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(id).first()
    return c.json({ success: true, data: record }, 201)
  }
)

// PATCH /api/meters/:dormitoryId/contracts/:contractId
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

// PATCH /api/meters/:dormitoryId/reading/:meterId/water  — อัปเดตค่าน้ำอย่างเดียว
meters.patch('/:dormitoryId/reading/:meterId/water',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { water_unit_current } = await c.req.json()

    if (water_unit_current == null) return c.json({ error: 'กรุณากรอก water_unit_current' }, 400)

    const record = await db.prepare(`SELECT id FROM meter_readings WHERE id = ?`).bind(meterId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(`UPDATE meter_readings SET water_unit_current = ? WHERE id = ?`)
      .bind(Number(water_unit_current), meterId).run()

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(meterId).first()
    return c.json({ success: true, data: updated })
  }
)

// PATCH /api/meters/:dormitoryId/reading/:meterId/electric  — อัปเดตค่าไฟอย่างเดียว
meters.patch('/:dormitoryId/reading/:meterId/electric',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { electric_unit_current } = await c.req.json()

    if (electric_unit_current == null) return c.json({ error: 'กรุณากรอก electric_unit_current' }, 400)

    const record = await db.prepare(`SELECT id FROM meter_readings WHERE id = ?`).bind(meterId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(`UPDATE meter_readings SET electric_unit_current = ? WHERE id = ?`)
      .bind(Number(electric_unit_current), meterId).run()

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(meterId).first()
    return c.json({ success: true, data: updated })
  }
)

// PATCH /api/meters/:dormitoryId/reading/:meterId  — อัปเดตทั้ง water + electric
meters.patch('/:dormitoryId/reading/:meterId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const meterId = c.req.param('meterId')
    const { water_unit_current, electric_unit_current } = await c.req.json()

    if (water_unit_current == null || electric_unit_current == null) {
      return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    const record = await db.prepare(`SELECT id FROM meter_readings WHERE id = ?`).bind(meterId).first()
    if (!record) return c.json({ error: 'ไม่พบข้อมูลมิเตอร์' }, 404)

    await db.prepare(`UPDATE meter_readings SET water_unit_current = ?, electric_unit_current = ? WHERE id = ?`)
      .bind(Number(water_unit_current), Number(electric_unit_current), meterId).run()

    const updated = await db.prepare(`SELECT * FROM meter_readings WHERE id = ?`).bind(meterId).first()
    return c.json({ success: true, data: updated })
  }
)

// DELETE /api/meters/:dormitoryId/reading/:meterId
meters.delete('/:dormitoryId/reading/:meterId',
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