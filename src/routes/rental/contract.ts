import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const contracts = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

contracts.use('/*', authMiddleware)

// GET /api/rentals/contracts/dormitories/:dormitoryId
contracts.get('/dormitories/:dormitoryId', 
    requireDormitoryAccess, 
    requireRole(['owner', 'manager']),
    async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')

    const result = await db.prepare(`
        SELECT c.*
        FROM contracts c
        JOIN rooms r ON r.id = c.room_id
        JOIN floors f ON r.floor_id = f.id
        JOIN dormitories d ON f.dormitories_id = d.id
        WHERE d.id = ?
        ORDER BY r.room_number ASC
    `).bind(dormitoryId).all()

    return c.json({ success: true, data: result.results })
})

// GET /api/rentals/contracts/dormitories/:dormitoryId/rooms/:roomId
contracts.get(
'/dormitories/:dormitoryId/rooms/:roomId',
requireDormitoryAccess,
requireRole(['owner','manager']),
async (c) => {

    const db = c.env.DB
    const roomId = c.req.param('roomId')

    const result = await db.prepare(`
        SELECT *
        FROM contracts
        WHERE room_id = ?
        ORDER BY check_in_date DESC
    `)
    .bind(roomId)
    .all()

    return c.json({
        success: true,
        data: result.results
    })
})

// GET /api/rental/contracts/:contractId
contracts.get('/dormitories/:dormitoryId/:contractId',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),
    async (c) => {
    const db = c.env.DB
    const contractId = c.req.param('contractId')

    const contract = await db.prepare(`SELECT * FROM contracts WHERE id = ?`).bind(contractId).first()
    if (!contract) {
        return c.json({ error: 'ไม่พบสัญญา' }, 404)
    }

    const tenants = await db.prepare(`
        SELECT t.*, ct.is_primary
        FROM contract_tenants ct
        JOIN tenants t ON t.id = ct.tenant_id
        WHERE ct.contract_id = ?
    `).bind(contractId).all()

    return c.json({ success: true, data: { ...contract, tenants: tenants.results } })
})

contracts.post('/',
    requireDormitoryAccess,
    requireRole(['owner', 'manager']),      
    async (c) => {
    const db = c.env.DB
    const body = await c.req.json()

    const {
        room_id,
        check_in_date,
        check_out_date,
        rent_price,
        security_deposit,
        security_deposit_type,
        booking_fee,
        tenant,
    } = body

    // --- Validate ---
    if (!room_id || !check_in_date || rent_price == null || security_deposit == null || !security_deposit_type) {
        return c.json({ error: 'กรุณากรอกข้อมูลสัญญาให้ครบ' }, 400)
    }
    if (!tenant?.first_name || !tenant?.last_name || !tenant?.phone_number || !tenant?.id_card_or_passport) {
        return c.json({ error: 'กรุณากรอกข้อมูลผู้เช่าให้ครบ' }, 400)
    }
    if (!['เงินสด', 'โอนเงินธนาคาร'].includes(security_deposit_type)) {
        return c.json({ error: 'security_deposit_type ต้องเป็น "เงินสด" หรือ "โอนเงินธนาคาร"' }, 400)
    }

    // --- ตรวจสอบห้องว่าว่างอยู่ไหม ---
    const room = await db.prepare(`SELECT id, status FROM rooms WHERE id = ?`).bind(room_id).first<{ id: string; status: string }>()
    if (!room) {
        return c.json({ error: 'ไม่พบห้องที่ระบุ' }, 404)
    }
    if (room.status !== 'vacant') {
        return c.json({ error: 'ห้องนี้ไม่ว่าง ไม่สามารถสร้างสัญญาได้' }, 409)
    }

    // --- สร้าง tenant ---
    const tenantId = crypto.randomUUID()
    await db.prepare(`
        INSERT INTO tenants (
            id, first_name, last_name,
            phone_number, id_card_or_passport,
            address,
            emergency_contact_name,
            emergency_contact_relation,
            emergency_contact_phone,
            note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        tenantId,
        tenant.first_name, tenant.last_name,
        tenant.phone_number, tenant.id_card_or_passport,
        tenant.address ?? null,
        tenant.emergency_contact_name ?? null,
        tenant.emergency_contact_relation ?? null,
        tenant.emergency_contact_phone ?? null,
        tenant.note ?? null
    ).run()

    // --- สร้าง contract ---
    const contractId = crypto.randomUUID()
    await db.prepare(`
        INSERT INTO contracts (
            id, room_id,
            check_in_date, check_out_date,
            rent_price,
            security_deposit, security_deposit_type,
            booking_fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        contractId,
        room_id,
        check_in_date,
        check_out_date ?? null,
        rent_price,
        security_deposit,
        security_deposit_type,
        booking_fee ?? 0
    ).run()

    // --- ผูก tenant กับ contract (is_primary = 1) ---
    const ctId = crypto.randomUUID()
    await db.prepare(`
        INSERT INTO contract_tenants (id, contract_id, tenant_id, is_primary)
        VALUES (?, ?, ?, 1)
    `).bind(ctId, contractId, tenantId).run()

    // --- อัพเดตสถานะห้องเป็น occupied ---
    await db.prepare(`
        UPDATE rooms SET status = 'occupied', current_rent_price = ? WHERE id = ?
    `).bind(rent_price, room_id).run()

    return c.json({
        success: true,
        data: {
            contract_id: contractId,
            tenant_id: tenantId,
        }
    }, 201)
})

export default contracts