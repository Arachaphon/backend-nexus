import { Hono } from 'hono'

import contractsRoutes from './contract'
import tenantRoutes from './tenant'
import advancesRoutes from './advanceRent'

const rentals = new Hono()

// route หลักของ Rental
rentals.route('/contracts', contractsRoutes)
rentals.route('/tenants', tenantRoutes)
rentals.route('/advances', advancesRoutes)

export default rentals;