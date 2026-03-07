import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import profileRoutes from './routes/profile'
import dormitoryRoutes from './routes/dormitory/index'
import ownerStaffRoutes from './routes/manager_account/staff'
import rentalRoutes from './routes/rental/index'
import meterRoutes from './routes/billing/meter'
import billRoutes from './routes/billing/bills'
const app = new Hono()

app.use('*', cors())

app.route('/api/auth', authRoutes)    
app.route('/api/profile', profileRoutes) 
app.route('/api/dormitories', dormitoryRoutes)
app.route('/api/staff', ownerStaffRoutes)
app.route('/api/rentals', rentalRoutes)
app.route('/api/meters', meterRoutes)
app.route('/api/bills', billRoutes)

export default app