import { Context, Next } from 'hono'
import { D1Database } from '@cloudflare/workers-types'

type Env = {
  Bindings: {
    DB: D1Database
  }
}

export const requireGlobalRole = (roles: string[]) => {
  return async (c: Context<Env>, next: Next) => {

    const payload = c.get('jwtPayload')
    const userId = payload.userId
    const db = c.env.DB

    const user = await db.prepare(`
      SELECT global_role
      FROM profiles
      WHERE id = ?
    `)
    .bind(userId)
    .first<{ global_role: string }>()

    if (!user) {
      return c.json({ success:false, message:'User not found' },404)
    }

    if (!roles.includes(user.global_role)) {
      return c.json({ success:false, message:'Forbidden' },403)
    }

    await next()
  }
}