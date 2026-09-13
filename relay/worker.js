/* Set by Set — Google Sheets relay.
 *
 * Google's .xlsx export endpoint works fine without a login for any sheet
 * shared "Anyone with the link -> Viewer", but it sends no CORS header, so a
 * browser refuses to hand the bytes to page JavaScript. This worker fetches it
 * server-side (where CORS does not apply) and passes it through with a header
 * the browser will accept. It is a pipe and nothing else.
 *
 * Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> Worker ->
 * paste this over the starter code -> Deploy. Free plan is ample.
 *
 * Use: GET https://<your-worker>.workers.dev/?id=<google-file-id>
 */

/* A Google file id and nothing else — this is what stops the worker being
   turned into an open proxy for arbitrary URLs. */
const ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

/* Optional lockdown. Leave empty and any link-shared sheet may be fetched.
   Put ids in here (e.g. ['1AbC...']) and only those are allowed. */
const ALLOW = [];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function say(msg, status) {
  return new Response(msg, {
    status: status,
    headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS),
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return say('Use GET.', 405);

    const id = new URL(request.url).searchParams.get('id') || '';
    if (!ID_RE.test(id)) return say('Missing or malformed ?id= (expected a Google file id).', 400);
    if (ALLOW.length && ALLOW.indexOf(id) < 0) return say('That sheet is not on this relay’s allow list.', 403);

    const upstream = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';

    let res;
    try {
      res = await fetch(upstream, { redirect: 'follow', cf: { cacheTtl: 0 } });
    } catch (err) {
      return say('Could not reach Google: ' + err.message, 502);
    }

    if (res.status === 404) return say('Google says that sheet does not exist. Check the link.', 404);
    if (!res.ok) {
      return say('Google answered ' + res.status +
        '. The sheet is probably not shared — set it to "Anyone with the link → Viewer".', 502);
    }

    /* A sheet that is not actually public returns a sign-in PAGE with status
       200. Content type is the only way to tell that from a real workbook. */
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const looksLikeFile = ct.indexOf('spreadsheetml') > -1 || ct.indexOf('octet-stream') > -1;
    if (!looksLikeFile) {
      return say('Google returned a sign-in page instead of the file. ' +
        'Open the sheet’s Share dialog and set General access to "Anyone with the link → Viewer".', 502);
    }

    return new Response(res.body, {
      status: 200,
      headers: Object.assign({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'inline; filename="sheet.xlsx"',
        'Cache-Control': 'no-store',
      }, CORS),
    });
  },
};
