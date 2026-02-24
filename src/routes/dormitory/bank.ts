import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireRole } from '../../utils/roleMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'

const banks = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

banks.use('/*', authMiddleware)

banks.get('/:id',
    requireDormitoryAccess,
    requireRole(['owner','manager']),
    async (c) => {

    const db = c.env.DB;
    const dormId = c.req.param('id');

    const { results } = await db.prepare(`
        SELECT id,
               bank_name AS bankName,
               bank_logo AS bankLogo,
               account_number AS accountNumber,
               account_name AS accountName
        FROM bank_accounts
        WHERE dormitories_id = ?
    `).bind(dormId).all();

    return c.json({ success:true, data:results });
});

banks.post('/:id',
    requireDormitoryAccess,
    requireRole(['owner']),
    async (c) => {

    const db = c.env.DB;
    const dormId = c.req.param('id');
    const body = await c.req.json();

    const { bank_name, account_number, bank_logo, account_name } = body;

    if (!bank_name || !account_number) {
        return c.json({ success:false, message:'กรอกข้อมูลไม่ครบ' },400);
    }

    const bankId = crypto.randomUUID();

    await db.prepare(`
        INSERT INTO bank_accounts
        (id, dormitories_id, bank_name, bank_logo, account_number, account_name)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
        bankId,
        dormId,
        bank_name,
        bank_logo || null,
        account_number,
        account_name || null
    ).run();

    return c.json({ success:true, bank_id:bankId },201);
});

banks.patch('/payment-note/:id',
    requireDormitoryAccess,
    requireRole(['owner']),
    async (c) => {

    const db = c.env.DB;
    const dormId = c.req.param('id');
    const { payment_note } = await c.req.json();

    await db.prepare(`
        UPDATE dormitories
        SET payment_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(payment_note, dormId).run();

    return c.json({ success:true });
});

banks.delete('/:dormitoryId/:bankId',
  requireDormitoryAccess,
  requireRole(['owner']),
  async (c) => {
    const db = c.env.DB;
    const bankId = c.req.param('bankId');

    await db.prepare(`
      DELETE FROM bank_accounts
      WHERE id = ?
    `).bind(bankId).run();

    return c.json({ success: true });
});
export default banks