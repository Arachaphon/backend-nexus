import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'


const advance = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

advance.use('/*', authMiddleware)

export default advance;