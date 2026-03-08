import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'
import { requireGlobalRole } from '../../utils/requireGlobalRole'


const main = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

main.use('/*', authMiddleware)

main.get('/', async (c) => {
    try {
        const db = c.env.DB;
        const payload = c.get('jwtPayload');
        const userId = c.get('jwtPayload').userId;

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
            JOIN dormitory_users du ON du.dormitory_id = d.id
            WHERE du.user_id = ?
        `).bind(userId).all();

        return c.json({ success: true, data: results });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

main.get('/:dormitoryId',
    requireDormitoryAccess,  
    requireRole(['owner', 'manager']),
    async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('dormitoryId');
        const userId = c.get('jwtPayload').userId;

        const dormitory = await db.prepare(`
            SELECT * FROM dormitories WHERE id = ? 
        `)
        .bind(dormitoryId)
        .first(); 

        if (!dormitory) {
            return c.json({ success: false, message: "ไม่พบข้อมูลหอพัก" }, 404);
        }

        return c.json(dormitory);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

main.get('/:dormitoryId/stats', 
    requireDormitoryAccess,
    requireRole(['owner', 'manager']), 
    async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('dormitoryId');
        const userId = c.get('jwtPayload').userId;

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

main.post('/',
    requireGlobalRole(['landlord','owner']), 
    async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const userId = c.get('jwtPayload').userId;

        const dormitoryId = crypto.randomUUID();

        // 1️⃣ สร้าง dormitory
        await db.prepare(`
            INSERT INTO dormitories (
                id, name, address, phone_number, tax_id, due_date, fine_per_day
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
            dormitoryId,
            body.name,
            body.address,
            body.phone_number,
            body.tax_id || null,
            body.due_date,
            body.fine_per_day
        )
        .run();

        // 2️⃣ เพิ่ม owner คนแรก
        await db.prepare(`
            INSERT INTO dormitory_users (
                id, dormitory_id, user_id, role
            ) VALUES (?, ?, ?, 'owner')
        `)
        .bind(
            crypto.randomUUID(),
            dormitoryId,
            userId
        )
        .run();

        return c.json({ success: true, dormitory_id: dormitoryId }, 201);

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

main.patch('/:dormitoryId',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),
    async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('dormitoryId');
        const body = await c.req.json();

        // ดึงข้อมูลเดิมก่อน เพื่อ merge กับค่าที่ส่งมา
        const existing = await db.prepare(`
            SELECT * FROM dormitories WHERE id = ?
        `).bind(dormitoryId).first();

        if (!existing) {
            return c.json({ success: false, message: "ไม่พบข้อมูลหอพัก" }, 404);
        }

        // Validate due_date range ถ้ามีการส่งมา
        if (body.due_date !== undefined) {
            const due = Number(body.due_date);
            if (isNaN(due) || due < 1 || due > 31) {
                return c.json({ success: false, message: "due_date ต้องเป็นตัวเลข 1-31" }, 400);
            }
        }

        // Validate fine_per_day ถ้ามีการส่งมา
        if (body.fine_per_day !== undefined) {
            const fine = Number(body.fine_per_day);
            if (isNaN(fine) || fine < 0) {
                return c.json({ success: false, message: "fine_per_day ต้องเป็นตัวเลขที่ไม่ติดลบ" }, 400);
            }
        }

        // Merge: ใช้ค่าใหม่ถ้ามี ไม่อย่างนั้นใช้ค่าเดิม
        const name          = body.name          ?? existing.name;
        const address       = body.address       ?? existing.address;
        const phone_number  = body.phone_number  ?? existing.phone_number;
        const tax_id       = 'tax_id'       in body ? (body.tax_id ?? null)       : existing.tax_id;
        const due_date      = body.due_date      ?? existing.due_date;
        const fine_per_day  = body.fine_per_day  ?? existing.fine_per_day;
        const payment_note = 'payment_note' in body ? (body.payment_note ?? null) : existing.payment_note;

        await db.prepare(`
            UPDATE dormitories
            SET
                name          = ?,
                address       = ?,
                phone_number  = ?,
                tax_id        = ?,
                due_date      = ?,
                fine_per_day  = ?,
                payment_note  = ?,
                updated_at    = CURRENT_TIMESTAMP
            WHERE id = ?
        `)
        .bind(name, address, phone_number, tax_id, due_date, fine_per_day, payment_note, dormitoryId)
        .run();

        const updated = await db.prepare(`
            SELECT * FROM dormitories WHERE id = ?
        `).bind(dormitoryId).first();

        return c.json({ success: true, data: updated });

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

export default main;