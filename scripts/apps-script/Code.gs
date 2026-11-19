const REGISTRY_TAB = 'Account credentials';
const REGISTRY_HEADERS = ['account_id', 'account_type', 'encrypted_verifier', 'created_at_utc', 'updated_at_utc'];

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function signatureMatches(actual, expected) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function signedRequest(event, secret) {
  if (!secret || secret.length < 32 || !event?.postData?.contents || event.postData.contents.length > 4096) return null;
  const {payload, signature} = JSON.parse(event.postData.contents);
  if (typeof payload !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const expected = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
  if (!signatureMatches(signature, expected)) return null;
  const request = JSON.parse(payload);
  if (!Number.isInteger(request.timestamp) || Math.abs(Date.now() / 1000 - request.timestamp) > 90) return null;
  if (typeof request.account !== 'string' || !/^[a-f0-9]{32}$/.test(request.account)) return null;
  if (typeof request.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(request.nonce)) return null;
  if (request.action === 'read') return request;
  if (request.action === 'send_code') {
    const validRecipient = typeof request.recipient === 'string' && request.recipient.length <= 254
      && /^[^@\s,;<>]+@[^@\s,;<>.]+(?:\.[^@\s,;<>.]+)+$/.test(request.recipient);
    return validRecipient && typeof request.code === 'string' && /^[0-9]{6}$/.test(request.code) ? request : null;
  }
  if (request.action !== 'store' || !['individual', 'partner'].includes(request.kind)) return null;
  if (typeof request.verifier !== 'string' || !/^gAAAA[A-Za-z0-9_-]{100,700}={0,2}$/.test(request.verifier)) return null;
  return request;
}

function doPost(event) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const request = signedRequest(event, properties.getProperty('REGISTRY_SECRET'));
    if (!request) return jsonResponse({ok: false});
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return jsonResponse({ok: false});
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get(request.nonce)) return jsonResponse({ok: false});
      cache.put(request.nonce, '1', 185);
      if (request.action === 'send_code') {
        if (MailApp.getRemainingDailyQuota() < 1) return jsonResponse({ok: false});
        MailApp.sendEmail({to: request.recipient, subject: 'Your GeoCare verification code',
          name: 'InnoHealth GeoCare', body: 'Your GeoCare verification code is ' + request.code +
          '. It expires in 10 minutes. If you did not request an account, you can ignore this email.'});
        return jsonResponse({ok: true});
      }
      const sheet = SpreadsheetApp.openById(properties.getProperty('SPREADSHEET_ID')).getSheetByName(REGISTRY_TAB);
      const lastRow = sheet.getLastRow();
      const headers = sheet.getRange(1, 1, 1, REGISTRY_HEADERS.length).getValues()[0];
      if (!REGISTRY_HEADERS.every((header, index) => header === headers[index])) return jsonResponse({ok: false});
      const match = lastRow < 2 ? null : sheet.getRange(2, 1, lastRow - 1, 1)
        .createTextFinder(request.account).matchEntireCell(true).findNext();
      if (request.action === 'read') {
        return match ? jsonResponse({ok: true, verifier: sheet.getRange(match.getRow(), 3).getValue()}) : jsonResponse({ok: false});
      }
      const timestamp = new Date().toISOString();
      if (match) {
        const row = match.getRow();
        const [kind, , created] = sheet.getRange(row, 2, 1, 3).getValues()[0];
        if (kind !== request.kind) return jsonResponse({ok: false});
        sheet.getRange(row, 3, 1, 3).setValues([[request.verifier, created, timestamp]]);
      } else {
        if (lastRow === sheet.getMaxRows()) sheet.insertRowsAfter(lastRow, 100);
        sheet.getRange(lastRow + 1, 1, 1, REGISTRY_HEADERS.length).setNumberFormat('@')
          .setValues([[request.account, request.kind, request.verifier, timestamp, timestamp]]);
      }
      SpreadsheetApp.flush();
      return jsonResponse({ok: true});
    } finally {
      lock.releaseLock();
    }
  } catch (_) {
    return jsonResponse({ok: false});
  }
}
