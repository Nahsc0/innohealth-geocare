const REGISTRY_TAB = 'Account credentials';
const REGISTRY_HEADERS = ['account_id', 'account_type', 'encrypted_verifier', 'created_at_utc', 'updated_at_utc'];
const ACTIVITY_TAB = 'Sign-in activity';
const ACTIVITY_HEADERS = ['event_id', 'account_id', 'account_role', 'signed_in_at_utc'];

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
  if (['status', 'read_facilities'].includes(request.action)) return request;
  if (request.action === 'record_sign_ins') {
    const roles = ['individual', 'admin', 'analyst', 'clinician', 'dispatcher', 'responder'];
    if (!Array.isArray(request.events) || !request.events.length || request.events.length > 16) return null;
    return request.events.every(event => event && typeof event.event_id === 'string' && /^[a-f0-9]{32}$/.test(event.event_id)
      && typeof event.account_id === 'string' && /^[a-f0-9]{32}$/.test(event.account_id)
      && roles.includes(event.account_role) && Number.isSafeInteger(event.signed_in)
      && event.signed_in > 0 && event.signed_in <= request.timestamp) ? request : null;
  }
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

function recordSignIns(workbook, events) {
  const sheet = workbook.getSheetByName(ACTIVITY_TAB);
  const headers = sheet.getRange(1, 1, 1, ACTIVITY_HEADERS.length).getValues()[0];
  if (!ACTIVITY_HEADERS.every((header, index) => header === headers[index])) return false;
  const lastRow = sheet.getLastRow();
  const idColumn = lastRow < 2 ? null : sheet.getRange(2, 1, lastRow - 1, 1);
  const unique = new Set();
  const values = [];
  for (const event of events) {
    if (unique.has(event.event_id)) continue;
    unique.add(event.event_id);
    if (idColumn?.createTextFinder(event.event_id).matchEntireCell(true).findNext()) continue;
    values.push([event.event_id, event.account_id, event.account_role, new Date(event.signed_in * 1000).toISOString()]);
  }
  if (values.length) {
    const needed = lastRow + values.length - sheet.getMaxRows();
    if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(needed, 100));
    sheet.getRange(lastRow + 1, 1, values.length, ACTIVITY_HEADERS.length).setNumberFormat('@').setValues(values);
    SpreadsheetApp.flush();
  }
  return true;
}

function connectedSheetStatus(workbook) {
  function hasHeaders(name, expected) {
    const sheet = workbook.getSheetByName(name);
    if (!sheet) return false;
    const headers = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
    return expected.every((header, index) => headers[index] === header);
  }
  const facilities = workbook.getSheetByName('Facilities');
  return jsonResponse({ok: true,
    registry: hasHeaders(REGISTRY_TAB, REGISTRY_HEADERS),
    activity: hasHeaders(ACTIVITY_TAB, ACTIVITY_HEADERS),
    facilities: Boolean(facilities && facilities.getLastRow() > 1),
    email: MailApp.getRemainingDailyQuota() > 0,
  });
}

function facilityValues(workbook) {
  const sheet = workbook.getSheetByName('Facilities');
  if (!sheet || sheet.getLastRow() > 1001 || sheet.getLastColumn() > 15) return jsonResponse({ok: false});
  const zone = workbook.getSpreadsheetTimeZone();
  const values = sheet.getDataRange().getValues().map(row=>row.map(value=>
    value instanceof Date ? Utilities.formatDate(value, zone, 'yyyy-MM-dd') : value));
  return jsonResponse({ok: true, values});
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
      const workbook = SpreadsheetApp.openById(properties.getProperty('SPREADSHEET_ID'));
      if (request.action === 'status') return connectedSheetStatus(workbook);
      if (request.action === 'read_facilities') return facilityValues(workbook);
      if (request.action === 'record_sign_ins') return jsonResponse({ok: recordSignIns(workbook, request.events)});
      const sheet = workbook.getSheetByName(REGISTRY_TAB);
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
