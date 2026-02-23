import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'

const rooms = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

rooms.use('/*', async (c, next) => {
  const middleware = jwt({
    secret: c.env.JWT_SECRET,
    alg: 'HS256'
  });

  return middleware(c, next);
});

rooms.get('/:id', async (c) => {
  try {
    const db = c.env.DB;
    const roomId = c.req.param('id');
    const payload = c.get('jwtPayload');
    const ownerId = payload.id;

    const room = await db.prepare(`
      SELECT r.*
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      JOIN dormitories d ON f.dormitories_id = d.id
      WHERE r.id = ? AND d.owner_id = ?
    `)
    .bind(roomId, ownerId)
    .first();

    if (!room) {
      return c.json({ success: false, message: "ไม่พบข้อมูลห้อง" }, 404);
    }

    return c.json(room);
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

rooms.get('/:dormitoryId', async (c) => {
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

rooms.post('/', async (c) => {
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

rooms.patch('/', async (c) => {
  try {
    const db = c.env.DB;
    const body = await c.req.json();
    const { roomId, dormitoryId, price, status } = body

    const placeholders = roomId.map(() => '?').join(',');

    const { count } = await db.prepare(`
      SELECT COUNT(*) as count FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      WHERE f.dormitories_id = ? AND r.id IN (${placeholders})
    `).bind(dormitoryId, ...roomId).first() as { count: number };

    if (count !== roomId.length) {
      return c.json({ success: false, message: 'ข้อมูลไม่ถูกต้อง' }, 403);
    }

    // สร้าง dynamic update
    let query = `UPDATE rooms SET `;
    const updates: string[] = [];
    const values: any[] = [];

    if (price !== undefined) {
      updates.push(`current_rent_price = ?`);
      values.push(price);
    }

    if (status !== undefined) {
      updates.push(`status = ?`);
      values.push(status);
    }

    if (updates.length === 0) {
      return c.json({ success: false, message: 'ไม่มีข้อมูลให้อัปเดต' }, 400);
    }

    query += updates.join(', ') + ` WHERE id IN (${placeholders})`;

    await db.prepare(query).bind(...values, ...roomId).run();

    return c.json({ success: true });

  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

export default rooms;