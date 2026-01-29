import { Hono } from 'hono' // ต้อง import Hono ด้วย
import { jwt } from 'hono/jwt'

const dormitories = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

// แก้ไข secret: ให้ดึงจาก Environment variable เพื่อความปลอดภัย
dormitories.use('/*', async (c, next) => {
  const middleware = jwt({ 
    secret: c.env.JWT_SECRET,
    alg: 'HS256'
  });
  return middleware(c, next);
});

dormitories.post('/add', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const payload = c.get('jwtPayload');
        const ownerIdFromToken = payload.id; 

        const dormitoryId = crypto.randomUUID();

        await db.prepare(`
            INSERT INTO dormitories (
                id, owner_id, name, address, phone_number, tax_id, due_date, fine_per_day
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
            dormitoryId, 
            ownerIdFromToken,
            body.name, 
            body.address, 
            body.phone_number, 
            body.tax_id || null,
            body.due_date, 
            body.fine_per_day
        )
        .run();

        return c.json({ success: true, dormitory_id: dormitoryId }, 201);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

export default dormitories;