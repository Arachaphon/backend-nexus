import { Hono } from 'hono' 
import { jwt } from 'hono/jwt'

const dormitories = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

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


dormitories.get('/list', async (c) => {
    try {
        const db = c.env.DB;
        const payload = c.get('jwtPayload');
        const ownerId = payload.id;

        const { results } = await db.prepare(`
            SELECT 
                d.id,
                d.name,
                (
                    SELECT COUNT(r.id) 
                    FROM rooms r 
                    JOIN floors f ON r.floor_id = f.id 
                    WHERE f.dormitories_id = d.id
                ) as total_rooms,
                (
                    SELECT COUNT(r.id) 
                    FROM rooms r 
                    JOIN floors f ON r.floor_id = f.id 
                    WHERE f.dormitories_id = d.id AND r.status = 'vacant'
                ) as vacant_rooms
            FROM dormitories d
            WHERE d.owner_id = ?
        `).bind(ownerId).all();

        return c.json({ success: true, data: results });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

dormitories.get('/info/:id', async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('id');
        const payload = c.get('jwtPayload');
        const ownerId = payload.id;

        const dormitory = await db.prepare(`
            SELECT * FROM dormitories WHERE id = ? AND owner_id = ?
        `)
        .bind(dormitoryId, ownerId)
        .first(); 

        if (!dormitory) {
            return c.json({ success: false, message: "ไม่พบข้อมูลหอพัก" }, 404);
        }

        return c.json(dormitory);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

dormitories.patch('/update-payment-note', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const payload = c.get('jwtPayload');
        const ownerId = payload.id;
        const { dormitoryId, payment_note } = body;

        if (!dormitoryId) {
            return c.json({ success: false, message: "Missing dormitoryId" }, 400);
        }

        const result = await db.prepare(`
            UPDATE dormitories 
            SET payment_note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND owner_id = ?
        `)
        .bind(payment_note, dormitoryId, ownerId)
        .run();

        if (result.meta.changes === 0) {
            return c.json({ success: false, message: "หอพักไม่พบหรือคุณไม่มีสิทธิ์แก้ไข" }, 404);
        }

        return c.json({ success: true, message: "บันทึกหมายเหตุสำเร็จ" });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

export default dormitories;