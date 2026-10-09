// Passenger startup file for the cPanel Node.js app ("Application startup file": app.js). Installed by the deploy
// script into the application root; it loads the private environment and starts the current release.
const path = require('node:path')

process.loadEnvFile(path.join(__dirname, '.env'))
process.env.NODE_ENV = 'production'
// Passenger supplies the listening socket; a fixed loopback name keeps Next.js from binding to the machine hostname.
process.env.HOSTNAME = '127.0.0.1'

require('./current/server.js')
