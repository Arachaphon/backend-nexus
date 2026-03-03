import { Hono } from 'hono'
import { hashPassword, verifyPassword } from '../utils/hash'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../utils/authMiddleware'
import { requireRole } from '../utils/roleMiddleware'

const profile = new Hono<{ Bindings: { DB: D1Database } }>()

profile.use('/*', authMiddleware)

/**
 * GET MY PROFILE
 */
profile.get('/',
  requireRole(['owner']), 
  async (c) => {

  const payload = c.get('jwtPayload')
  const userId = payload.userId
  const db = c.env.DB

  const user = await db.prepare(`
    SELECT username, email, phone_number
    FROM profiles
    WHERE id = ?
  `).bind(userId).first()

  return c.json({ success: true, data: user })
})

/**
 * UPDATE PROFILE
 */
profile.patch('/',
  requireRole(['owner']), 
  async (c) => {

  const payload = c.get('jwtPayload')
  const userId = payload.userId
  const { username, email } = await c.req.json()
  const db = c.env.DB

  if (!username || !email) {
    return c.json({ success: false }, 400)
  }

  await db.prepare(`
    UPDATE profiles
    SET username = ?, email = ?
    WHERE id = ?
  `).bind(username, email, userId).run()

  return c.json({ success: true })
})

/**
 * CHANGE PASSWORD
 */
profile.patch('/password',
  requireRole(['owner']), 
  async (c) => {

  const payload = c.get('jwtPayload')
  const userId = payload.userId
  const { currentPassword, newPassword } = await c.req.json()
  const db = c.env.DB

  if (!currentPassword || !newPassword) {
    return c.json({ success: false }, 400)
  }

  const user = await db.prepare(`
    SELECT password FROM profiles WHERE id = ?
  `).bind(userId).first()

  if (!user) {
    return c.json({ success: false }, 404)
  }

  const valid = await verifyPassword(currentPassword, user.password as string)

  if (!valid) {
    return c.json({ success: false }, 401)
  }

  const hashed = await hashPassword(newPassword)

  await db.prepare(`
    UPDATE profiles SET password = ? WHERE id = ?
  `).bind(hashed, userId).run()

  return c.json({ success: true })
})

export default profile