import { Hono } from 'hono'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireRole } from '../../utils/roleMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { hashPassword } from '../../utils/hash'
import { D1Database } from '@cloudflare/workers-types'

const staff = new Hono<{ Bindings: { DB: D1Database } }>()

staff.use('/*', authMiddleware)

staff.get('/', async (c) => {
  const db = c.env.DB
  const currentUser = c.get('jwtPayload')

  const myRole = await db.prepare(`
    SELECT role FROM dormitory_users WHERE user_id = ? LIMIT 1
  `).bind(currentUser.userId).first<{ role: string }>()

  if (!myRole || myRole.role !== 'owner') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  try {
    const { results } = await db.prepare(`
      SELECT 
        p.id,
        p.username         AS full_name,
        p.email,
        p.phone_number     AS phone,
        MAX(du.role)       AS role,
        GROUP_CONCAT(DISTINCT d.name) AS dorm_label,
        GROUP_CONCAT(DISTINCT d.id)   AS dorm_ids
      FROM dormitory_users du
      JOIN profiles p ON p.id = du.user_id
      JOIN dormitories d ON d.id = du.dormitory_id
      WHERE du.dormitory_id IN (
        SELECT dormitory_id FROM dormitory_users WHERE user_id = ?
      )
      GROUP BY p.id
      ORDER BY MAX(du.role) DESC, p.username ASC
    `).bind(currentUser.userId).all()

    const data = results.map((r: any) => ({
      ...r,
      dorm_ids: r.dorm_ids ? r.dorm_ids.split(',') : [],
      is_active: true
    }))

    return c.json({ success: true, data })
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500)
  }
})


/**
 * GET STAFF BY ID
 */
staff.get('/:dormitoryId/staff/:userId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param(':dormitoryId')
    const userId = c.req.param('userId')
    const currentUser = c.get('jwtPayload')

    if (currentUser.role === 'manager' && currentUser.userId !== userId) {
      return c.json({ success: false }, 403)
    }

    const result = await db.prepare(`
      SELECT 
        p.id,
        p.username,
        p.email,
        p.phone_number,
        du.role,
        du.assigned_at AS created_at
      FROM dormitory_users du
      JOIN profiles p ON du.user_id = p.id
      WHERE du.dormitory_id = ?
      AND du.user_id = ?
    `).bind(dormitoryId, userId).first()

    if (!result) {
      return c.json({ success: false, error: 'Staff not found' }, 404)
    }

    return c.json({ success: true, data: result })
  }
)

staff.post('/', async (c) => {
  const db = c.env.DB
  const currentUser = c.get('jwtPayload')
  
  try {
    const { username, email, password, phoneNumber, role, dorm_ids } = await c.req.json()

    // เช็คข้อมูล
    if (!username || !dorm_ids || dorm_ids.length === 0) {
       return c.json({ success: false, message: 'กรุณาเลือกหอพักอย่างน้อย 1 แห่ง' }, 400)
    }

    const userId = crypto.randomUUID()
    const hashed = await hashPassword(password)
    const stmts = []

    // 1. สร้าง Profile
    stmts.push(
      db.prepare(`INSERT INTO profiles (id, username, email, password, phone_number) VALUES (?, ?, ?, ?, ?)`)
        .bind(userId, username, email, hashed, phoneNumber || null)
    )

    // 2. วนลูปสร้างสิทธิ์ในแต่ละหอพัก
    for (const dormId of dorm_ids) {
      stmts.push(
        db.prepare(`INSERT INTO dormitory_users (id, dormitory_id, user_id, role, assigned_by) VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), dormId, userId, role || 'manager', currentUser.userId)
      )
    }

    await db.batch(stmts)
    return c.json({ success: true }, 201)
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500)
  }
})

/**
 * PATCH STAFF
 */
// เปลี่ยนจาก staff.patch('/:dormId/staff/:userId', ...) เป็น:
staff.patch('/:userId', 
  requireRole(['owner']), 
  async (c) => {
    const db = c.env.DB
    const userId = c.req.param('userId')
    const currentUser = c.get('jwtPayload')
    const body = await c.req.json()

    const stmts = []

    // --- ส่วนที่ 1: อัปเดตข้อมูล Profile ---
    const fields: string[] = []
    const values: any[] = []

    if (body.username)    { fields.push('username = ?');     values.push(body.username) }
    if (body.email)       { fields.push('email = ?');        values.push(body.email) }
    if (body.phoneNumber) { fields.push('phone_number = ?'); values.push(body.phoneNumber) }
    
    // ถ้าแก้รหัสผ่าน และไม่ใช่ค่า placeholder (..........) ถึงจะทำการ Hash และบันทึก
    if (body.password && body.password !== '..........') {
      const hashed = await hashPassword(body.password)
      fields.push('password = ?')
      values.push(hashed)
    }

    if (fields.length > 0) {
      values.push(userId)
      stmts.push(db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`).bind(...values))
    }

    // --- ส่วนที่ 2: อัปเดตการเลือกหอพัก (Dormitory Sync) ---
    if (body.dorm_ids && Array.isArray(body.dorm_ids)) {
      // 1. ล้างสิทธิ์เดิมของพนักงานคนนี้ "เฉพาะในหอพักที่ผู้ใช้งานปัจจุบัน (Owner) มีสิทธิ์ดูแล"
      stmts.push(db.prepare(`
        DELETE FROM dormitory_users 
        WHERE user_id = ? 
        AND dormitory_id IN (SELECT dormitory_id FROM dormitory_users WHERE user_id = ?)
      `).bind(userId, currentUser.userId))

      // 2. เพิ่มสิทธิ์ใหม่ตามที่ติ๊กเลือกมาจากหน้าบ้าน
      for (const dormId of body.dorm_ids) {
        stmts.push(db.prepare(`
          INSERT INTO dormitory_users (id, dormitory_id, user_id, role, assigned_by) 
          VALUES (?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), dormId, userId, body.role || 'manager', currentUser.userId))
      }
    }

    try {
      await db.batch(stmts) // รันคำสั่งทั้งหมดในครั้งเดียว (Transaction)
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ success: false, message: err.message }, 500)
    }
  }
)

/**
 * DELETE STAFF
 */
staff.delete('/:userId', requireRole(['owner']), async (c) => {
  const db = c.env.DB
  const userId = c.req.param('userId')
  const currentUser = c.get('jwtPayload')

  // ป้องกันการลบตัวเอง
  if (currentUser.userId === userId) {
    return c.json({ success: false, error: 'Cannot delete yourself' }, 400)
  }

  try {
    // ลบทั้งสิทธิ์หอพักและโปรไฟล์
    await db.batch([
      db.prepare(`DELETE FROM dormitory_users WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM profiles WHERE id = ?`).bind(userId)
    ])
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500)
  }
})
export default staff