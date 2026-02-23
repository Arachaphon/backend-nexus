import { Hono } from 'hono'
import { D1Database } from '@cloudflare/workers-types'
import { authMiddleware } from '../../utils/authMiddleware'


const contracts = new Hono<{ Bindings: { DB: D1Database, JWT_SECRET: string } }>()

contracts.use('/*', authMiddleware)

export default contracts;