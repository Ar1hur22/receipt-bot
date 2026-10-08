// Receipt bot: photo to Telegram -> Claude reads it -> filed in Google Drive (+ emailed to Hubdoc).
// Settings live in Project Settings > Script properties (see README.md). Run setup() once.

// Run once by hand: creates the Drive folders and the every-minute check.
// ponytail: kept first in the file so it's the editor's default in the Run menu.
function setup() {
  tg('deleteWebhook', {}); // getUpdates only works when no webhook is set
  rootFolder();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(1).create();
  console.log('Bot is on: checking Telegram every minute.');
}

const P = PropertiesService.getScriptProperties();
const cfg = k => (P.getProperty(k) || '').trim();
const list = k => cfg(k).split(',').map(s => s.trim()).filter(Boolean);

const SUPPORTED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };

const PROMPT = `Read this Australian receipt or invoice. The photo may be sideways, upside down or shadowed: read it in whatever orientation it is. Return:
- date: the transaction date as YYYY-MM-DD (Australian receipts write dates day-first, e.g. 07/10/26 or 07OCT26 is 7 October 2026)
- vendor: the business name, short and clean (e.g. "Officeworks", not "OFFICEWORKS PTY LTD SYDNEY 2000")
- total: the final amount charged including GST (the TOTAL / AMOUNT line, not a single item), digits and 2 decimals only (e.g. "45.20")
- gst: the GST amount the same way, or "" if none shown
- card_last4: the last 4 digits of the card used, if printed
Use "" for anything you cannot read clearly. Never guess.`;

const SCHEMA = {
  type: 'object',
  properties: { date: { type: 'string' }, vendor: { type: 'string' }, total: { type: 'string' }, gst: { type: 'string' }, card_last4: { type: 'string' } },
  required: ['date', 'vendor', 'total', 'gst', 'card_last4'],
  additionalProperties: false,
};

// ponytail: polls every minute instead of a webhook; Apps Script web apps answer Telegram with a
// redirect, which makes Telegram resend messages. Up to ~1 min delay is fine for receipts.
function poll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // previous run still working
  try {
    const updates = tg('getUpdates', { offset: Number(cfg('OFFSET') || 0), timeout: 0, allowed_updates: ['message'] });
    for (const u of updates) {
      P.setProperty('OFFSET', String(u.update_id + 1)); // mark first, so a receipt is never filed twice
      if (u.message) handleMessage(u.message);
    }
  } finally {
    lock.releaseLock();
  }
}

function handleMessage(m) {
  const chat = String(m.chat.id);
  if (!cfg('CHAT_ID')) return send(chat, `Your chat ID is ${chat}. Add it to Script properties as CHAT_ID, then send receipts.`);
  if (chat !== cfg('CHAT_ID')) return; // anyone else who finds the bot is ignored

  try {
    if (!m.photo && !m.document) {
      if (m.reply_to_message || parseNote(m.text).entity) return fixUnsure(m);
      return reply(m, 'Send a photo or PDF of the receipt.');
    }
    const blob = download(m);

    const r = extractReceipt(blob);
    const read = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : ''; // anything odd counts as unread
    const last4 = r.card_last4.replace(/\D/g, '').slice(-4); // "**** 1234" -> "1234"
    const entity = pickEntity(m.caption, last4, list('TRUST_CARDS'), list('COMPANY_CARDS'));
    const date = read || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const fy = fyName(date);
    const dateLabel = read ? date : date + ' (date unread)';
    const ext = SUPPORTED[blob.getContentType()];
    const name = fileName(dateLabel, parseNote(m.caption).vendor || r.vendor, r.total, ext);
    const file = folderFor(entity, fy).createFile(blob.setName(name));

    if (entity === 'Unsure') {
      const sent = reply(m, `Saved to Unsure: ${name}\nSend t (trust) or c (company) to file it. Add the shop name to fix it, e.g. "Aldi c".`);
      // You can reply to the bot's message, to your own photo, or just send t/c for the latest one.
      const keys = ['fix_' + sent.message_id, 'fix_' + m.message_id];
      const saved = JSON.stringify({ id: file.getId(), fy, keys, dateLabel, total: r.total, ext });
      keys.forEach(k => P.setProperty(k, saved));
      P.setProperty('LAST_UNSURE', saved);
    } else {
      sendToHubdoc(entity, file);
      reply(m, `✓ ${entity} · ${name}`);
    }
  } catch (err) {
    console.error(err);
    reply(m, `⚠️ Not saved: ${err.message}\nPlease send it again.`);
  }
}

// You sent "t"/"c" (plus an optional shop name): as a reply, or on its own for the latest Unsure receipt.
function fixUnsure(m) {
  const saved = m.reply_to_message ? cfg('fix_' + m.reply_to_message.message_id) : cfg('LAST_UNSURE');
  if (!saved) return reply(m, 'Nothing waiting in Unsure to file.');
  const { entity, vendor } = parseNote(m.text);
  if (!entity) return reply(m, 'Send t (trust) or c (company), e.g. "Aldi c".');
  const s = JSON.parse(saved);
  const file = DriveApp.getFileById(s.id);
  if (vendor && s.ext) file.setName(fileName(s.dateLabel, vendor, s.total, s.ext));
  file.moveTo(folderFor(entity, s.fy));
  sendToHubdoc(entity, file);
  s.keys.forEach(k => P.deleteProperty(k)); // so it can't be filed (or sent to Xero) twice
  if (cfg('LAST_UNSURE') === saved) P.deleteProperty('LAST_UNSURE');
  reply(m, `✓ Moved to ${entity} · ${file.getName()}`);
}

function download(m) {
  let fileId, mime;
  if (m.photo) [fileId, mime] = [m.photo[m.photo.length - 1].file_id, 'image/jpeg']; // last = largest size
  else if (m.document) [fileId, mime] = [m.document.file_id, m.document.mime_type];
  else return null;
  if (!SUPPORTED[mime]) throw new Error(`can't read ${mime} files. Send it as a photo or PDF.`);
  const path = tg('getFile', { file_id: fileId }).file_path;
  return UrlFetchApp.fetch(`https://api.telegram.org/file/bot${cfg('TELEGRAM_TOKEN')}/${path}`).getBlob().setContentType(mime);
}

function extractReceipt(blob) {
  const mime = blob.getContentType();
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': cfg('CLAUDE_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 8000, // room for thinking before the answer
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: mime === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mime, data: Utilities.base64Encode(blob.getBytes()) } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  const j = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('Claude: ' + (j.error ? j.error.message : res.getResponseCode()));
  if (j.stop_reason !== 'end_turn') throw new Error('Claude stopped early (' + j.stop_reason + ')');
  return JSON.parse(j.content.find(b => b.type === 'text').text);
}

// "Aldi, c" -> { entity: 'Company', vendor: 'Aldi' }. A t/c word anywhere; the other words fix the shop name.
function parseNote(text) {
  const WORDS = { t: 'Trust', trust: 'Trust', c: 'Company', co: 'Company', company: 'Company' };
  let entity = '';
  const rest = (text || '').split(/[\s,]+/).filter(w => {
    const e = WORDS[w.toLowerCase()];
    if (e) entity = e;
    return w && !e;
  });
  return { entity, vendor: rest.join(' ') };
}

// Caption wins, then card digits, else Unsure. Never forces a guess.
function pickEntity(caption, last4, trustCards, companyCards) {
  const { entity } = parseNote(caption);
  if (entity) return entity;
  if (last4 && trustCards.includes(last4)) return 'Trust';
  if (last4 && companyCards.includes(last4)) return 'Company';
  return 'Unsure';
}

// Australian financial year: 1 July to 30 June.
function fyName(isoDate) {
  const [y, mo] = isoDate.split('-').map(Number);
  const start = mo >= 7 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(2)}`;
}

function fileName(date, vendor, total, ext) {
  const v = (vendor || 'Unknown vendor').replace(/[\\/:*?"<>|]/g, '').trim();
  return `${date} ${v}${total ? ' $' + total : ''}.${ext}`;
}

function rootFolder() {
  const id = cfg('ROOT_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const f = DriveApp.createFolder('Receipts');
  P.setProperty('ROOT_FOLDER_ID', f.getId());
  return f;
}

function folderFor(entity, fy) {
  return child(child(rootFolder(), entity), fy);
}

function child(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sendToHubdoc(entity, file) {
  const to = cfg(entity === 'Trust' ? 'TRUST_HUBDOC_EMAIL' : 'COMPANY_HUBDOC_EMAIL');
  if (!to) return; // Hubdoc not set up for this entity yet; Drive copy still saved
  MailApp.sendEmail(to, file.getName(), 'Receipt from receipt bot.', { attachments: [file.getBlob()] });
}

function tg(method, payload) {
  const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${cfg('TELEGRAM_TOKEN')}/${method}`, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  const j = JSON.parse(res.getContentText());
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

const send = (chat, text, replyTo) => tg('sendMessage', { chat_id: chat, text, reply_to_message_id: replyTo });
const reply = (m, text) => send(m.chat.id, text, m.message_id);

// Run from the editor: checks the sorting rules without touching Drive, Telegram or Claude.
function selfTest() {
  const eq = (a, b) => { if (a !== b) throw new Error(`expected "${b}", got "${a}"`); };
  eq(fyName('2026-06-30'), 'FY2025-26');
  eq(fyName('2026-07-01'), 'FY2026-27');
  eq(fyName('2027-01-15'), 'FY2026-27');
  eq(pickEntity('c', '1111', ['1111'], ['2222']), 'Company'); // caption beats card
  eq(pickEntity('Trust lunch', '', [], []), 'Trust');
  eq(pickEntity('', '2222', ['1111'], ['2222']), 'Company');
  eq(pickEntity('', '9999', ['1111'], ['2222']), 'Unsure');
  eq(pickEntity('cat food', '', [], []), 'Unsure'); // only whole words count
  eq(pickEntity('Aldi, c', '1111', ['1111'], []), 'Company');
  eq(parseNote('Aldi, c').vendor, 'Aldi');
  eq(parseNote('t Bunnings Warehouse').vendor, 'Bunnings Warehouse');
  eq(parseNote('hello').entity, '');
  eq(fileName('2026-10-07', 'Officeworks', '45.20', 'jpg'), '2026-10-07 Officeworks $45.20.jpg');
  eq(fileName('2026-10-07', 'A/B: Co', '', 'pdf'), '2026-10-07 AB Co.pdf');
  console.log('selfTest passed');
}
