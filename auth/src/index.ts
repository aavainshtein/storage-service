import { execSync } from 'child_process'
import express from 'express'
import morgan from 'morgan'
import hasura from './hasura'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './auth'

if (!process.env.POSTGRES_CONNECTION_STRING)
  throw new Error('Env POSTGRES_CONNECTION_STRING is not set')

if (!process.env.DOMAIN) throw new Error('Env DOMAIN is not set')
if (!process.env.AUTH_TRUSTED_ORIGINS)
  throw new Error('Env AUTH_TRUSTED_ORIGINS is not set')
if (!process.env.AUTH_URL) throw new Error('Env AUTH_URL is not set')
if (!process.env.AUTH_SECRET) throw new Error('Env AUTH_SECRET is not set')
if (!process.env.AUTH_USE_SECURE_COOKIES)
  throw new Error('Env AUTH_USE_SECURE_COOKIES is not set')

execSync(`npm run migrate`)

const PORT = 3000
const app = express()

app.use(morgan('dev', { skip: (req) => req.url === '/healthz' }))

app.use(express.urlencoded({ extended: true }))
app.disable('x-powered-by')

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok')
})

app.get('/hasura', hasura)
app.all('/api/auth/*action', toNodeHandler(auth))

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})
