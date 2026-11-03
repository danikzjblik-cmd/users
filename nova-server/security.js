const crypto = require('crypto');

// Secret key for HMAC payload signature validation
const SERVER_SECRET = 'NOVA_CORE_SECURITY_KEY_984729487928734982734987239487';

class Security {
  /**
   * Generates a deterministic Hardware ID hash from raw components
   */
  static hashHWID(rawHwid) {
    if (!rawHwid || typeof rawHwid !== 'string') {
      return null;
    }
    return crypto.createHmac('sha256', SERVER_SECRET).update(rawHwid.trim()).digest('hex');
  }

  /**
   * Verifies an anti-tamper payload signed with HMAC
   */
  static verifySignature(payload, signature, timestamp) {
    const now = Date.now();
    // Allow up to 60 seconds clock drift
    if (Math.abs(now - parseInt(timestamp, 10)) > 60000) {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(`${timestamp}:${JSON.stringify(payload)}`)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  /**
   * Signs a server response for anti-crack loader integrity
   */
  static signResponse(data) {
    const timestamp = Date.now();
    const signature = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(`${timestamp}:${JSON.stringify(data)}`)
      .digest('hex');

    return {
      timestamp,
      signature,
      data
    };
  }

  /**
   * Encrypts sensitive bytecode / payload sent to the loader
   */
  static encryptPayload(plainText) {
    const iv = crypto.randomBytes(16);
    const key = crypto.createHash('sha256').update(SERVER_SECRET).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return {
      iv: iv.toString('hex'),
      payload: encrypted
    };
  }
}

module.exports = Security;
