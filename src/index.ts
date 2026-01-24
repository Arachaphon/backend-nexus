import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import profileRoutes from './routes/profile'
//import dormitoryRoutes from './routes/dormitory'

const app = new Hono()

app.use('*', cors())

// เชื่อมต่อ Routes (Path จะต่อกันโดยอัตโนมัติ)
app.route('/api/auth', authRoutes)    
app.route('/api/profile', profileRoutes) 
//app.route('/api/dormitory', dormitoryRoutes)

export default app