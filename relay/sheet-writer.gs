/**
 * Set by Set — sheet writer (Google Apps Script).
 *
 * The relay only READS. Google has no anonymous way to write to a sheet, so
 * writing has to run as somebody who actually holds edit rights. That is what
 * this is: a tiny web app deployed "Execute as: me", so every write it makes
 * carries the deploying account's permission on the spreadsheet.
 *
 * ── Who deploys it ───────────────────────────────────────────────────────────
 * Whoever can edit the sheet. If Rok has shared it with you as an Editor, you
 * can deploy it yourself. If you only have Viewer access, either ask him to
 * change you to Editor, or send him this file to deploy on his side — the code
 * is identical either way, only the account differs.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * 1. script.google.com → New project. Paste this in, replacing everything.
 * 2. Fill in SHEET_ID and TOKEN below.
 *      SHEET_ID is the long id in the sheet's URL, between /d/ and /edit.
 *      TOKEN is any long random string you invent. Keep it to yourself.
 * 3. Deploy → New deployment → type "Web app".
 *      Execute as:     Me
 *      Who has access: Anyone
 *    Deploy, approve the permission prompt, and copy the /exec URL.
 * 4. In the app: Connect Rok's sheet → Auto-fill the sheet → paste the /exec
 *    URL and the same TOKEN → Save.
 *
 * ── What it will and will not do ─────────────────────────────────────────────
 * It writes single cells that the app names by row and column, and nothing
 * else. It refuses to touch a cell that currently holds a formula, so Rok's
 * volume and percentage columns cannot be clobbered by a bad request. It only
 * ever opens the one spreadsheet named in SHEET_ID.
 *
 * ── Be aware ─────────────────────────────────────────────────────────────────
 * "Who has access: Anyone" means anyone who learns this URL *and* the token can
 * write to the sheet. Keep the token out of anything public — the app asks you
 * to type it in on the phone precisely so it never has to live in the source.
 * If you think it has leaked: change TOKEN here, redeploy, and update the app.
 */

var SHEET_ID = 'PASTE_THE_SHEET_ID_HERE';
var TOKEN = 'PASTE_A_LONG_RANDOM_STRING_HERE';

var MAX_EDITS = 2000;
var MAX_ROW = 20000;
var MAX_COL = 200;

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return out({ ok: false, error: 'The sheet was busy. Try again in a moment.' });
  }

  try {
    if (TOKEN === 'PASTE_A_LONG_RANDOM_STRING_HERE' || !TOKEN) {
      return out({ ok: false, error: 'The script still has its placeholder token. Edit TOKEN and redeploy.' });
    }
    if (!e || !e.postData || !e.postData.contents) {
      return out({ ok: false, error: 'Empty request.' });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return out({ ok: false, error: 'Body was not JSON.' });
    }

    if (body.token !== TOKEN) return out({ ok: false, error: 'Wrong token.' });
    if (body.sheetId && body.sheetId !== SHEET_ID) {
      return out({ ok: false, error: 'This writer is pinned to a different spreadsheet.' });
    }

    var edits = body.edits;
    if (!edits || !edits.length) return out({ ok: false, error: 'No cells to write.' });
    if (edits.length > MAX_EDITS) return out({ ok: false, error: 'Too many cells in one request.' });

    var ss;
    try {
      ss = SpreadsheetApp.openById(SHEET_ID);
    } catch (err) {
      return out({ ok: false, error: 'Cannot open that spreadsheet. The account this script runs as needs Editor access to it.' });
    }

    var written = 0, skipped = 0, tabs = {};

    for (var i = 0; i < edits.length; i++) {
      var ed = edits[i];
      var r = Number(ed.r), c = Number(ed.c);
      if (!(r >= 1 && r <= MAX_ROW && c >= 1 && c <= MAX_COL)) { skipped++; continue; }

      var name = String(ed.tab || '');
      if (!tabs[name]) {
        var sh = ss.getSheetByName(name);
        if (!sh) return out({ ok: false, error: 'No tab named "' + name + '" in the sheet.' });
        tabs[name] = sh;
      }

      var cell = tabs[name].getRange(r, c);
      /* Never overwrite a formula — that is Rok's arithmetic, not our data. */
      if (cell.getFormula()) { skipped++; continue; }

      var v = ed.v;
      if (v === null || v === undefined) { skipped++; continue; }
      cell.setValue(v);
      written++;
    }

    SpreadsheetApp.flush();
    return out({ ok: true, written: written, skipped: skipped });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (err2) {}
  }
}

/* A plain GET is handy for checking the deployment is alive. It reveals
   nothing and writes nothing. */
function doGet() {
  return out({ ok: true, service: 'set-by-set sheet writer', ready: TOKEN !== 'PASTE_A_LONG_RANDOM_STRING_HERE' });
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
