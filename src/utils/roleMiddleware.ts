import { Context, Next } from 'hono'

export function requireRole(roles: ('owner'|'manager')[]) {
  return async (c: Context, next: Next) => {

    const dormRole = c.get('dormRole')

    if (!roles.includes(dormRole)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await next()
  }
}