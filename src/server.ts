import { ServerHeartbeatStartedEvent } from 'mongodb'
import initialiseFrontbase from './Scripts/Initialise'

const port = process.env.PORT || 8600

const express = require('express')
const app = express()
app.set('port', port)
const http = require('http').Server(app)
const jwt = require('jsonwebtoken')
const { MongoClient } = require('mongodb')
const client = new MongoClient('mongodb://localhost:27017')

var bcrypt = require('bcryptjs')

require('dotenv').config()
const whitelist = [
  'http://localhost:8600',
  'http://localhost:3000',
  process.env.PUBLICURL,
]

let serverState = 'initialising'

app.get('/', (req, res) => {
  res.send('<h1>Here comes the app</h1>')
})

// Main() initialises the server
// If the server has already been set-up we immediately start listening for socket connections
// Otherwise we perform the initial set-up and then start listening for socket connections
async function main() {
  await client.connect()
  console.log('Mongo connection succesful.')
  const db = client.db('FrontBase')
  const initialisedFlag = await db
    .collection('Objects')
    .findOne({ '_meta.modelId': 'User' })

  serverState = initialisedFlag ? 'ready' : 'uninitalised'
  if (serverState === 'uninitalised')
    serverState = await initialiseFrontbase(db)

  console.log('FrontBase is ready to go!')
  require('socket.io')(http, {
    cors: {
      credentials: true,
      origin: (origin, callback) => {
        if (!origin || whitelist.includes(origin)) return callback(null, true)
        callback(new Error('Socket blocked by CORS: ' + origin))
      },
    },
  })
    .use((socket, next) => {
      if (serverState === 'ready') {
        if (
          socket.handshake?.query?.token &&
          socket.handshake?.query?.token !== 'null'
        ) {
          jwt.verify(
            socket.handshake?.query?.token,
            process.env.SECRET,
            (err, decoded) => {
              if (err) {
                next()
              }
              socket.decoded = decoded
              next()
            }
          )
        } else {
          next()
        }
      } else {
        // Server is not set up yet. No authentication
        next()
      }
    })
    .on('connection', async (socket) => {
      if (serverState === 'ready') {
        // Server is in ready state
        if (socket.decoded) {
          // First, actually authenticate the user
          const db = client.db('FrontBase')
          const user = await db
            .collection('Objects')
            .findOne({ '_meta.modelId': 'User', username: socket.decoded.sub })
          if (user) {
            // Our connection with the user has been authenticated. From here on we can have our regular socket interaction.
            socket.user = user
            console.log(`User ${user.username} connected`)
            socket.emit('authenticated', { ...user, password: undefined })

            // Authenticated socket events
            // Get Objects
            socket.on('getObjects', async (modelId, filter, then) => {
              const result = await db
                .collection('Objects')
                .find({ ...filter, '_meta.modelId': modelId })
                .toArray()
              then({ success: true, data: result })
            })
          } else {
            console.error(`User ${socket.decoded.sub} not found`)
            socket.emit('authenticationError')
            return socket.disconnect()
          }
        } else {
          // User has no token
          // Client should render log-in form
          console.error(`Socket connected without authentication token`)
          socket.emit('authenticationError')
          socket.on('authenticate', async ({ username, password }) => {
            const user = await db
              .collection('Objects')
              .findOne({ '_meta.modelId': 'User', username })
            if (bcrypt.compareSync(password, user.password)) {
              console.log(`User ${username} authenticated`)
              socket.emit(
                'receive-token',
                jwt.sign({ sub: user.username }, process.env.SECRET, {
                  expiresIn: '7d',
                  issuer: 'FrontBase',
                })
              )
              return socket.disconnect()
            } else {
              console.log('Someone entered an incorrect password')
              socket.emit('authenticationError')
            }
          })
        }
      } else if (serverState === 'setup') {
        socket.emit('server-setup')
        socket.on('setup-server', async (data) => {
          // Set-up the server by creating the admin user
          // Todo: data integrity check to prevent injection
          db.collection('Objects').insertOne({
            _meta: { modelId: 'User' },
            username: data.user.username,
            password: bcrypt.hashSync(data.user.password, 8),
          })
          socket.emit('user-created')
          serverState = 'ready'
        })
      } else {
        console.log(`Server in unknown state ${serverState}`)
      }
    })

  return
}

main()
http.listen(port, () => {
  console.log(`FrontBase is now live on http://localhost:${port}`)
})
