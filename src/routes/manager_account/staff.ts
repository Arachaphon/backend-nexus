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

  try {
    const { results } = await db.prepare(`
      SELECT 
        p.id,
        p.username as full_name,  -- แมปให้ตรงกับ Frontend
        p.email,
        p.phone_number as phone,   -- แมปให้ตรงกับ Frontend
        MAX(du.role) as role,
        GROUP_CONCAT(d.name, ', ') as dorm_label,
        GROUP_CONCAT(d.id, ',') as dorm_ids
      FROM profiles p
      JOIN dormitory_users du ON p.id = du.user_id
      JOIN dormitories d ON du.dormitory_id = d.id
      WHERE du.dormitory_id IN (
        SELECT dormitory_id FROM dormitory_users WHERE user_id = ?
      )
      AND p.id != ? 
      GROUP BY p.id
    `).bind(currentUser.userId, currentUser.userId).all()

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
staff.get('/:dormId/staff/:userId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormId = c.req.param('dormId')
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
    `).bind(dormId, userId).first()

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
staff.patch('/:dormId/staff/:userId',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {
    const db = c.env.DB
    const dormId = c.req.param('dormId')
    const userId = c.req.param('userId')
    const body = await c.req.json()

    const exists = await db.prepare(`
      SELECT id FROM dormitory_users
      WHERE dormitory_id = ? AND user_id = ?
    `).bind(dormId, userId).first()

    if (!exists) {
      return c.json({ success: false, error: 'Staff not found' }, 404)
    }

    const fields: string[] = []
    const values: any[] = []

    if (body.username)    { fields.push('username = ?');     values.push(body.username) }
    if (body.email)       { fields.push('email = ?');        values.push(body.email) }
    if (body.phoneNumber) { fields.push('phone_number = ?'); values.push(body.phoneNumber) }
    if (body.password) {
      const hashed = await hashPassword(body.password)
      fields.push('password = ?')
      values.push(hashed)
    }

    if (fields.length === 0) {
      return c.json({ success: false, error: 'No fields to update' }, 400)
    }

    values.push(userId)

    await db.prepare(`
      UPDATE profiles SET ${fields.join(', ')} WHERE id = ?
    `).bind(...values).run()

    return c.json({ success: true })
  }
)

/**
 * DELETE STAFF
 */
staff.delete('/:dormId/staff/:userId',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {
    const db = c.env.DB
    const dormId = c.req.param('dormId')
    const userId = c.req.param('userId')
    const currentUser = c.get('jwtPayload')

    if (currentUser.userId === userId) {
      return c.json({ success: false, error: 'Cannot delete yourself' }, 400)
    }

    const exists = await db.prepare(`
      SELECT id FROM dormitory_users
      WHERE dormitory_id = ? AND user_id = ?
    `).bind(dormId, userId).first()

    if (!exists) {
      return c.json({ success: false, error: 'Staff not found' }, 404)
    }

    await db.batch([
      db.prepare(`
        DELETE FROM dormitory_users
        WHERE dormitory_id = ? AND user_id = ?
      `).bind(dormId, userId),

      db.prepare(`
        DELETE FROM profiles WHERE id = ?
      `).bind(userId)
    ])

    return c.json({ success: true })
  }
)

export default staff