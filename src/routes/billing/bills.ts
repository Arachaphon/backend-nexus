import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const bills = new Hono<{ Bindings: { DB: D1Database } }>()

bills.use('/*', authMiddleware)

// ────────────────────────────────────────────────────────────
// helper: คำนวณค่าน้ำ/ค่าไฟ รองรับ 3 charge_type
//   meter_actual / per_unit  → usage × price_per_unit
//   meter_min                → max(usage × price_per_unit, minimum_charge)
//   flat_rate                → flat_rate (ไม่ขึ้นกับหน่วย)
// ────────────────────────────────────────────────────────────
function calcCharge(tpl: any, usage: number): number {
  const type = tpl.charge_type as string
  if (type === 'flat_rate') return tpl.flat_rate ?? 0
  if (type === 'meter_actual' || type === 'per_unit') {
    return usage * (tpl.price_per_unit ?? 0)
  }
  if (type === 'meter_min') {
    const charge = usage * (tpl.price_per_unit ?? 0)
    const min    = tpl.minimum_charge ?? 0
    return charge < min ? min : charge
  }
  return 0
}

// ────────────────────────────────────────────────────────────

bills.get('/:dormitoryId/bills',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const month = c.req.query('month')

    if (month && !/^\d{4}-\d{2}$/.test(month))
      return c.json({ success: false, error: 'Invalid month. Use YYYY-MM' }, 400)

    let query = `
      SELECT
        b.id, b.bill_date, b.payment_status,
        b.rent_price, b.water_usage_units, b.electric_usage_units,
        b.water_charge, b.electric_charge, b.total_amount,
        b.note, b.created_at,
        r.room_number, f.floor_number,
        t.first_name || ' ' || t.last_name AS primary_tenant_name
      FROM bills b
      JOIN rooms r ON b.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      LEFT JOIN contracts c2 ON b.contract_id = c2.id
      LEFT JOIN contract_tenants ct ON c2.id = ct.contract_id AND ct.is_primary = 1
      LEFT JOIN tenants t ON ct.tenant_id = t.id
      WHERE f.dormitories_id = ?
    `
    const bindings: any[] = [dormitoryId]
    if (month) { query += ` AND strftime('%Y-%m', b.bill_date) = ?`; bindings.push(month) }
    query += ` ORDER BY b.bill_date DESC, f.floor_number ASC, r.room_number ASC`

    const { results } = await db.prepare(query).bind(...bindings).all()
    return c.json({ success: true, data: results })
  }
)


bills.get('/:dormitoryId/bills/:billId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager', 'staff']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const billId = c.req.param('billId')

    const bill = await db.prepare(`
      SELECT
        b.id, b.bill_date, b.payment_status,
        b.rent_price, b.water_usage_units, b.electric_usage_units,
        b.water_charge, b.electric_charge, b.total_amount,
        b.note, b.created_at,
        r.id AS room_id, r.room_number, f.floor_number,
        wt.charge_type AS water_charge_type,
        wt.price_per_unit AS water_price_per_unit,
        wt.minimum_charge AS water_minimum_charge,
        wt.flat_rate AS water_flat_rate,
        et.charge_type AS electric_charge_type,
        et.price_per_unit AS electric_price_per_unit,
        et.minimum_charge AS electric_minimum_charge,
        et.flat_rate AS electric_flat_rate
      FROM bills b
      JOIN rooms r ON b.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      JOIN water_rate_templates wt ON b.water_template_id = wt.id
      JOIN electric_rate_templates et ON b.electric_template_id = et.id
      WHERE b.id = ? AND f.dormitories_id = ?
    `).bind(billId, dormitoryId).first() as any

    if (!bill) return c.json({ success: false, error: 'Bill not found' }, 404)

    const { results: tenants } = await db.prepare(`
      SELECT t.id, t.first_name, t.last_name, t.phone_number, ct.is_primary
      FROM bills b
      JOIN contracts c2 ON b.contract_id = c2.id
      JOIN contract_tenants ct ON c2.id = ct.contract_id
      JOIN tenants t ON ct.tenant_id = t.id
      WHERE b.id = ?
      ORDER BY ct.is_primary DESC
    `).bind(billId).all()

    // ── ดึงค่าซ่อมที่ completed ของห้องนี้ภายในเดือนเดียวกับบิล ──
    const billMonth = (bill.bill_date as string).slice(0, 7) // YYYY-MM
    const { results: repairs } = await db.prepare(`
      SELECT id, details, complete_details, complete_date, cost
      FROM repair_requests
      WHERE room_id = ?
        AND status = 'completed'
        AND strftime('%Y-%m', complete_date) = ?
      ORDER BY complete_date ASC
    `).bind(bill.room_id, billMonth).all()

    return c.json({ success: true, data: { ...bill, tenants, repairs } })
  }
)

bills.post('/:dormitoryId/bills/from-meter',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const body = await c.req.json()
    const { room_id, reading_date, bill_month } = body

    if (!room_id || !reading_date || !bill_month)
      return c.json({ success: false, error: 'room_id, reading_date, bill_month required' }, 400)
    if (!/^\d{4}-\d{2}$/.test(bill_month))
      return c.json({ success: false, error: 'Invalid bill_month. Use YYYY-MM' }, 400)

    const room = await db.prepare(`
      SELECT r.id, r.current_rent_price, r.status, r.room_number
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE r.id = ? AND f.dormitories_id = ?
    `).bind(room_id, dormitoryId).first() as any
    if (!room) return c.json({ success: false, error: 'Room not found' }, 404)

    const contract = await db.prepare(`
      SELECT id FROM contracts WHERE room_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(room_id).first<{ id: string }>()

    const existing = await db.prepare(`
      SELECT id FROM bills
      WHERE room_id = ? AND strftime('%Y-%m', bill_date) = ?
    `).bind(room_id, bill_month).first()
    if (existing) return c.json({ success: false, error: 'Bill already exists for this month' }, 409)

    const meter = await db.prepare(`
      SELECT id, water_unit_current, electric_unit_current,
             water_unit_previous, electric_unit_previous
      FROM meter_readings
      WHERE room_id = ? AND DATE(reading_date) = DATE(?)
      LIMIT 1
    `).bind(room_id, reading_date).first() as any
    if (!meter)
      return c.json({ success: false, error: `ไม่พบข้อมูลมิเตอร์วันที่ ${reading_date} สำหรับห้องนี้` }, 400)

    // ── ถ้าไม่มีข้อมูลครั้งก่อน (เดือนแรก) → ไม่คิดค่าน้ำ/ไฟ ──
    const hasPrevWater    = meter.water_unit_previous    != null
    const hasPrevElectric = meter.electric_unit_previous != null
    const waterUsage    = hasPrevWater    ? meter.water_unit_current    - meter.water_unit_previous    : 0
    const electricUsage = hasPrevElectric ? meter.electric_unit_current - meter.electric_unit_previous : 0

    if (waterUsage < 0 || electricUsage < 0)
      return c.json({ success: false, error: 'เลขมิเตอร์ปัจจุบันน้อยกว่าครั้งก่อน กรุณาตรวจสอบ' }, 400)

    const waterTpl = await db.prepare(`
      SELECT * FROM water_rate_templates WHERE dormitories_id = ?
    `).bind(dormitoryId).first() as any
    const electricTpl = await db.prepare(`
      SELECT * FROM electric_rate_templates WHERE dormitories_id = ?
    `).bind(dormitoryId).first() as any
    if (!waterTpl || !electricTpl)
      return c.json({ success: false, error: 'ยังไม่ได้ตั้งค่าอัตราค่าน้ำ/ค่าไฟ' }, 400)

    const waterCharge    = hasPrevWater    ? calcCharge(waterTpl,    waterUsage)    : 0
    const electricCharge = hasPrevElectric ? calcCharge(electricTpl, electricUsage) : 0

    const rentPrice   = room.current_rent_price ?? 0
    const totalAmount = rentPrice + waterCharge + electricCharge
    const billId      = crypto.randomUUID()

    await db.prepare(`
      INSERT INTO bills (
        id, room_id, contract_id, bill_date,
        water_template_id, electric_template_id,
        rent_price, water_usage_units, electric_usage_units,
        water_charge, electric_charge, total_amount,
        payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      billId, room_id, contract?.id ?? null, reading_date,
      waterTpl.id, electricTpl.id,
      rentPrice, waterUsage, electricUsage,
      waterCharge, electricCharge, totalAmount
    ).run()

    return c.json({
      success: true,
      data: {
        bill_id:         billId,
        room_number:     room.room_number ?? '',
        rent_price:      rentPrice,
        water_usage:     waterUsage,
        electric_usage:  electricUsage,
        water_charge:    waterCharge,
        electric_charge: electricCharge,
        total_amount:    totalAmount,
        note: !hasPrevWater || !hasPrevElectric
          ? 'เดือนแรก: ไม่มีข้อมูลมิเตอร์ก่อนหน้า ไม่คิดค่าน้ำ/ค่าไฟ' : undefined,
      }
    }, 201)
  }
)

bills.post('/:dormitoryId/bills/from-meter-all',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const { reading_date, bill_month } = await c.req.json()

    if (!reading_date || !bill_month)
      return c.json({ success: false, error: 'reading_date and bill_month required' }, 400)
    if (!/^\d{4}-\d{2}$/.test(bill_month))
      return c.json({ success: false, error: 'Invalid bill_month. Use YYYY-MM' }, 400)

    const waterTpl = await db.prepare(`
      SELECT * FROM water_rate_templates WHERE dormitories_id = ?
    `).bind(dormitoryId).first() as any
    const electricTpl = await db.prepare(`
      SELECT * FROM electric_rate_templates WHERE dormitories_id = ?
    `).bind(dormitoryId).first() as any
    if (!waterTpl || !electricTpl)
      return c.json({ success: false, error: 'ยังไม่ได้ตั้งค่าอัตราค่าน้ำ/ค่าไฟ' }, 400)

    const { results: meters } = await db.prepare(`
      SELECT
        mr.id AS meter_id, mr.room_id, mr.contract_id,
        mr.water_unit_current,    mr.electric_unit_current,
        mr.water_unit_previous,   mr.electric_unit_previous,
        r.current_rent_price,     r.status
      FROM meter_readings mr
      JOIN rooms r ON mr.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE f.dormitories_id = ? AND DATE(mr.reading_date) = DATE(?)
    `).bind(dormitoryId, reading_date).all() as any

    let created = 0, skipped = 0
    const errors: string[] = []

    for (const m of meters) {
      if (m.status !== 'occupied') { skipped++; continue }

      const existing = await db.prepare(`
        SELECT id FROM bills
        WHERE room_id = ? AND strftime('%Y-%m', bill_date) = ?
      `).bind(m.room_id, bill_month).first()
      if (existing) { skipped++; continue }

      // ── ถ้าไม่มีข้อมูลครั้งก่อน (เดือนแรก) → ไม่คิดค่าน้ำ/ไฟ ──
      const hasPrevWater    = m.water_unit_previous    != null
      const hasPrevElectric = m.electric_unit_previous != null
      const waterUsage    = hasPrevWater    ? m.water_unit_current    - m.water_unit_previous    : 0
      const electricUsage = hasPrevElectric ? m.electric_unit_current - m.electric_unit_previous : 0

      if (waterUsage < 0 || electricUsage < 0) {
        errors.push(`room ${m.room_id}: เลขมิเตอร์ผิดพลาด`)
        skipped++; continue
      }

      const waterCharge    = hasPrevWater    ? calcCharge(waterTpl,    waterUsage)    : 0
      const electricCharge = hasPrevElectric ? calcCharge(electricTpl, electricUsage) : 0

      const rentPrice   = m.current_rent_price ?? 0
      const totalAmount = rentPrice + waterCharge + electricCharge
      const billId      = crypto.randomUUID()

      await db.prepare(`
        INSERT INTO bills (
          id, room_id, contract_id, bill_date,
          water_template_id, electric_template_id,
          rent_price, water_usage_units, electric_usage_units,
          water_charge, electric_charge, total_amount,
          payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(
        billId, m.room_id, m.contract_id ?? null, reading_date,
        waterTpl.id, electricTpl.id,
        rentPrice, waterUsage, electricUsage,
        waterCharge, electricCharge, totalAmount
      ).run()
      created++
    }

    return c.json({ success: true, data: { created, skipped, errors } })
  }
)

bills.patch('/:dormitoryId/bills/:billId/pay',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const billId = c.req.param('billId')
    const { payment_type, payment_date, note } = await c.req.json()

    if (!payment_type || !payment_date)
      return c.json({ success: false, error: 'payment_type and payment_date required' }, 400)

    const bill = await db.prepare(`
      SELECT b.id FROM bills b
      JOIN rooms r ON b.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE b.id = ? AND f.dormitories_id = ?
    `).bind(billId, dormitoryId).first()
    if (!bill) return c.json({ success: false, error: 'Bill not found' }, 404)

    await db.prepare(`
      UPDATE bills SET payment_status = 'paid', note = ? WHERE id = ?
    `).bind(note ?? null, billId).run()

    return c.json({ success: true, message: 'Bill marked as paid' })
  }
)

bills.patch('/:dormitoryId/bills/pay-all',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const month = c.req.query('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month))
      return c.json({ success: false, error: 'Valid month required (YYYY-MM)' }, 400)

    await db.prepare(`
      UPDATE bills SET payment_status = 'paid'
      WHERE id IN (
        SELECT b.id FROM bills b
        JOIN rooms r ON b.room_id = r.id
        JOIN floors f ON r.floor_id = f.id
        WHERE f.dormitories_id = ?
        AND strftime('%Y-%m', b.bill_date) = ?
        AND payment_status = 'pending'
      )
    `).bind(dormitoryId, month).run()

    return c.json({ success: true, message: 'All pending bills marked as paid' })
  }
)

// ── คำนวณบิลใหม่จากมิเตอร์ล่าสุด (เฉพาะ pending) ──
bills.patch('/:dormitoryId/bills/:billId/recalculate',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const billId = c.req.param('billId')

    // ดึงบิลพร้อมข้อมูลที่ต้องการ
    const bill = await db.prepare(`
      SELECT b.id, b.room_id, b.bill_date, b.payment_status,
             b.water_template_id, b.electric_template_id
      FROM bills b
      JOIN rooms r ON b.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      WHERE b.id = ? AND f.dormitories_id = ?
    `).bind(billId, dormitoryId).first() as any
    if (!bill) return c.json({ success: false, error: 'Bill not found' }, 404)
    if (bill.payment_status !== 'pending')
      return c.json({ success: false, error: 'ไม่สามารถอัปเดตบิลที่ชำระแล้ว' }, 400)

    // ดึงมิเตอร์ที่ตรงกับวันที่บิล
    const meter = await db.prepare(`
      SELECT water_unit_current, electric_unit_current,
             water_unit_previous, electric_unit_previous
      FROM meter_readings
      WHERE room_id = ? AND DATE(reading_date) = DATE(?)
      LIMIT 1
    `).bind(bill.room_id, bill.bill_date).first() as any
    if (!meter)
      return c.json({ success: false, error: 'ไม่พบข้อมูลมิเตอร์ของวันที่บิลนี้' }, 400)

    const hasPrevWater    = meter.water_unit_previous    != null
    const hasPrevElectric = meter.electric_unit_previous != null
    const waterUsage    = hasPrevWater    ? meter.water_unit_current    - meter.water_unit_previous    : 0
    const electricUsage = hasPrevElectric ? meter.electric_unit_current - meter.electric_unit_previous : 0

    if (waterUsage < 0 || electricUsage < 0)
      return c.json({ success: false, error: 'เลขมิเตอร์ผิดพลาด (ปัจจุบัน < ก่อนหน้า)' }, 400)

    const waterTpl = await db.prepare(`SELECT * FROM water_rate_templates WHERE id = ?`)
      .bind(bill.water_template_id).first() as any
    const electricTpl = await db.prepare(`SELECT * FROM electric_rate_templates WHERE id = ?`)
      .bind(bill.electric_template_id).first() as any
    if (!waterTpl || !electricTpl)
      return c.json({ success: false, error: 'ไม่พบข้อมูล rate template' }, 400)

    const waterCharge    = hasPrevWater    ? calcCharge(waterTpl,    waterUsage)    : 0
    const electricCharge = hasPrevElectric ? calcCharge(electricTpl, electricUsage) : 0

    const room = await db.prepare(`SELECT current_rent_price FROM rooms WHERE id = ?`)
      .bind(bill.room_id).first() as any
    const rentPrice   = room?.current_rent_price ?? 0
    const totalAmount = rentPrice + waterCharge + electricCharge

    await db.prepare(`
      UPDATE bills SET
        rent_price           = ?,
        water_usage_units    = ?,
        electric_usage_units = ?,
        water_charge         = ?,
        electric_charge      = ?,
        total_amount         = ?
      WHERE id = ?
    `).bind(rentPrice, waterUsage, electricUsage, waterCharge, electricCharge, totalAmount, billId).run()

    return c.json({
      success: true,
      message: 'อัปเดตบิลสำเร็จ',
      data: { water_usage: waterUsage, electric_usage: electricUsage, water_charge: waterCharge, electric_charge: electricCharge, total_amount: totalAmount }
    })
  }
)

bills.delete('/:dormitoryId/bills',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const month = c.req.query('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month))
      return c.json({ success: false, error: 'Valid month required (YYYY-MM)' }, 400)

    await db.prepare(`
      DELETE FROM bills WHERE id IN (
        SELECT b.id FROM bills b
        JOIN rooms r ON b.room_id = r.id
        JOIN floors f ON r.floor_id = f.id
        WHERE f.dormitories_id = ?
        AND strftime('%Y-%m', b.bill_date) = ?
      )
    `).bind(dormitoryId, month).run()

    return c.json({ success: true, message: 'Bills deleted' })
  }
)

export default bills