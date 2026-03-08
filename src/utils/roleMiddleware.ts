import { Context, Next } from 'hono'

type DormRole = 'owner' | 'manager' | 'staff'

export function requireRole(roles: DormRole[]) {
  return async (c: Context, next: Next) => {

    const dormRole = c.get('dormRole') as DormRole

    if (!dormRole || !roles.includes(dormRole)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await next()
  }
}