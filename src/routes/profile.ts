import { Hono } from 'hono'
import { hashPassword, verifyPassword } from '../utils/hash'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../utils/authMiddleware'

const profile = new Hono<{ Bindings: { DB: D1Database } }>()

profile.use('/*', authMiddleware)

profile.get('/', async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const userId = payload.id;

    const db = c.env.DB;
    const user = await db.prepare(
      "SELECT username, email FROM profiles WHERE id = ?"
    ).bind(userId).first();

    return c.json(user);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 2. UPDATE Profile (แก้ไขข้อมูล)
profile.patch('/', async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const userId = payload.id;

    const { name, email } = await c.req.json();
    const db = c.env.DB;

    await db.prepare(
      "UPDATE profiles SET username = ?, email = ? WHERE id = ?"
    ).bind(name, email, userId).run();

    return c.json({ success: true });

  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. UPDATE Password (เปลี่ยนรหัสผ่าน)
profile.patch('/password', async (c) => {
  try {
    const payload = c.get('jwtPayload');
    const userId = payload.id;

    const { currentPassword, newPassword } = await c.req.json();
    const db = c.env.DB;

    const user = await db.prepare(
      "SELECT password FROM profiles WHERE id = ?"
    ).bind(userId).first();

    const isValid = user
      ? await verifyPassword(currentPassword, user.password as string)
      : false;

    if (!isValid) {
      return c.json({ success: false, message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, 401);
    }

    const hashed = await hashPassword(newPassword);

    await db.prepare(
      "UPDATE profiles SET password = ? WHERE id = ?"
    ).bind(hashed, userId).run();

    return c.json({ success: true });

  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

export default profile;