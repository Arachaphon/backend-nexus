import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const advances = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

advances.use('/*', authMiddleware)

advances.get('/:dormitoryId/contract/:contractId',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),
    async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')

    const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`)
        .bind(contractId).first()

    if (!contract) {
        return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }

    const result = await db.prepare(`
        SELECT * FROM advance_rent_payments
        WHERE contract_id = ?
        ORDER BY billing_month ASC
    `).bind(contractId).all()

    return c.json({ success: true, data: result.results })
})

advances.post('/:dormitoryId',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']), 
    async (c) => {
    const db = c.env.DB
    const body = await c.req.json()

    const {
        contract_id,
        billing_month,
        description,
        amount,
        payment_type,
        note,
    } = body

    // --- Validate required fields ---
    if (!contract_id || !billing_month || !description || amount == null || !payment_type) {
        return c.json({ error: 'กรุณากรอกข้อมูลให้ครบ' }, 400)
    }

    if (!['เงินสด', 'โอนเงินธนาคาร'].includes(payment_type)) {
        return c.json({ error: 'payment_type ต้องเป็น "เงินสด" หรือ "โอนเงินธนาคาร"' }, 400)
    }

    if (Number(amount) < 0) {
        return c.json({ error: 'จำนวนเงินต้องไม่ติดลบ' }, 400)
    }

    // --- ตรวจสอบว่า contract มีอยู่จริง ---
    const contract = await db.prepare(`SELECT id FROM contracts WHERE id = ?`)
        .bind(contract_id).first()

    if (!contract) {
        return c.json({ error: 'ไม่พบสัญญาที่ระบุ' }, 404)
    }

    // --- INSERT advance_rent_payments ---
    const id = crypto.randomUUID()

    await db.prepare(`
        INSERT INTO advance_rent_payments (
            id, contract_id,
            billing_month, description,
            amount, payment_type, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id,
        contract_id,
        billing_month,
        description,
        Number(amount),
        payment_type,
        note ?? null
    ).run()

    const record = await db.prepare(`
        SELECT * FROM advance_rent_payments WHERE id = ?
    `).bind(id).first()

    return c.json({ success: true, data: record }, 201)
})

export default advances