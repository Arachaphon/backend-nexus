import { Context, Next } from 'hono'
import { D1Database } from '@cloudflare/workers-types'

export type AppEnv = {
  Bindings: {
    DB: D1Database
  }
  Variables: {
    jwtPayload: {
      userId: string
      email?: string
    }
    dormRole: 'owner' | 'manager' | 'staff'
  }
}

export const requireDormitoryAccess = async (
  c: Context<AppEnv>,
  next: Next
) => {

  const db = c.env.DB
  const payload = c.get('jwtPayload')

  const userId = payload.userId
  const dormitoryId = c.req.param('dormitoryId')

  const access = await db
    .prepare(`
      SELECT role
      FROM dormitory_users
      WHERE dormitory_id = ?
      AND user_id = ?
    `)
    .bind(dormitoryId, userId)
    .first<{ role: 'owner' | 'manager' | 'staff' }>()

  if (!access) {
    return c.json(
      {
        success: false,
        message: 'No access to this dormitory',
      },
      403
    )
  }

  c.set('dormRole', access.role)

  await next()
}