// src/utils/roleMiddleware.ts
import { Context, Next } from 'hono'

export function requireRole(roles: ('owner' | 'manager')[]) {
    return async (c: Context, next: Next) => {
        const user = c.get('user')

        if (!user) {
            return c.json({ error: 'Unauthorized' }, 401)
        }

        if (!roles.includes(user.role)) {
            return c.json({ error: 'Forbidden: ไม่มีสิทธิ์ใช้งานส่วนนี้' }, 403)
        }

        await next()
    }
}
