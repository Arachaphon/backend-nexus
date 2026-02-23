import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'

const banks = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

banks.use('/*', authMiddleware)

banks.get('/:dormitoryId', async (c) => {
    try {
        const db = c.env.DB;
        const dormId = c.req.param('dormitoryId');

        const { results } = await db.prepare(`
            SELECT id,
                   bank_name AS bankName,
                   bank_logo AS bankLogo,
                   account_number AS accountNumber,
                   account_name AS accountName
            FROM bank_accounts
            WHERE dormitories_id = ?
        `)
        .bind(dormId)
        .all();

        return c.json(results);

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

banks.post('/', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const payload = c.get('jwtPayload');

        const { dormitoryId, bank_name, account_number, bank_logo, account_name } = body;

        if (!dormitoryId || !bank_name || !account_number) {
            return c.json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" }, 400);
        }

        const bankId = crypto.randomUUID();

        await db.prepare(`
            INSERT INTO bank_accounts 
            (id, dormitories_id, bank_name, bank_logo, account_number, account_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
            bankId,
            dormitoryId,
            bank_name,
            bank_logo || null,
            account_number,
            account_name || null
        ).run();

        return c.json({ success: true, bank_id: bankId }, 201);

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

banks.delete('/:id', async (c) => {
    try {
        const db = c.env.DB;
        const bankId = c.req.param('id');

        await db.prepare(`
            DELETE FROM bank_accounts WHERE id = ?
        `).bind(bankId).run();

        return c.json({ success: true });

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});


banks.patch('/payment-note/:dormitoryId', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const payload = c.get('jwtPayload');
        const ownerId = payload.id;
        const dormitoryId = c.req.param('dormitoryId')
        const { payment_note } = body;

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
export default banks