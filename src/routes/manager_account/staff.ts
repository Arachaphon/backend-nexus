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
        p.role,
        ds.is_active,
        ds.created_at
      FROM dormitory_staff ds
      JOIN profiles p ON ds.user_id = p.id
      WHERE ds.dormitory_id = ?
    `).bind(dormId).all()

    return c.json({ success: true, data: results })
  }
)

/**
 * GET STAFF BY ID
 */
staff.get('/:dormId/staff/:userId',
  requireDormitoryAccess,
  requireRole(['owner','manager']),
  async (c) => {

    const db = c.env.DB
    const dormId = c.req.param('dormId')
    const userId = c.req.param('userId')
    const currentUser = c.get('jwtPayload')

    if (currentUser.role === 'manager' && currentUser.userId !== userId) {
      return c.json({ success: false }, 403)
    }

    const staff = await db.prepare(`
      SELECT 
        p.id,
        p.username,
        p.email,
        p.phone_number,
        p.role,
        ds.is_active,
        ds.created_at
      FROM dormitory_staff ds
      JOIN profiles p ON ds.user_id = p.id
      WHERE ds.dormitory_id = ?
      AND ds.user_id = ?
    `).bind(dormId, userId).first()

    if (!staff) {
      return c.json({ success: false }, 404)
    }

    return c.json({ success: true, data: staff })
  }
)

/**
 * CREATE MANAGER
 */
staff.post('/:dormId',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {

    const db = c.env.DB
    const dormId = c.req.param('dormId')
    const { username, email, password, phoneNumber } = await c.req.json()

    if (!username || !email || !password) {
      return c.json({ success: false }, 400)
    }

    const userId = crypto.randomUUID()
    const hashed = await hashPassword(password)

    await db.batch([
      db.prepare(`
        INSERT INTO profiles
        (id, username, email, password, phone_number, role)
        VALUES (?, ?, ?, ?, ?, 'manager')
      `).bind(userId, username, email, hashed, phoneNumber),

      db.prepare(`
        INSERT INTO dormitory_staff (id, dormitory_id, user_id)
        VALUES (?, ?, ?)
      `).bind(crypto.randomUUID(), dormId, userId)
    ])

    return c.json({ success: true }, 201)
  }
)

export default staff