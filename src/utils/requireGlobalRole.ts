import { Context, Next } from 'hono'

export function requireGlobalRole(roles: ('landlord' | 'owner' | 'manager')[]) {
  return async (c: Context, next: Next) => {
    const db = c.env.DB
    const user = c.get('jwtPayload')

    const profile = await db.prepare(`
      SELECT global_role FROM profiles WHERE id = ?
    `).bind(user.userId).first() as { global_role: string } | undefined

    const dormUser = await db.prepare(`
      SELECT role FROM dormitory_users 
      WHERE user_id = ? 
      ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 END
      LIMIT 1
    `).bind(user.userId).first() as { role: string } | undefined

    const globalRole = profile?.global_role
    const dormRole = dormUser?.role

    const hasAccess = 
      (globalRole && roles.includes(globalRole as any)) ||
      (dormRole && roles.includes(dormRole as any))

    if (!hasAccess) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    c.set('globalRole', globalRole ?? dormRole)
    await next()
  }
}