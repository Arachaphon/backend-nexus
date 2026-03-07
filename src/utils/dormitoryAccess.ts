import { Context, Next } from 'hono'

export const requireDormitoryAccess = async (c: Context, next: Next) => {
    const db = c.env.DB
    const user = c.get('jwtPayload')
    
    const dormitoryId = c.req.param('id') 
        || c.req.param('dormitoryId')
        || new URL(c.req.url).pathname.split('/').find(
            seg => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
          )

    if (!dormitoryId) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const staff = await db.prepare(`
        SELECT role FROM dormitory_users
        WHERE dormitory_id = ?
        AND user_id = ?
    `).bind(dormitoryId, user.userId).first()

    if (!staff) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    c.set('dormRole', staff.role)

    await next()
}