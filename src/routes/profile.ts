import { Hono } from 'hono'

const profile = new Hono<{ Bindings: { DB: D1Database } }>()

profile.get('/', async (c) => {
  const userId = c.req.query('id');
  if (!userId) return c.json({ error: "Missing user ID" }, 400);

  try {
    const db = c.env.DB;
    const user = await db.prepare("SELECT username, email FROM profiles WHERE id = ?")
      .bind(userId).first();
    return c.json(user);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
})

// 2. UPDATE Profile (แก้ไขข้อมูล)
// ในไฟล์ src/routes/profile.ts
profile.post('/update', async (c) => {
  try {
    const { name, email, userId } = await c.req.json(); // Frontend ส่ง 'name' มา
    const db = c.env.DB;
    
    // ต้องอัปเดตที่ Column 'username' (ตามที่ตั้งไว้ใน profiles table)
    await db.prepare("UPDATE profiles SET username = ?, email = ? WHERE id = ?")
      .bind(name, email, userId).run();
      
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
})

// 3. UPDATE Password (เปลี่ยนรหัสผ่าน)
profile.post('/change-password', async (c) => {
  try {
    const { userId, currentPassword, newPassword } = await c.req.json();
    const db = c.env.DB;

    // 1. ตรวจสอบรหัสผ่านเดิม
    const user = await db.prepare("SELECT password FROM profiles WHERE id = ?")
      .bind(userId).first();

    if (!user || user.password !== currentPassword) {
      return c.json({ success: false, message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, 401);
    }

    // 2. อัปเดตรหัสผ่านใหม่
    await db.prepare("UPDATE profiles SET password = ? WHERE id = ?")
      .bind(newPassword, userId).run();

    return c.json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
})

export default profile;