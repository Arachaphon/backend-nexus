import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'


const tenants = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

tenants.use('/*', authMiddleware)

export default tenants;