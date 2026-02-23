import { Hono } from 'hono'

import mainRoutes from './main'
import utilitiesRoutes from './utility'
import banksRoutes from './bank'
import floorsRoutes from './floor'
import roomsRoutes from './room'

const dormitory = new Hono()

// route หลักของ dormitory
dormitory.route('/', mainRoutes)
dormitory.route('/utilities', utilitiesRoutes)
dormitory.route('/banks', banksRoutes)
dormitory.route('/floors', floorsRoutes)
dormitory.route('/rooms', roomsRoutes)

export default dormitory;