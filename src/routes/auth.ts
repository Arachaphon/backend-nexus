import { Hono } from 'hono'
import { sign } from 'hono/jwt'

const auth = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>()

auth.post('/register', async (c) => { 
    try {
        const { username, email, password, phoneNumber } = await c.req.json();
        const db = c.env.DB;
        await db.prepare(`
        INSERT INTO profiles (id, username, email, password, phone_number)
        VALUES (?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), username, email, password, phoneNumber).run();
        return c.json({ success: true }, 201);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
})
//test comite
auth.post('/login', async (c) => { 
    try {
        const { username, password } = await c.req.json();
        const db = c.env.DB;
        const user = await db.prepare("SELECT * FROM profiles WHERE username = ? OR email = ?")
        .bind(username, username).first();

        if (!user || user.password !== password) {
        return c.json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
        }
        const payload = {
            id: user.id,
            username: user.username,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, 
        }
        const token = await sign(payload, c.env.JWT_SECRET)
        return c.json({ 
            success: true, 
            user: { id: user.id, username: user.username },
            token: token 
        }, 200);
    } catch (err: any) {
        return c.json({ success: false, message: err.message }, 500);
    }
})

export default auth