import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../utils/authMiddleware'

const banks = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

banks.use('/*', authMiddleware)

banks.post('/add', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const payload = c.get('jwtPayload');

        const { dormitoryId } = body;

        if (!dormitoryId || !body.bank_name || !body.account_number) {
            return c.json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" }, 400);
        }

        const bankId = crypto.randomUUID();

        await db.batch([
            db.prepare(`
                INSERT INTO bank_accounts 
                (id, dormitories_id, bank_name, bank_logo, account_number, account_name)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(bankId, dormitoryId, body.bank_name, body.bank_logo || null, body.account_number, body.account_name),

            db.prepare(`
                UPDATE dormitories 
                SET payment_note = ? 
                WHERE id = ? AND owner_id = ?
            `).bind(body.payment_note || "", dormitoryId, payload.id)
        ]);

        return c.json({
            success: true,
            bank_id: bankId
        }, 201);

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

banks.delete('/delete/:id', async (c) => {
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

banks.get('/list/:dormitoryId', async (c) => {
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

export default banks