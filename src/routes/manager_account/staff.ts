import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireGlobalRole } from '../../utils/requireGlobalRole'
import { hashPassword } from '../../utils/hash'

const staff = new Hono<{ Bindings: { DB: D1Database } }>()

staff.use('/*', authMiddleware)

staff.get('/', 
  requireGlobalRole(['user']),
  async (c) => {
  const db = c.env.DB
  const currentUser = c.get('jwtPayload')

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
        AND du.user_id != ?
      GROUP BY p.id
      ORDER BY MAX(du.role) DESC, p.username ASC
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
// staff.get('/:dormitoryId/staff/:userId',
//   requireDormitoryAccess,
//   requireRole(['owner', 'manager']),
//   async (c) => {
//     const db = c.env.DB
//     const dormitoryId = c.req.param(':dormitoryId')
//     const userId = c.req.param('userId')
//     const currentUser = c.get('jwtPayload')

//     if (currentUser.role === 'manager' && currentUser.userId !== userId) {
//       return c.json({ success: false }, 403)
//     }

//     const result = await db.prepare(`
//       SELECT 
//         p.id,
//         p.username,
//         p.email,
//         p.phone_number,
//         du.role,
//         du.assigned_at AS created_at
//       FROM dormitory_users du
//       JOIN profiles p ON du.user_id = p.id
//       WHERE du.dormitory_id = ?
//       AND du.user_id = ?
//     `).bind(dormitoryId, userId).first()

//     if (!result) {
//       return c.json({ success: false, error: 'Staff not found' }, 404)
//     }

//     return c.json({ success: true, data: result })
//   }
// )

// POST — สร้าง account ใหม่ให้ staff, global_role = NULL เด็ดขาด
staff.post('/',
  requireGlobalRole(['user']),
  async (c) => {
    const db = c.env.DB
    const currentUser = c.get('jwtPayload')

    try {
      const { username, email, password, phoneNumber, role, dorm_ids } = await c.req.json()

      if (!username || !email || !password || !dorm_ids || dorm_ids.length === 0) {
        return c.json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบและเลือกหอพักอย่างน้อย 1 แห่ง' }, 400)
      }

      const existing = await db.prepare(
        `SELECT id FROM profiles WHERE email = ?`
      ).bind(email).first()

      if (existing) {
        return c.json({ success: false, message: 'email นี้ถูกใช้งานแล้ว' }, 409)
      }

      const userId = crypto.randomUUID()
      const hashed = await hashPassword(password)
      const stmts = []

      stmts.push(
        db.prepare(`
          INSERT INTO profiles (id, username, email, password, phone_number, global_role)
          VALUES (?, ?, ?, ?, ?, 'staff')
        `).bind(userId, username, email, hashed, phoneNumber || null)
      )

      for (const dormId of dorm_ids) {
        stmts.push(
          db.prepare(`
            INSERT INTO dormitory_users (id, dormitory_id, user_id, role, assigned_by)
            VALUES (?, ?, ?, ?, ?)
          `).bind(crypto.randomUUID(), dormId, userId, role || 'staff', currentUser.userId)
        )
      }

      await db.batch(stmts)
      return c.json({ success: true }, 201)

    } catch (err: any) {
      return c.json({ success: false, message: err.message }, 500)
    }
  }
)

staff.delete('/:userId',
  requireGlobalRole(['user']),
  async (c) => {
    const db = c.env.DB
    const userId = c.req.param('userId')
    const currentUser = c.get('jwtPayload')

    if (currentUser.userId === userId) {
      return c.json({ success: false, message: 'ไม่สามารถลบตัวเองได้' }, 400)
    }

    try {
      const target = await db.prepare(
        `SELECT global_role FROM profiles WHERE id = ?`
      ).bind(userId).first<{ global_role: string }>()

      if (!target) {
        return c.json({ success: false, message: 'ไม่พบผู้ใช้งาน' }, 404)
      }

      if (target.global_role === 'staff') {
        await db.batch([
          db.prepare(`DELETE FROM dormitory_users WHERE user_id = ?`).bind(userId),
          db.prepare(`DELETE FROM profiles WHERE id = ?`).bind(userId)
        ])
      } else {
        await db.prepare(`
          DELETE FROM dormitory_users
          WHERE user_id = ?
          AND dormitory_id IN (
            SELECT dormitory_id FROM dormitory_users WHERE user_id = ?
          )
        `).bind(userId, currentUser.userId).run()
      }

      return c.json({ success: true })

    } catch (err: any) {
      return c.json({ success: false, message: err.message }, 500)
    }
  }
)
/**
 * PATCH STAFF
 */
staff.patch('/:userId',                         
  requireGlobalRole(['user']),
  async (c) => {
  const db = c.env.DB
  const userId = c.req.param('userId')
  const currentUser = c.get('jwtPayload')

  const body = await c.req.json()
  const stmts = []
  const fields: string[] = []
  const values: any[] = []

  if (body.username)    { fields.push('username = ?');     values.push(body.username) }
  if (body.email)       { fields.push('email = ?');        values.push(body.email) }
  if (body.phoneNumber) { fields.push('phone_number = ?'); values.push(body.phoneNumber) }
  
  if (body.password && body.password !== '..........') {
    const hashed = await hashPassword(body.password)
    fields.push('password = ?')
    values.push(hashed)
  }

  if (fields.length > 0) {
    values.push(userId)
    console.log('UPDATE fields:', fields)
    console.log('UPDATE values:', values)
    stmts.push(db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`).bind(...values))
  }

  if (body.dorm_ids && Array.isArray(body.dorm_ids)) {
    stmts.push(db.prepare(`
      DELETE FROM dormitory_users 
      WHERE user_id = ? 
      AND dormitory_id IN (SELECT dormitory_id FROM dormitory_users WHERE user_id = ?)
    `).bind(userId, currentUser.userId))

    for (const dormId of body.dorm_ids) {
      stmts.push(db.prepare(`
        INSERT INTO dormitory_users (id, dormitory_id, user_id, role, assigned_by) 
        VALUES (?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), dormId, userId, body.role || 'manager', currentUser.userId))
    }
  }

  try {
    if (stmts.length === 0) {
      return c.json({ success: true })
    }
    // รันทีละ statement เพื่อ debug
    for (let i = 0; i < stmts.length; i++) {
      try {
        await stmts[i].run()
      } catch (e: any) {
        console.error(`stmt[${i}] failed:`, e.message)
        return c.json({ success: false, message: `stmt[${i}]: ${e.message}` }, 500)
      }
    }
    return c.json({ success: true })
  } catch (err: any) {
    console.error('batch error:', err.message)
    console.error('fields:', fields)
    console.error('values:', values)
    return c.json({ success: false, message: err.message }, 500)
  }
})

/**
 * DELETE STAFF
 */
staff.delete('/:userId',                         
  requireGlobalRole(['user']),
  async (c) => {
  const db = c.env.DB
  const userId = c.req.param('userId')
  const currentUser = c.get('jwtPayload')

  if (currentUser.userId === userId) {
    return c.json({ success: false, error: 'Cannot delete yourself' }, 400)
  }

  try {
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