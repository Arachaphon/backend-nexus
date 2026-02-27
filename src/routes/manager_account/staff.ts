import { Hono } from 'hono'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireRole } from '../../utils/roleMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { hashPassword } from '../../utils/hash'
import { D1Database } from '@cloudflare/workers-types'

const staff = new Hono<{ Bindings: { DB: D1Database } }>()

staff.use('/*', authMiddleware)

/**
 * GET STAFF LIST
 */
staff.get('/:dormId/staff',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {
    const db = c.env.DB
    const dormId = c.req.param('dormId')

    const { results } = await db.prepare(`
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
    `).bind(dormId).all()

    return c.json({ success: true, data: results })
  }
)

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

/**
 * CREATE MANAGER
 */
staff.post('/:dormId/staff',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {
    const db = c.env.DB
    const dormId = c.req.param('dormId')
    const currentUser = c.get('jwtPayload')
    const { username, email, password, phoneNumber } = await c.req.json()

    if (!username || !email || !password) {
      return c.json({ success: false, error: 'Missing required fields' }, 400)
    }

    // เช็ค email ซ้ำ
    const existing = await db.prepare(`
      SELECT id FROM profiles WHERE email = ?
    `).bind(email).first()

    if (existing) {
      return c.json({ success: false, error: 'Email already exists' }, 409)
    }

    const userId = crypto.randomUUID()
    const hashed = await hashPassword(password)

    await db.batch([
      db.prepare(`
        INSERT INTO profiles (id, username, email, password, phone_number)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, username, email, hashed, phoneNumber ?? null),

      db.prepare(`
        INSERT INTO dormitory_users (id, dormitory_id, user_id, role, assigned_by)
        VALUES (?, ?, ?, 'manager', ?)
      `).bind(crypto.randomUUID(), dormId, userId, currentUser.userId)
    ])

    return c.json({ success: true }, 201)
  }
)

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