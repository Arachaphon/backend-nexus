import { Hono } from 'hono'
import { authMiddleware } from '../utils/authMiddleware'

const floors = new Hono<{ Bindings: { DB: D1Database } }>()

floors.use('/*', authMiddleware)
floors.post('/floor-setup', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const { dormitoryId, floors: floorList } = body;

        if (!dormitoryId || !floorList || !Array.isArray(floorList)) {
            return c.json({ success: false, message: "ข้อมูลไม่ครบถ้วน" }, 400);
        }

        const statements = [];

        statements.push(db.prepare(`
            DELETE FROM rooms WHERE floor_id IN (SELECT id FROM floors WHERE dormitories_id = ?)
        `).bind(dormitoryId));

        statements.push(db.prepare(`
            DELETE FROM floors WHERE dormitories_id = ?
        `).bind(dormitoryId));

        for (const f of floorList) {
            const floorId = crypto.randomUUID();
            
            statements.push(
                db.prepare(`
                    INSERT INTO floors (id, dormitories_id, floor_number, room_count, created_at)
                    VALUES (?, ?, ?, ?, ?)
                `).bind(floorId, dormitoryId, f.floor_number, f.room_count, new Date().toISOString())
            );

            for (let i = 1; i <= f.room_count; i++) {
                const roomNumber = `${f.floor_number}${i.toString().padStart(2, '0')}`;
                statements.push(
                    db.prepare(`
                        INSERT INTO rooms (id, floor_id, room_number, is_active, status, current_rent_price)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).bind(crypto.randomUUID(), floorId, roomNumber, 1, 'vacant', 0) 
                );
            }
        }
        await db.batch(statements);

        return c.json({ success: true, message: 'บันทึกชั้นและสร้างห้องเริ่มต้นเรียบร้อย' }, 201);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

floors.get('/get-floors/:dormitoryId', async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('dormitoryId');
        
        const result = await db.prepare(
            `SELECT id, floor_number FROM floors WHERE dormitories_id = ? ORDER BY floor_number ASC`
        ).bind(dormitoryId).all();

        return c.json({ success: true, data: result.results });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

//floors.patch('/update-floor/:id') --> room_count
export default floors;