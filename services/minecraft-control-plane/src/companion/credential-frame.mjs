const FRAME_MAGIC = Buffer.from('MFC1', 'ascii');
const MAX_FRAME_BYTES = 32 * 1024;
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/u;
const ACCESS_TOKEN = /^[\x21-\x7e]+$/u;
const XUID = /^[0-9]{1,20}$/u;

const FIELDS = Object.freeze([
  ['username', 16, USERNAME],
  ['uuid', 36, UUID],
  ['accessToken', 24 * 1024, ACCESS_TOKEN],
  ['xuid', 20, XUID],
  ['clientId', 36, UUID],
]);

function exactSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Minecraft launch credentials must be an exact private session');
  }
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || FIELDS.some(([key]) => !Object.hasOwn(value, key))) {
    throw new TypeError('Minecraft launch credentials must contain exactly the required private session fields');
  }
  return value;
}

export function encodeMinecraftCredentialFrame(value) {
  const session = exactSession(value);
  const encoded = [];
  let payloadLength = FRAME_MAGIC.length;
  try {
    for (const [key, maximumBytes, pattern] of FIELDS) {
      const field = session[key];
      if (typeof field !== 'string' || !pattern.test(field)) {
        throw new TypeError(`Minecraft launch credential field '${key}' is invalid`);
      }
      const bytes = Buffer.from(field, 'utf8');
      if (bytes.length < 1 || bytes.length > maximumBytes || bytes.length > 0xffff) {
        bytes.fill(0);
        throw new TypeError(`Minecraft launch credential field '${key}' is outside its size limit`);
      }
      encoded.push(bytes);
      payloadLength += 2 + bytes.length;
    }
    if (payloadLength > MAX_FRAME_BYTES) throw new TypeError('Minecraft launch credential frame is outside its size limit');
    const frame = Buffer.allocUnsafe(4 + payloadLength);
    frame.writeUInt32BE(payloadLength, 0);
    FRAME_MAGIC.copy(frame, 4);
    let offset = 4 + FRAME_MAGIC.length;
    for (const bytes of encoded) {
      frame.writeUInt16BE(bytes.length, offset);
      offset += 2;
      bytes.copy(frame, offset);
      offset += bytes.length;
    }
    return frame;
  } finally {
    for (const bytes of encoded) bytes.fill(0);
  }
}

export const MINECRAFT_CREDENTIAL_FRAME_MAX_BYTES = MAX_FRAME_BYTES;
