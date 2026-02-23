import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import profileRoutes from './routes/profile'
import dormitoryRoutes from './routes/dormitory/index'
import contractsRoutes from './routes/rental/contract'
//import tennantsRoutes from './routes/rental/tennant'

const app = new Hono()

app.use('*', cors())

app.route('/api/auth', authRoutes)    
app.route('/api/profile', profileRoutes) 
app.route('/api/dormitories', dormitoryRoutes)
app.route('/api/contracts', contractsRoutes)
//app.route('/api/tennants', tennantsRoutes)

export default app