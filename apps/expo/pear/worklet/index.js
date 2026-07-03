/**
 * Pear lane worklet (Bare side) — A3.2 skeleton.
 *
 * REGENERATE THE CHECKED-IN BUNDLE after ANY edit to this file:
 *
 *   cd apps/expo && bun run pear:pack
 *
 * (wraps `apps/expo/scripts/pack-pear-worklet.mjs`, which shells out to
 * `bare-pack --linked --host <targets> --out pear/worklet/dist/index.bundle.js
 * pear/worklet/index.js`.) `src/pear/lane.ts` statically imports that
 * generated `dist/index.bundle.js` and hands it to `Worklet.start()` — this
 * source file is never loaded by the app directly, only by `bare-pack`.
 *
 * What this does, per docs.pears.com/how-to/run-on-native/embed-bare-in-react-native:
 *   `require('hyperswarm')`, join whichever topics RN asks for (server AND
 *   client by default — discoverable and dialing), and for every Noise
 *   connection that comes up, relay length-prefixed JSON frames verbatim
 *   between that socket and the RN IPC duplex. No challenge/response, no
 *   card/present protocol logic here — A3.3/A5 own that, entirely RN-side;
 *   this worklet is a dumb byte relay plus topic lifecycle.
 *
 * ONE HYPERSWARM INSTANCE PER JOINED TOPIC — not one shared swarm. Per
 * hyperswarm's own README ("Clients and Servers"): "When server
 * connections are emitted, they are not associated with a specific
 * topic — the server only knows it received an incoming connection" and
 * `peerInfo.topics` "will only be updated when the Peer is in client
 * mode". A single shared swarm handling multiple joined topics therefore
 * CANNOT reliably attribute a server-accepted connection to the topic it
 * came in on — there is no field to route on. Rather than guess (e.g.
 * "there's only one topic joined right now, assume it's that one" —
 * silently wrong the moment a second topic is joined), each `_join` spins
 * up its own `Hyperswarm()`, so `swarm.on('connection', ...)` is
 * inherently scoped to exactly the topic that swarm was constructed for.
 * Slightly heavier (one DHT node + UDP socket per topic) but correct.
 *
 * RN <-> worklet control protocol, over `BareKit.IPC`. Every message on
 * this channel — both directions — uses the SAME length-prefixed JSON
 * framing as the peer-to-peer Noise sockets (4-byte big-endian length +
 * UTF-8 JSON; see `src/pear/frames.ts`, which this file's `encodeFrame`/
 * `makeFramePump` deliberately mirror byte-for-byte since Bare can't
 * `require` a TS module):
 *
 *   RN -> worklet  {t:'_join',  topic, mode}   mode: 'server'|'client'|'both'
 *                                              (default 'both'). Idempotent
 *                                              per topic.
 *   RN -> worklet  {t:'_leave', topic}          leave a topic, close its
 *                                               open connections, destroy
 *                                               that topic's swarm.
 *   RN -> worklet  {t:'_send',  topic, frame}   broadcast `frame` verbatim
 *                                               to every open connection
 *                                               on `topic`.
 *   worklet -> RN  {t:'_ctrl', topic, ev, connId?, message?}
 *                    ev: 'joined' — swarm.join()'s discovery flushed (we're
 *                        announced/looking; does NOT mean a peer is
 *                        connected yet).
 *                    ev: 'open'   — a Noise connection opened for `topic`.
 *                    ev: 'close'  — that connection closed.
 *                    ev: 'error'  — join failed, DHT bootstrap timed out,
 *                        or a connection errored. `connId` present iff the
 *                        error is connection-scoped.
 *   worklet -> RN  {t:'_frame', topic, frame}   a JSON frame relayed
 *                                               verbatim from a peer on
 *                                               `topic`.
 *
 * Deliberately NOT handled here (OS backgrounding): `Worklet.suspend()` /
 * `.resume()` are host-side (`react-native-bare-kit`) lifecycle calls that
 * pause/resume the whole Bare thread — `src/pear/lifecycle.ts` calls
 * `LaneHandle.shutdown()` (== `worklet.terminate()`) on background instead
 * of a finer-grained in-worklet suspend, so there is nothing to wire up
 * here for A3.2. Revisit if A3.3 wants suspend-and-resume instead of
 * terminate-and-restart.
 */
'use strict'

const Hyperswarm = require('hyperswarm')

const { IPC } = BareKit

const HEADER_BYTES = 4
const MAX_FRAME_BYTES = 64 * 1024
/** How long to wait for `discovery.flushed()` before reporting the join as
 *  failed. DHT bootstrap needs real internet egress (UDP) — on a sandboxed
 *  simulator/CI network this legitimately times out, and the dev screen
 *  must show that honestly rather than sitting on "joining" forever. */
const JOIN_TIMEOUT_MS = 20_000

/** @type {Map<string, { swarm: import('hyperswarm'), connections: Map<number, import('net').Socket> }>} */
const topics = new Map()
let nextConnId = 1

// ---------------------------------------------------------------------
// Length-prefixed JSON framing — see the header comment. `makeFramePump`
// is instantiated once per byte stream (the RN IPC duplex, and once per
// peer socket) so a slow/adversarial peer on one topic/connection can
// never stall or corrupt decoding for RN control traffic or another
// topic — each pump owns its own buffering state.
// ---------------------------------------------------------------------

function encodeFrame(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8')
  const out = Buffer.allocUnsafe(HEADER_BYTES + json.length)
  out.writeUInt32BE(json.length, 0)
  json.copy(out, HEADER_BYTES)
  return out
}

function makeFramePump(onFrame, onError) {
  let buf = Buffer.alloc(0)
  let skipRemaining = 0

  return function pump(chunk) {
    buf = Buffer.concat([buf, chunk])

    for (;;) {
      if (skipRemaining > 0) {
        const take = Math.min(skipRemaining, buf.length)
        buf = buf.subarray(take)
        skipRemaining -= take
        if (skipRemaining > 0) return
        continue
      }

      if (buf.length < HEADER_BYTES) return

      const len = buf.readUInt32BE(0)

      if (len > MAX_FRAME_BYTES) {
        if (onError) onError(`frame of ${len} bytes exceeds the ${MAX_FRAME_BYTES}-byte cap`)
        buf = buf.subarray(HEADER_BYTES)
        skipRemaining = len
        continue
      }

      if (buf.length < HEADER_BYTES + len) return

      const payload = buf.subarray(HEADER_BYTES, HEADER_BYTES + len)
      buf = buf.subarray(HEADER_BYTES + len)

      let parsed
      try {
        parsed = JSON.parse(payload.toString('utf8'))
      } catch (error) {
        if (onError) onError('malformed JSON frame: ' + (error && error.message ? error.message : String(error)))
        continue
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (onError) onError('frame did not decode to a JSON object')
        continue
      }
      onFrame(parsed)
    }
  }
}

function sendToRN(obj) {
  try {
    IPC.write(encodeFrame(obj))
  } catch {
    // IPC already torn down (worklet terminating) — nothing to relay to.
  }
}

// ---------------------------------------------------------------------
// RN -> worklet control commands
// ---------------------------------------------------------------------

const pumpIpc = makeFramePump(
  (msg) => { handleCommand(msg) },
  () => { /* malformed command from RN — nothing useful to relay back on */ }
)

IPC.on('data', (chunk) => { pumpIpc(chunk) })

function handleCommand(msg) {
  if (msg.t === '_join' && typeof msg.topic === 'string') {
    joinTopic(msg.topic, msg.mode)
  } else if (msg.t === '_leave' && typeof msg.topic === 'string') {
    leaveTopic(msg.topic)
  } else if (msg.t === '_send' && typeof msg.topic === 'string' && msg.frame && typeof msg.frame === 'object') {
    broadcast(msg.topic, msg.frame)
  }
}

function attachConnection(topicHex, entry, socket) {
  const connId = nextConnId++
  entry.connections.set(connId, socket)
  sendToRN({ t: '_ctrl', topic: topicHex, ev: 'open', connId })

  const pumpSocket = makeFramePump(
    (frame) => { sendToRN({ t: '_frame', topic: topicHex, frame }) },
    (message) => { sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', connId, message }) }
  )
  socket.on('data', (chunk) => { pumpSocket(chunk) })

  socket.on('close', () => {
    entry.connections.delete(connId)
    sendToRN({ t: '_ctrl', topic: topicHex, ev: 'close', connId })
  })

  socket.on('error', (error) => {
    sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', connId, message: error && error.message ? error.message : String(error) })
  })
}

function joinTopic(topicHex, mode) {
  if (topics.has(topicHex)) return

  let topicBuf
  try {
    topicBuf = Buffer.from(topicHex, 'hex')
  } catch {
    sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', message: 'invalid topic hex' })
    return
  }
  if (topicBuf.length !== 32) {
    sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', message: 'topic must be 32 bytes (sha256 hex)' })
    return
  }

  const server = mode !== 'client'
  const client = mode !== 'server'

  const swarm = new Hyperswarm()
  const entry = { swarm, connections: new Map() }
  topics.set(topicHex, entry)

  swarm.on('connection', (socket) => { attachConnection(topicHex, entry, socket) })

  const discovery = swarm.join(topicBuf, { server, client })

  let settled = false
  const timeout = setTimeout(() => {
    if (settled) return
    settled = true
    sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', message: 'DHT bootstrap timed out' })
  }, JOIN_TIMEOUT_MS)

  discovery.flushed().then(
    () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      sendToRN({ t: '_ctrl', topic: topicHex, ev: 'joined' })
    },
    (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      sendToRN({ t: '_ctrl', topic: topicHex, ev: 'error', message: error && error.message ? error.message : String(error) })
    }
  )
}

function leaveTopic(topicHex) {
  const entry = topics.get(topicHex)
  if (!entry) return
  topics.delete(topicHex)
  for (const socket of entry.connections.values()) {
    try { socket.destroy() } catch { /* already closing */ }
  }
  try {
    entry.swarm.destroy().catch(() => {})
  } catch {
    // Already tearing down.
  }
}

function broadcast(topicHex, frame) {
  const entry = topics.get(topicHex)
  if (!entry || entry.connections.size === 0) return
  const encoded = encodeFrame(frame)
  for (const socket of entry.connections.values()) {
    try { socket.write(encoded) } catch { /* connection mid-teardown */ }
  }
}
