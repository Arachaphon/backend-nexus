import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { hashPassword, verifyPassword } from '../utils/hash'
import { D1Database } from '@cloudflare/workers-types'

const auth = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

auth.post('/register', async (c) => {
  try {
    const { username, email, password, phoneNumber } = await c.req.json()
    const db = c.env.DB

    const existing = await db.prepare(
      `SELECT id FROM profiles WHERE email = ?`
    ).bind(email).first()

    if (existing) {
      return c.json({ success: false, message: 'email นี้ถูกใช้งานแล้ว' }, 409)
    }

    const hashed = await hashPassword(password)

    await db.prepare(`
      INSERT INTO profiles (id, username, email, password, phone_number, global_role)
      VALUES (?, ?, ?, ?, ?, 'user')
    `).bind(
      crypto.randomUUID(),
      username,
      email,
      hashed,
      phoneNumber || null
    ).run()

    return c.json({ success: true }, 201)

  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


auth.post('/login', async (c) => {
  try {
    const { username, password } = await c.req.json()
    const db = c.env.DB

    const user = await db.prepare(
      `SELECT * FROM profiles WHERE username = ? OR email = ?`
    ).bind(username, username).first()

    const isValid = user
      ? await verifyPassword(password, user.password as string)
      : false

    if (!isValid) {
      return c.json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401)
    }

    const dormUser = await db.prepare(
      `SELECT role FROM dormitory_users WHERE user_id = ? LIMIT 1`
    ).bind(user!.id).first<{ role: string }>()

    const profile = await db.prepare(
      `SELECT global_role FROM profiles WHERE id = ?`
    ).bind(user!.id).first<{ global_role: string }>()

    const payload = {
      userId: user!.id,
      username: user!.username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
    }

    const token = await sign(payload, c.env.JWT_SECRET)

    return c.json({
      success: true,
      user: {
        id: user!.id,
        username: user!.username,
        role: dormUser?.role ?? null,
        global_role: profile?.global_role ?? null
      },
      token
    }, 200)

  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500)
  }
})

export default auth