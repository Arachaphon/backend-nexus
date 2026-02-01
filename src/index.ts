import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import profileRoutes from './routes/profile'
import dormitoriesRoutes from './routes/dormitory'
import utilitiesRoutes from './routes/utility'
import banksRoutes from './routes/bank'
import floorsRoutes from './routes/floor'

const app = new Hono()

app.use('*', cors())

app.route('/api/auth', authRoutes)    
app.route('/api/profile', profileRoutes) 
app.route('/api/dormitories', dormitoriesRoutes)
app.route('/api/utilities', utilitiesRoutes)
app.route('/api/banks', banksRoutes)
app.route('/api/floors', floorsRoutes)


export default app