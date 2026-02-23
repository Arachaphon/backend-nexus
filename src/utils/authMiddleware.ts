import { jwt } from 'hono/jwt'
import { Context, Next } from 'hono'

type Env = { Bindings: { JWT_SECRET: string } }

export const authMiddleware = async (c: Context<Env>, next: Next) => {
    const middleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' })
    return middleware(c, next)
}