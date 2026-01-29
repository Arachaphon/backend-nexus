import { Hono } from 'hono'
const utilities = new Hono<{ Bindings: { DB: D1Database } }>()

utilities.post('/save-settings', async (c) => {
    try {
        const db = c.env.DB;
        const { dormitoryId, water, electric } = await c.req.json();

        const waterStmt = db.prepare(`
            INSERT INTO water_rate_templates (id, dormitories_id, charge_type, price_per_unit, minimum_charge, flat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dormitories_id) DO UPDATE SET
                charge_type = EXCLUDED.charge_type,
                price_per_unit = EXCLUDED.price_per_unit,
                minimum_charge = EXCLUDED.minimum_charge,
                flat_rate = EXCLUDED.flat_rate
        `).bind(
            crypto.randomUUID(),
            dormitoryId,
            water.type,
            (water.type === 'meter_actual' || water.type === 'meter_min') ? Number(water.price) : null,
            (water.type === 'meter_min') ? Number(water.min) : null,
            (water.type === 'flat_rate') ? Number(water.price) : null
        );

        const electricStmt = db.prepare(`
            INSERT INTO electric_rate_templates (id, dormitories_id, charge_type, price_per_unit, minimum_charge, flat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dormitories_id) DO UPDATE SET
                charge_type = EXCLUDED.charge_type,
                price_per_unit = EXCLUDED.price_per_unit,
                minimum_charge = EXCLUDED.minimum_charge,
                flat_rate = EXCLUDED.flat_rate
        `).bind(
            crypto.randomUUID(),
            dormitoryId,
            electric.type,
            (electric.type === 'meter_actual' || electric.type === 'meter_min') ? Number(electric.price) : null,
            (electric.type === 'meter_min') ? Number(electric.min) : null,
            (electric.type === 'flat_rate') ? Number(electric.price) : null
        );

        await db.batch([waterStmt, electricStmt]);
        return c.json({ success: true }, 200);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

export default utilities;