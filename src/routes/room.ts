import { Hono } from 'hono'

const rooms = new Hono<{ Bindings: { DB: D1Database } }>()

// ในไฟล์ room.ts ส่วน POST /room-setup
rooms.post('/room-setup', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const { dormitoryId, floors: floorList } = body;

        const statements = [];

        const validRoomIds = floorList.flatMap((f: any) => f.rooms.map((r: any) => r.id));
        const validFloorIds = floorList.map((f: any) => f.id);

        if (validRoomIds.length > 0) {
            const placeholders = validRoomIds.map(() => '?').join(',');
            statements.push(
                db.prepare(`
                    DELETE FROM rooms 
                    WHERE floor_id IN (SELECT id FROM floors WHERE dormitories_id = ?)
                    AND id NOT IN (${placeholders})
                `).bind(dormitoryId, ...validRoomIds)
            );
        }

        if (validFloorIds.length > 0) {
            const floorPlaceholders = validFloorIds.map(() => '?').join(',');
            statements.push(
                db.prepare(`
                    DELETE FROM floors 
                    WHERE dormitories_id = ? AND id NOT IN (${floorPlaceholders})
                `).bind(dormitoryId, ...validFloorIds)
            );
        }

        for (const f of floorList) {
            statements.push(
                db.prepare(`
                    INSERT INTO floors (id, dormitories_id, floor_number, room_count)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET 
                        floor_number = excluded.floor_number, 
                        room_count = excluded.room_count
                `).bind(f.id, dormitoryId, f.floorNumber, f.rooms.length)
            );

            for (const r of f.rooms) {
                statements.push(
                    db.prepare(`
                        INSERT INTO rooms (id, floor_id, room_number, is_active, status, current_rent_price)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET 
                            room_number = excluded.room_number,
                            is_active = excluded.is_active
                    `).bind(r.id, f.id, r.number, r.isActive ? 1 : 0, 'vacant', 0)
                );
            }
        }
        
        await db.batch(statements);
        return c.json({ success: true, message: 'บันทึกข้อมูลสำเร็จ' });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

rooms.get('/get-rooms/:dormitoryId', async (c) => {
    try {
        const db = c.env.DB;
        const dormitoryId = c.req.param('dormitoryId');
        
        const result = await db.prepare(`
            SELECT r.* FROM rooms r
            JOIN floors f ON r.floor_id = f.id
            WHERE f.dormitories_id = ?
        `).bind(dormitoryId).all();

        return c.json({ success: true, data: result.results });
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
});

export default rooms;