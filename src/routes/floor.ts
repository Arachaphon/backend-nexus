import { Hono } from 'hono'

const floors = new Hono<{ Bindings: { DB: D1Database } }>()

floors.post('/floor-setup', async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();
        const { dormitoryId, floors: floorList } = body;

        if (!dormitoryId || !floorList || !Array.isArray(floorList)) {
            return c.json({ success: false, message: "Missing dormitoryId or floors array" }, 400);
        }

        const deleteStmt = db.prepare(`DELETE FROM floors WHERE dormitories_id = ?`).bind(dormitoryId);

        const floorStatements = floorList.map((f: any) => {
            return db.prepare(`
                INSERT INTO floors (id, dormitories_id, floor_number, room_count, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).bind(
                crypto.randomUUID(), 
                dormitoryId,
                f.floor_number,
                f.room_count,
                new Date().toISOString()
            );
        });

        
        await db.batch([deleteStmt, ...floorStatements]);

        console.log(`Successfully saved ${floorStatements.length} floors for dormitory:`, dormitoryId);

        return c.json({
            success: true,
            message: 'บันทึกข้อมูลชั้นเรียบร้อยแล้ว',
            data: { count: floorStatements.length }
        }, 201);

    } catch (err: any) { 
        console.error("Error setting up floors:", err.message);
        return c.json({ 
            success: false, 
            message: "Database Error: " + err.message,
            stack: err.stack 
        }, 500);
    }
});

export default floors;