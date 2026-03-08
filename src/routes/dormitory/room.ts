import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'
import { requireGlobalRole } from '../../utils/requireGlobalRole'

const rooms = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

rooms.use('*', authMiddleware)

/* =========================================================
   GET: ห้องทั้งหมดของหอ
========================================================= */
rooms.get('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner','manager','staff']),
  async (c) => {

    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    const { results } = await db.prepare(`
      SELECT r.*
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.dormitories_id = ?
    `).bind(dormitoryId).all()

    return c.json({ success:true, data:results })
})

/* =========================================================
   GET: ห้องเดียว
========================================================= */
rooms.get('/:dormitoryId/:roomId',
  requireDormitoryAccess,
  requireRole(['owner','manager','staff']),
  async (c) => {

    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const roomId = c.req.param('roomId')

    const room = await db.prepare(`
      SELECT r.*
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE r.id = ? AND f.dormitories_id = ?
    `).bind(roomId, dormitoryId).first()

    if (!room) {
      return c.json({ success:false, message:'ไม่พบข้อมูลห้อง' },404)
    }

    return c.json({ success:true, data:room })
})

/* =========================================================
   POST: สร้าง/แก้ไข floor + room
========================================================= */
rooms.post('/:dormitoryId',
  requireGlobalRole(['user']),
  async (c) => {

    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    let body
    try {
      body = await c.req.json()
    } catch {
      return c.json({ success:false, message:'Invalid JSON body' },400)
    }

    const { floors } = body

    if (!Array.isArray(floors)) {
      return c.json({ success:false, message:'Floors must be array' },400)
    }

    const floorStatements: any[] = []
    const roomStatements: any[] = []

    try {

      for (const f of floors) {

        if (
          typeof f.id !== 'string' ||
          typeof f.floorNumber !== 'number' ||
          !Array.isArray(f.rooms)
        ) {
          return c.json({ success:false, message:'Invalid floor structure' },400)
        }

        const existingFloor = await db.prepare(`
          SELECT dormitories_id FROM floors WHERE id = ?
        `).bind(f.id).first()

        if (existingFloor && existingFloor.dormitories_id !== dormitoryId) {
          return c.json({ success:false, message:'Forbidden floor update' },403)
        }

        floorStatements.push(
          db.prepare(`
            INSERT INTO floors (id, dormitories_id, floor_number, room_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              floor_number = excluded.floor_number,
              room_count = excluded.room_count
          `).bind(
            f.id,
            dormitoryId,
            f.floorNumber,
            f.rooms.length
          )
        )

        for (const r of f.rooms) {

          if (
            typeof r.id !== 'string' ||
            typeof r.number !== 'string'
          ) {
            return c.json({ success:false, message:'Invalid room structure' },400)
          }

          const isActive =
            r.isActive === true ||
            r.isActive === 1 ||
            r.isActive === '1'

          const existingRoom = await db.prepare(`
            SELECT f.dormitories_id
            FROM rooms r
            JOIN floors f ON r.floor_id = f.id
            WHERE r.id = ?
          `).bind(r.id).first()

          if (existingRoom && existingRoom.dormitories_id !== dormitoryId) {
            return c.json({ success:false, message:'Forbidden room update' },403)
          }

          roomStatements.push(
            db.prepare(`
              INSERT INTO rooms
              (id, floor_id, room_number, is_active, status, current_rent_price)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                room_number = excluded.room_number,
                is_active = excluded.is_active
            `).bind(
              r.id,
              f.id,
              r.number,
              isActive ? 1 : 0,
              'vacant',
              0
            )
          )
        }
      }

      await db.batch(floorStatements)
      await db.batch(roomStatements)

      return c.json({ success:true })

    } catch (err) {
      console.error("ROOM SAVE ERROR:", err)
      return c.json({ success:false, message:String(err) },500)
    }
  }
)

/* =========================================================
   PATCH: อัปเดตราคา / สถานะ
========================================================= */
rooms.patch('/:dormitoryId',
  requireDormitoryAccess,
  requireRole(['owner','manager']),

  async (c) => {

    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    const { roomIds, price, status } = await c.req.json()

    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      return c.json({ success:false },400)
    }

    const placeholders = roomIds.map(() => '?').join(',')

    const row = await db.prepare(`
      SELECT COUNT(*) as count
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.dormitories_id = ?
      AND r.id IN (${placeholders})
    `).bind(dormitoryId, ...roomIds).first()

    if (!row || row.count !== roomIds.length) {
      return c.json({ success:false, message:'Forbidden' },403)
    }

    const updates: string[] = []
    const values: any[] = []

    if (price !== undefined) {
      const num = Number(price)
      if (isNaN(num)) {
        return c.json({ success:false },400)
      }
      updates.push('current_rent_price = ?')
      values.push(num)
    }

    const validStatus = ['vacant','occupied','maintenance']

    if (status !== undefined) {
      if (!validStatus.includes(status)) {
        return c.json({ success:false, message:'Invalid status' },400)
      }
      updates.push('status = ?')
      values.push(status)
    }

    if (updates.length === 0) {
      return c.json({ success:false },400)
    }

    const query = `
      UPDATE rooms
      SET ${updates.join(', ')}
      WHERE id IN (${placeholders})
    `

    await db.prepare(query).bind(...values, ...roomIds).run()

    return c.json({ success:true })
  }
)

export default rooms