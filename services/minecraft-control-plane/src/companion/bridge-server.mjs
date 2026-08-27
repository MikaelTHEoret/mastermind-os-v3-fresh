import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
  FAMILY_BRIDGE_SUBPROTOCOL,
  FamilyBridgeProtocolError,
} from './protocol.mjs';
import { CompanionSessionError } from './session-manager.mjs';

export const FAMILY_BRIDGE_PATH = '/v1/companion/bridge';

const TOKEN_TEXT = /^[A-Za-z0-9_-]{32,256}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORWARDED_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'];

function httpReject(socket, statusCode, reason, headers = {}) {
  if (socket.destroyed) return;
  const lines = [
    `HTTP/1.1 ${statusCode} ${reason}`,
    'Connection: close',
    'Cache-Control: no-store, max-age=0',
    'Content-Length: 0',
    'X-Content-Type-Options: nosniff',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ];
  try { socket.write(lines.join('\r\n')); }
  finally { socket.destroy(); }
}

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header);
  return match?.[1] ?? null;
}

function isLoopbackAddress(value) {
  return value === '127.0.0.1' || value === '::ffff:127.0.0.1';
}

function safeCloseReason(error) {
  const value = error?.code ?? 'bridge-policy';
  return String(value).toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 96) || 'bridge-policy';
}

export function safeProtocolDiagnostic(error) {
  if (!(error instanceof FamilyBridgeProtocolError)) return null;
  const match = /^([A-Za-z0-9_.-]{1,128}) (omitted required|contains unsupported) field '([A-Za-z0-9_.-]{1,64})'$/.exec(error.message);
  if (!match) return `Family AI bridge rejected a client frame (${safeCloseReason(error)}).`;
  return `Family AI bridge rejected a client frame (${safeCloseReason(error)}; location=${match[1]}; field=${match[3]}).`;
}

export function sha256BridgeToken(token) {
  if (typeof token !== 'string' || !TOKEN_TEXT.test(token)) throw new TypeError('Bridge token must contain 32-256 URL-safe characters');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSha256BridgeAuthenticator({ sessionId, tokenSha256, expectedPid = null }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new TypeError('A valid bridge session id is required');
  if (typeof tokenSha256 !== 'string' || !SHA256.test(tokenSha256)) throw new TypeError('A valid SHA-256 bridge token digest is required');
  if (expectedPid !== null && (!Number.isInteger(expectedPid) || expectedPid < 1 || expectedPid > 0xffffffff)) {
    throw new TypeError('expectedPid must be a valid process id');
  }
  const wanted = Buffer.from(tokenSha256.toLowerCase(), 'hex');
  return async ({ token }) => {
    if (typeof token !== 'string' || !TOKEN_TEXT.test(token)) return null;
    const actual = crypto.createHash('sha256').update(token, 'utf8').digest();
    if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) return null;
    return { sessionId: sessionId.toLowerCase(), expectedPid };
  };
}

export class CompanionBridgeServer {
  constructor({
    httpServer,
    sessionManager,
    authenticate,
    path = FAMILY_BRIDGE_PATH,
    livenessPollMs = 250,
    websocketPingMs = 5_000,
  } = {}) {
    if (!httpServer || typeof httpServer.on !== 'function' || typeof httpServer.address !== 'function') {
      throw new TypeError('An HTTP server is required');
    }
    if (!sessionManager || typeof sessionManager.attachConnection !== 'function' || typeof sessionManager.receive !== 'function') {
      throw new TypeError('A CompanionSessionManager is required');
    }
    if (typeof authenticate !== 'function') throw new TypeError('An explicit bridge authenticator is required');
    if (path !== FAMILY_BRIDGE_PATH) throw new TypeError(`Family bridge path must be exactly ${FAMILY_BRIDGE_PATH}`);
    if (!Number.isInteger(livenessPollMs) || livenessPollMs < 50 || livenessPollMs > 5_000) {
      throw new TypeError('livenessPollMs must be an integer between 50 and 5000');
    }
    if (!Number.isInteger(websocketPingMs) || websocketPingMs < 250 || websocketPingMs > 30_000) {
      throw new TypeError('websocketPingMs must be an integer between 250 and 30000');
    }
    this.httpServer = httpServer;
    this.sessionManager = sessionManager;
    this.authenticate = authenticate;
    this.path = path;
    this.livenessPollMs = livenessPollMs;
    this.websocketPingMs = websocketPingMs;
    this.started = false;
    this.livenessTimer = null;
    this.pingTimer = null;
    this.activeSocket = null;
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
      handleProtocols(protocols) {
        return protocols.size === 1 && protocols.has(FAMILY_BRIDGE_SUBPROTOCOL)
          ? FAMILY_BRIDGE_SUBPROTOCOL
          : false;
      },
    });
    this.handleUpgrade = this.#handleUpgrade.bind(this);
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.httpServer.on('upgrade', this.handleUpgrade);
    this.livenessTimer = setInterval(() => this.sessionManager.checkLiveness(), this.livenessPollMs);
    this.livenessTimer.unref?.();
    this.pingTimer = setInterval(() => this.#ping(), this.websocketPingMs);
    this.pingTimer.unref?.();
    return this;
  }

  async close() {
    if (!this.started) return;
    this.started = false;
    this.httpServer.off('upgrade', this.handleUpgrade);
    clearInterval(this.livenessTimer);
    clearInterval(this.pingTimer);
    this.livenessTimer = null;
    this.pingTimer = null;
    if (this.activeSocket) this.sessionManager.closeConnection(1001, 'bridge-server-closing');
    this.activeSocket = null;
    await new Promise((resolve) => {
      try { this.webSocketServer.close(resolve); }
      catch { resolve(); }
    });
  }

  async #handleUpgrade(request, socket, head) {
    try {
      if (!this.started) return httpReject(socket, 503, 'Service Unavailable');
      if (request.method !== 'GET' || request.url !== this.path) {
        // A second, independently authenticated WebSocket endpoint shares the
        // loopback HTTP server. Leave only that exact path to its own handler;
        // reject every other upgrade here so unknown sockets cannot linger.
        if (request.method === 'GET' && request.url === '/v1/family-core/bridge') return;
        return httpReject(socket, 404, 'Not Found');
      }
      if (!isLoopbackAddress(socket.remoteAddress)) return httpReject(socket, 403, 'Forbidden');
      if (request.headers.origin !== undefined) return httpReject(socket, 403, 'Forbidden');
      if (FORWARDED_HEADERS.some((name) => request.headers[name] !== undefined)) return httpReject(socket, 403, 'Forbidden');

      const address = this.httpServer.address();
      const loopbackBound = address && typeof address === 'object' && address.address === '127.0.0.1';
      const expectedHost = loopbackBound ? `127.0.0.1:${address.port}` : null;
      if (!expectedHost || request.headers.host !== expectedHost) return httpReject(socket, 403, 'Forbidden');
      if (request.headers['sec-websocket-protocol'] !== FAMILY_BRIDGE_SUBPROTOCOL) {
        return httpReject(socket, 426, 'Upgrade Required', { 'Sec-WebSocket-Protocol': FAMILY_BRIDGE_SUBPROTOCOL });
      }
      const token = bearerToken(request.headers.authorization);
      if (!token) return httpReject(socket, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      const authenticated = await this.authenticate({ token });
      if (!authenticated || typeof authenticated.sessionId !== 'string' || !SESSION_ID.test(authenticated.sessionId)) {
        return httpReject(socket, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' });
      }
      if (this.sessionManager.hasActiveConnection()) return httpReject(socket, 409, 'Conflict');

      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        try {
          if (this.sessionManager.hasActiveConnection()) {
            webSocket.close(4409, 'session-active');
            return;
          }
          this.activeSocket = webSocket;
          webSocket.isMastermindAlive = true;
          webSocket.on('pong', () => { webSocket.isMastermindAlive = true; });
          webSocket.on('message', (data, isBinary) => {
            if (isBinary) {
              webSocket.close(1003, 'text-json-required');
              this.sessionManager.disconnect(webSocket, { code: 1003, reason: 'binary-message' });
              return;
            }
            this.sessionManager.receive(data).catch((error) => {
              const closeCode = error instanceof FamilyBridgeProtocolError ? error.closeCode : 1011;
              const diagnostic = safeProtocolDiagnostic(error);
              if (diagnostic) console.warn(diagnostic);
              webSocket.close(closeCode, safeCloseReason(error));
              this.sessionManager.disconnect(webSocket, { code: closeCode, reason: safeCloseReason(error) });
            });
          });
          webSocket.once('close', (code, reason) => {
            if (this.activeSocket === webSocket) this.activeSocket = null;
            this.sessionManager.disconnect(webSocket, { code, reason: reason.toString('utf8') || 'connection-closed' });
          });
          webSocket.once('error', () => {
            if (this.activeSocket === webSocket) this.activeSocket = null;
            this.sessionManager.disconnect(webSocket, { code: 1006, reason: 'websocket-error' });
          });
          this.sessionManager.attachConnection(webSocket, {
            sessionId: authenticated.sessionId,
            expectedPid: authenticated.expectedPid ?? null,
          });
        } catch (error) {
          const code = error instanceof FamilyBridgeProtocolError
            ? error.closeCode
            : error instanceof CompanionSessionError && error.code === 'COMPANION_SESSION_ACTIVE'
              ? 4409
              : 1011;
          webSocket.close(code, safeCloseReason(error));
        }
      });
    } catch {
      httpReject(socket, 503, 'Service Unavailable');
    }
  }

  #ping() {
    const webSocket = this.activeSocket;
    if (!webSocket) return;
    if (webSocket.readyState !== WebSocket.OPEN) return;
    if (webSocket.isMastermindAlive === false) {
      webSocket.terminate();
      this.activeSocket = null;
      this.sessionManager.disconnect(webSocket, { code: 1006, reason: 'websocket-pong-timeout' });
      return;
    }
    webSocket.isMastermindAlive = false;
    try { webSocket.ping(); }
    catch {
      webSocket.terminate();
      this.activeSocket = null;
      this.sessionManager.disconnect(webSocket, { code: 1006, reason: 'websocket-ping-failed' });
    }
  }
}
