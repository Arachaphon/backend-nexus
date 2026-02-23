import { Hono } from 'hono' 
import { authMiddleware } from '../../utils/authMiddleware'
import { D1Database } from '@cloudflare/workers-types'

const main = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

main.use('/*', authMiddleware)

main.post('/', async (c) => {
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


main.get('/', async (c) => {
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

main.get('/:id', async (c) => {
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

main.patch('/:id/payment-note', async (c) => {
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

main.get('/:id/stats', async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('id');
        const payload = c.get('jwtPayload');
        const ownerId = payload.id;

        const dormitory = await db.prepare(`
            SELECT id FROM dormitories WHERE id = ? AND owner_id = ?
        `).bind(dormitoryId, ownerId).first();

        if (!dormitory) {
            return c.json({ success: false, message: "ไม่พบข้อมูลหอพักหรือคุณไม่มีสิทธิ์เข้าถึง" }, 404);
        }

        const stats = await db.prepare(`
            SELECT 
                COUNT(r.id) as total_rooms,
                SUM(CASE WHEN r.status = 'vacant' THEN 1 ELSE 0 END) as vacant_rooms,
                SUM(CASE WHEN r.status = 'occupied' THEN 1 ELSE 0 END) as occupied_rooms,
                (
                    SELECT COUNT(b.id) 
                    FROM bills b 
                    JOIN rooms rm ON b.room_id = rm.id
                    JOIN floors fl ON rm.floor_id = fl.id
                    WHERE fl.dormitories_id = ? AND b.payment_status = 'pending'
                ) as pending_payments
            FROM rooms r
            JOIN floors f ON r.floor_id = f.id
            WHERE f.dormitories_id = ?
        `).bind(dormitoryId, dormitoryId).first();
        return c.json({
            success: true,
            data: {
                total: stats?.total_rooms ?? 0,
                vacant: stats?.vacant_rooms ?? 0,
                occupied: stats?.occupied_rooms ?? 0,
                pending: stats?.pending_payments ?? 0
            }
        });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});
export default main;