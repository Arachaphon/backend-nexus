import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { hashPassword, verifyPassword } from '../utils/hash'
import { D1Database } from '@cloudflare/workers-types' 

const auth = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

auth.post('/register', async (c) => { 
    try {
        const { username, email, password, phoneNumber } = await c.req.json();
        const db = c.env.DB;

        const hashed = await hashPassword(password) 

        await db.prepare(`
            INSERT INTO profiles (id, username, email, password, phone_number)
            VALUES (?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), username, email, hashed, phoneNumber).run();

        return c.json({ success: true }, 201);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
})

auth.post('/login', async (c) => { 
    try {
        const { username, password } = await c.req.json();
        const db = c.env.DB;

        const user = await db.prepare(
            "SELECT * FROM profiles WHERE username = ? OR email = ?"
        ).bind(username, username).first();

        const isValid = user 
            ? await verifyPassword(password, user.password as string) 
            : false

        if (!isValid) {
            return c.json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
        }

        // 🎫 สร้าง JWT หลังจาก verify ผ่าน
        const payload = {
            id: user!.id,
            username: user!.username,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        }
        const token = await sign(payload, c.env.JWT_SECRET)

        return c.json({ 
            success: true, 
            user: { id: user!.id, username: user!.username },
            token: token 
        }, 200);

    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
})

export default auth