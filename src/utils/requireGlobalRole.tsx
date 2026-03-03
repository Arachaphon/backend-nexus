import { Context, Next } from 'hono'

export function requireGlobalRole(roles: ('owner' | 'manager')[]) {
  return async (c: Context, next: Next) => {
    const db = c.env.DB
    const user = c.get('jwtPayload')

    const result = await db.prepare(`
      SELECT role FROM dormitory_users 
      WHERE user_id = ? 
      LIMIT 1
    `).bind(user.userId).first() as { role: string } | undefined

    if (!result || !roles.includes(result.role as any)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    c.set('globalRole', result.role)
    await next()
  }
}