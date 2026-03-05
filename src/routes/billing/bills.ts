import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'
import { requireDormitoryAccess } from '../../utils/dormitoryAccess'
import { requireRole } from '../../utils/roleMiddleware'

const bills = new Hono<{ Bindings: { DB: D1Database } }>()

bills.use('/*', authMiddleware)

/* GET ALL dormitory*/
bills.get('/:dormitoryId/bills',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const month = c.req.query('month') // format: YYYY-MM (optional)

    // validate month format ถ้าส่งมา
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'Invalid month format. Use YYYY-MM' }, 400)
    }

    let query = `
      SELECT
        b.id,
        b.bill_date,
        b.payment_status,
        b.rent_price,
        b.water_usage_units,
        b.electric_usage_units,
        b.water_charge,
        b.electric_charge,
        b.total_amount,
        b.note,
        b.created_at,
        r.room_number,
        f.floor_number,
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

    if (month) {
      query += ` AND strftime('%Y-%m', b.bill_date) = ?`
      bindings.push(month)
    }

    query += ` ORDER BY b.bill_date DESC, f.floor_number ASC, r.room_number ASC`

    const { results } = await db.prepare(query).bind(...bindings).all()

    return c.json({ success: true, data: results })
  }
)

/*GET BILL BY BILL ID */
bills.get('/:dormitoryId/bills/:billId',
  requireDormitoryAccess,
  requireRole(['owner', 'manager']),
  async (c) => {
    const db = c.env.DB
    const dormitoryId = c.req.param('dormitoryId')
    const billId = c.req.param('billId')

    const bill = await db.prepare(`
      SELECT
        b.id,
        b.bill_date,
        b.payment_status,
        b.rent_price,
        b.water_usage_units,
        b.electric_usage_units,
        b.water_charge,
        b.electric_charge,
        b.total_amount,
        b.note,
        b.created_at,
        -- ข้อมูลห้อง
        r.id         AS room_id,
        r.room_number,
        f.floor_number,
        -- อัตราค่าน้ำ
        wt.charge_type        AS water_charge_type,
        wt.price_per_unit     AS water_price_per_unit,
        wt.minimum_charge     AS water_minimum_charge,
        wt.flat_rate          AS water_flat_rate,
        -- อัตราค่าไฟ
        et.charge_type        AS electric_charge_type,
        et.price_per_unit     AS electric_price_per_unit,
        et.minimum_charge     AS electric_minimum_charge,
        et.flat_rate          AS electric_flat_rate
      FROM bills b
      JOIN rooms r ON b.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      JOIN water_rate_templates wt ON b.water_template_id = wt.id
      JOIN electric_rate_templates et ON b.electric_template_id = et.id
      WHERE b.id = ?
      AND f.dormitories_id = ?
    `).bind(billId, dormitoryId).first()

    if (!bill) {
      return c.json({ success: false, error: 'Bill not found' }, 404)
    }

    const { results: tenants } = await db.prepare(`
      SELECT
        t.id,
        t.first_name,
        t.last_name,
        t.phone_number,
        ct.is_primary
      FROM bills b
      JOIN contracts c2 ON b.contract_id = c2.id
      JOIN contract_tenants ct ON c2.id = ct.contract_id
      JOIN tenants t ON ct.tenant_id = t.id
      WHERE b.id = ?
      ORDER BY ct.is_primary DESC
    `).bind(billId).all()

    return c.json({
      success: true,
      data: {
        ...bill,
        tenants
      }
    })
  }
)

export default bills

/*
GET /api/dormitories/:dormitoryId/bills
GET /api/dormitories/:dormitoryId/bills?month=2025-03
GET /api/dormitories/:dormitoryId/bills/:billId
*/