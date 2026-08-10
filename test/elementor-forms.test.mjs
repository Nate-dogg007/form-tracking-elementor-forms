/*
  Tests for elementor-forms v1.0.

    npm install playwright
    node test/elementor-forms.test.mjs

  WHAT THESE TESTS ARE BUILT ON

  The markup below is not invented. Every form here is modelled on
  Elementor Pro output rendered by real sites — the `<form class="elementor-form"
  method="post" name="...">` wrapper, the `post_id` / `form_id` / `referer_title`
  / `queried_id` hidden inputs, the `elementor-field-type-*` field group
  classes, and the `form_fields[...]` input names.

  MISLABELLED_FORM in particular is a real shape: a field labelled and
  placeholdered "Phone" carrying `name="form_fields[email]"`, alongside the
  actual email field at `form_fields[field_29e0ac1]`. That is the case the
  type-class-first matching order exists for.

  What they do NOT prove is that `submit_success` behaves on a live install
  exactly as the shim below models it. The shim reproduces the contract a
  dozen independent plugins rely on — a jQuery event on the document whose
  target is the form — but it is a model, not a capture from a real
  submission. Run the diagnostic in the README before trusting this.
*/

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, '..', 'elementor-forms'), 'utf8');
const SOURCE = RAW.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');

const EVENT_NAME = 'elementor_form_submit';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const script = (country, consentMode, assumeCountry) => {
  let out = SOURCE;
  if (country) {
    const flag = `var DEFAULT_COUNTRY = '${country}';`;
    out = out.replace(/var DEFAULT_COUNTRY = '[A-Za-z]{2}';/, flag);
    if (!out.includes(flag)) throw new Error('could not set DEFAULT_COUNTRY');
  }
  if (consentMode) {
    const flag = `var CONSENT_MODE = '${consentMode}';`;
    out = out.replace(/var CONSENT_MODE = '[a-z]+';/, flag);
    if (!out.includes(flag)) throw new Error('could not set CONSENT_MODE');
  }
  if (assumeCountry) {
    const flag = 'var ASSUME_DEFAULT_COUNTRY = true;';
    out = out.replace(/var ASSUME_DEFAULT_COUNTRY = false;/, flag);
    if (!out.includes(flag)) throw new Error('could not set ASSUME_DEFAULT_COUNTRY');
  }
  return out;
};

/* ── Elementor Pro markup ────────────────────────────────────────────── */

const group = (type, id, inner) =>
  `<div class="elementor-field-type-${type} elementor-field-group elementor-column elementor-field-group-${id} elementor-col-100">${inner}</div>`;

const widget = (formId, name, body, extra = '') => `
  <div class="elementor-element elementor-widget elementor-widget-form" data-id="${formId}" data-widget_type="form.default">
    <div class="elementor-widget-container">
      <form class="elementor-form" method="post" name="${name}" aria-label="${name}"${extra}>
        <input type="hidden" name="post_id" value="1460">
        <input type="hidden" name="form_id" value="${formId}">
        <input type="hidden" name="referer_title" value="Contact">
        <input type="hidden" name="queried_id" value="1460">
        <div class="elementor-form-fields-wrapper elementor-labels-above">
          ${body}
          <div class="elementor-field-group elementor-column elementor-field-type-submit elementor-col-100 e-form__buttons">
            <button type="submit" class="elementor-button">Send</button>
          </div>
        </div>
      </form>
    </div>
  </div>`;

// The everyday case: Elementor's default field IDs, one composite name.
const STANDARD_FORM = widget('bc7d48e', 'Request a callback', `
  ${group('text', 'name', '<input size="1" type="text" name="form_fields[name]" id="form-field-name" class="elementor-field elementor-field-textual" value="Jane Ann Smith">')}
  ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" id="form-field-email" class="elementor-field elementor-field-textual" value="Jane.Doe+Forms@Gmail.com">')}
  ${group('tel', 'phone', '<input size="1" type="tel" name="form_fields[phone]" id="form-field-phone" class="elementor-field elementor-field-textual" value="07700 900123">')}
  ${group('textarea', 'message', '<textarea name="form_fields[message]" id="form-field-message" class="elementor-field elementor-field-textual">Please call about my sickness absence</textarea>')}
  ${group('text', 'company', '<input size="1" type="text" name="form_fields[company]" id="form-field-company" class="elementor-field elementor-field-textual" value="Acme Widgets Ltd">')}
  ${group('acceptance', 'acceptance', '<input type="checkbox" name="form_fields[acceptance]" id="form-field-acceptance" class="elementor-field-option" value="on" checked>')}
  ${group('text', 'postcode', '<input size="1" type="text" name="form_fields[postcode]" id="form-field-postcode" class="elementor-field elementor-field-textual" value="SO99 9XX">')}
  ${group('text', 'country', '<input size="1" type="text" name="form_fields[country]" id="form-field-country" class="elementor-field elementor-field-textual" value="United Kingdom">')}
  ${group('hidden', 'gclid', '<input type="hidden" name="form_fields[gclid]" id="form-field-gclid" value="Cj0KCQiA-secret-click-id">')}
`);

/*
  Real shape, from real markup: someone typed "email" into the Advanced tab
  of a Text field and used it for the phone number, and left the actual
  Email field on its generated ID. Matching on the field ID first would hash
  a phone number into sha256_email_address.
*/
const MISLABELLED_FORM = widget('7ce0758', 'Newsletter', `
  ${group('text', 'email', '<input size="1" type="text" name="form_fields[email]" id="form-field-email" class="elementor-field elementor-field-textual" placeholder="Phone" value="07700 900456">')}
  ${group('email', 'field_29e0ac1', '<input size="1" type="email" name="form_fields[field_29e0ac1]" id="form-field-field_29e0ac1" class="elementor-field elementor-field-textual" placeholder="Email" value="real@example.com">')}
`);

// Every field ID is generated, so only the type classes and autocomplete
// tokens say anything.
const OPAQUE_FORM = widget('a1b2c3d', 'Opaque', `
  ${group('text', 'field_fb6fc34', '<input size="1" type="text" name="form_fields[field_fb6fc34]" autocomplete="given-name" value="John">')}
  ${group('text', 'field_9989e91', '<input size="1" type="text" name="form_fields[field_9989e91]" autocomplete="family-name" value="Doe">')}
  ${group('email', 'field_d8eb177', '<input size="1" type="email" name="form_fields[field_d8eb177]" value="opaque@example.com">')}
  ${group('tel', 'field_e6f9a87', '<input size="1" type="tel" name="form_fields[field_e6f9a87]" value="07700 900789">')}
  ${group('text', 'field_bbb2222', '<input size="1" type="text" name="form_fields[field_bbb2222]" autocomplete="postal-code" value="SO99 9XX">')}
  ${group('text', 'field_ccc3333', '<input size="1" type="text" name="form_fields[field_ccc3333]" autocomplete="country-name" value="United Kingdom">')}
  ${group('text', 'field_aaa1111', '<input size="1" type="text" name="form_fields[field_aaa1111]" value="nothing identifiable">')}
`);

// Address parts are separate Text fields in Elementor — there is no
// composite address field — so this leans entirely on the field IDs, plus
// data-upd for the two keys that are never name-matched.
const ADDRESS_FORM = widget('add7e55', 'Quote request', `
  ${group('text', 'first_name', '<input size="1" type="text" name="form_fields[first_name]" value="Jane">')}
  ${group('text', 'last_name', '<input size="1" type="text" name="form_fields[last_name]" value="Smith">')}
  ${group('text', 'address', '<input size="1" type="text" name="form_fields[address]" value="123 New Rd">')}
  ${group('text', 'town', '<input size="1" type="text" name="form_fields[town]" data-upd="city" value="Southampton">')}
  ${group('text', 'county', '<input size="1" type="text" name="form_fields[county]" data-upd="region" value="Hampshire">')}
  ${group('text', 'postcode', '<input size="1" type="text" name="form_fields[postcode]" value="SO99 9XX">')}
  ${group('select', 'country', '<select name="form_fields[country]"><option value="United Kingdom" selected>UK</option></select>')}
  ${group('text', 'city', '<input size="1" type="text" name="form_fields[city]" value="not the one with data-upd">')}
`);

// Name and postcode but no country: three of Google's four required address
// fields. The shape almost every UK lead form has, and the one that produced
// the live "addresses are missing required fields" warning.
const PARTIAL_ADDRESS_FORM = widget('par71a1', 'Partial', `
  ${group('text', 'name', '<input size="1" type="text" name="form_fields[name]" value="Jane Ann Smith">')}
  ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" value="partial@example.com">')}
  ${group('text', 'postcode', '<input size="1" type="text" name="form_fields[postcode]" value="SO99 9XX">')}
`);

// Matchable at submit, useless afterwards: a postcode on its own is not an
// identifier and cannot complete an address, so buildUserData resolves to
// null. That async transition had no fixture at all.
const POSTCODE_ONLY_FORM = widget('p05tc0d', 'Postcode only', `
  ${group('text', 'postcode', '<input size="1" type="text" name="form_fields[postcode]" value="SO99 9XX">')}
`);

const PASSWORD_FORM = widget('pw00001', 'Register', `
  ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" value="victim@example.com">')}
  ${group('password', 'password', '<input size="1" type="password" name="form_fields[password]" value="hunter2">')}
`);

const NO_TRACK_FORM = widget('not7rak', 'Internal', `
  ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" value="private@example.com">')}
`, ' data-no-track');

// Multi-step: the earlier step is hidden with a class. Its fields are still
// in the DOM and still enabled at the moment the last step submits.
const MULTISTEP_FORM = widget('5tep555', 'Multi step', `
  <div class="e-form__step elementor-hidden">
    ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" value="step1@example.com">')}
  </div>
  <div class="e-form__step elementor-step-current elementor-step-last">
    ${group('tel', 'phone', '<input size="1" type="tel" name="form_fields[phone]" value="07700 900222">')}
  </div>
`);

/*
  A popup form whose <form> has lost the elementor-form class — some themes
  and optimisation plugins rewrite it. The widget wrapper is still Elementor's.
*/
const POPUP_FORM = `
  <div class="elementor-popup-modal" data-elementor-id="991">
    <div class="elementor-element elementor-widget elementor-widget-form" data-id="p0pup01" data-widget_type="form.default">
      <form method="post" name="Popup offer">
        <input type="hidden" name="form_id" value="p0pup01">
        <div class="elementor-form-fields-wrapper">
          ${group('email', 'email', '<input size="1" type="email" name="form_fields[email]" value="popup@example.com">')}
        </div>
      </form>
    </div>
  </div>`;

/*
  Verbatim from a live Elementor Pro 3.5.2 install (rollerdor.net/contact),
  values added. Kept as scraped, including the tab-padded label text, the
  duplicated nested field group inside the HTML field, and the checkbox
  group whose label `for` does not match any of its inputs.

  Three things here that invented markup would not have shown:
    - there is NO hidden form_id / post_id / referer_title input, so the
      form id has to come off the widget wrapper's data-id
    - the phone field's ID is `field_0275ba1`, so only the type class
      finds it
    - street and postcode are on generated IDs too, so only the label
      finds them — while "City" sits right between them and must NOT be
      collected
*/
const ROLLERDOR_FORM = `
<div class="elementor-element elementor-element-ced666d bm_action_form elementor-widget elementor-widget-form" data-id="ced666d" data-element_type="widget" data-widget_type="form.default">
<div class="elementor-widget-container">
<form class="elementor-form" method="post" name="Action Lead Form">
<div class="elementor-form-fields-wrapper elementor-labels-">
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-name elementor-col-33 elementor-field-required">
<label for="form-field-name" class="elementor-field-label elementor-screen-only">
								Your Name							</label>
<input size="1" type="text" name="form_fields[name]" id="form-field-name" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Your Name*" required="required" aria-required="true" value="Jane Ann Smith">
</div>
<div class="elementor-field-type-tel elementor-field-group elementor-column elementor-field-group-field_0275ba1 elementor-col-33">
<label for="form-field-field_0275ba1" class="elementor-field-label elementor-screen-only">
								Phone							</label>
<input size="1" type="tel" name="form_fields[field_0275ba1]" id="form-field-field_0275ba1" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Phone" pattern="[0-9()#&amp;+*-=.]+" value="07700 900123">
</div>
<div class="elementor-field-type-email elementor-field-group elementor-column elementor-field-group-email elementor-col-33 elementor-field-required">
<label for="form-field-email" class="elementor-field-label elementor-screen-only">
								Email							</label>
<input size="1" type="email" name="form_fields[email]" id="form-field-email" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Email*" required="required" aria-required="true" value="Jane.Doe+Forms@Gmail.com">
</div>
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-field_dbf8253 elementor-col-33">
<label for="form-field-field_dbf8253" class="elementor-field-label elementor-screen-only">
								Street Address							</label>
<input size="1" type="text" name="form_fields[field_dbf8253]" id="form-field-field_dbf8253" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Street Address" value="123 New Rd">
</div>
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-field_ceded4f elementor-col-33">
<label for="form-field-field_ceded4f" class="elementor-field-label elementor-screen-only">
								City							</label>
<input size="1" type="text" name="form_fields[field_ceded4f]" id="form-field-field_ceded4f" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="City" value="Southampton">
</div>
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-field_33bb4d3 elementor-col-33 elementor-field-required">
<label for="form-field-field_33bb4d3" class="elementor-field-label elementor-screen-only">
								Postcode							</label>
<input size="1" type="text" name="form_fields[field_33bb4d3]" id="form-field-field_33bb4d3" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Postcode*" required="required" aria-required="true" value="SO99 9XX">
</div>
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-field_9c41d02 elementor-col-33">
<label for="form-field-field_9c41d02" class="elementor-field-label elementor-screen-only">
								Country							</label>
<input size="1" type="text" name="form_fields[field_9c41d02]" id="form-field-field_9c41d02" class="elementor-field elementor-size-md  elementor-field-textual" placeholder="Country" value="United Kingdom">
</div>
<div class="elementor-field-type-hidden elementor-field-group elementor-column elementor-field-group-field_2a63952 elementor-col-100">
</div>
<div class="elementor-field-type-textarea elementor-field-group elementor-column elementor-field-group-field_35b8921 elementor-col-66">
<label for="form-field-field_35b8921" class="elementor-field-label elementor-screen-only">
								Message							</label>
<textarea class="elementor-field-textual elementor-field  elementor-size-md" name="form_fields[field_35b8921]" id="form-field-field_35b8921" rows="1" placeholder="Message">Please call about my sickness absence</textarea>
</div>
<div class="elementor-field-type-html elementor-field-group elementor-column elementor-field-group-field_bf74b9e elementor-col-100">
<div class="elementor-field-type-html elementor-field-group elementor-column elementor-field-group-field_f2e6eb7 elementor-col-100">
<h4>Choose your door</h4>
</div>
<div class="elementor-field-type-checkbox elementor-field-group elementor-column elementor-field-group-field_eeff51c elementor-col-100">
<div class="elementor-field-subgroup elementor-subgroup-inline">
<span class="elementor-field-option">
<input type="checkbox" value="RD55 Fixed Size Roller Garage Doors" id="form-field-field_bf74b9e_0" name="form_fields[field_bf74b9e][]" checked>
<label for="form-field-field_bf74b9e">RD55 Fixed Size Roller Garage Doors</label>
</span>
<span class="elementor-field-option">
<input type="checkbox" value="Single Roller Garage Doors" id="form-field-field_bf74b9e_1" name="form_fields[field_bf74b9e][]">
<label for="form-field-field_bf74b9e">Single Roller Garage Doors</label>
</span>
</div>
</div>
</div>
<div class="elementor-field-group elementor-column elementor-field-type-submit elementor-col-33 e-form__buttons">
<button type="submit" class="elementor-button elementor-size-sm"><span><span class="elementor-button-text">SUBMIT</span></span></button>
</div>
</div>
</form>
</div>
</div>`;

const NOT_ELEMENTOR = `
  <form id="newsletter" action="#">
    <input type="email" name="email" value="someone@example.com">
    <button type="submit">Sign up</button>
  </form>`;

const PAGES = {
  '/standard': STANDARD_FORM,
  '/partial-address': PARTIAL_ADDRESS_FORM,
  '/postcode-only': POSTCODE_ONLY_FORM,
  '/mislabelled': MISLABELLED_FORM,
  '/opaque': OPAQUE_FORM,
  '/address': ADDRESS_FORM,
  '/password': PASSWORD_FORM,
  '/no-track': NO_TRACK_FORM,
  '/multistep': MULTISTEP_FORM,
  '/popup': POPUP_FORM,
  '/not-elementor': NOT_ELEMENTOR,
  '/two-forms': STANDARD_FORM + MISLABELLED_FORM,
  '/mixed': STANDARD_FORM + NOT_ELEMENTOR,
  '/rollerdor': ROLLERDOR_FORM
};

const PAGE = (body) => `<!doctype html><meta charset="utf-8"><title>el</title>${body}`;

/* ── Harness ─────────────────────────────────────────────────────────── */

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE(PAGES[req.url.split('?')[0]] || ''));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();

/*
  Elementor fires submit_success through jQuery, on the form, and it reaches
  document by bubbling. A native addEventListener never hears it — which is
  the single most common reason a hand-rolled Elementor listener silently
  does nothing — so the shim provides jQuery's on/trigger pair, not
  dispatchEvent.
*/
const SHIM = `
  window.__h = {};
  window.jQuery = function () {
    return { on: function (e, fn) { (window.__h[e] = window.__h[e] || []).push(fn); } };
  };
  window.jQuery.fn = { jquery: '3.7.1' };
  window.__success = function (selector) {
    var form = selector ? document.querySelector(selector) : document.querySelector('form');
    (window.__h['submit_success'] || []).forEach(function (fn) {
      fn({ type: 'submit_success', target: form });
    });
  };
  window.__successRaw = function (target) {
    (window.__h['submit_success'] || []).forEach(function (fn) {
      fn({ type: 'submit_success', target: target });
    });
  };
  window.dataLayer = [];
  window.dataLayer.push = function (obj) {
    var copy = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k) && typeof obj[k] !== 'function') copy[k] = obj[k];
    }
    Array.prototype.push.call(window.dataLayer, copy);
    window.__record(copy);
    return window.dataLayer.length;
  };`;

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function run(path, opts = {}) {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const records = [];
  await pg.exposeFunction('__record', (o) => { records.push(o); });
  if (opts.onConsole) pg.on('console', opts.onConsole);
  await pg.addInitScript(SHIM);
  if (opts.consent !== 'none') {
    await pg.addInitScript(`window.dataLayer.push(['consent','default',
      { ad_user_data: 'granted', ad_storage: 'granted' }]);`);
  }
  if (opts.preScript) await pg.addInitScript(opts.preScript);
  for (let i = 0; i < (opts.installs || 1); i++) {
    await pg.addInitScript(script(opts.country, opts.consentMode, opts.assumeCountry));
  }
  await pg.goto(`${BASE}${path}`);
  if (opts.before) await pg.evaluate(opts.before);
  if (opts.submit !== false) {
    await pg.evaluate((sel) => {
      const f = sel ? document.querySelector(sel) : document.querySelector('form');
      if (f) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, opts.selector || null);
  }
  if (opts.success !== false) {
    for (let i = 0; i < (opts.successCount || 1); i++) {
      await pg.evaluate((sel) => window.__success(sel), opts.selector || null);
    }
  }
  await pg.waitForTimeout(250);
  await ctx.close();
  const submissions = records.filter((r) => r.event === EVENT_NAME);
  return { records, submissions, blob: JSON.stringify(records) };
}

/* ── Static checks ───────────────────────────────────────────────────── */

console.log('\nGTM Custom HTML compatibility');
{
  const braces = SOURCE.match(/\{\{[^}]*\}\}/g) || [];
  check('no GTM variable syntax anywhere', braces.length === 0, braces.join(', '));
  check('wrapped in <script> tags for pasting',
    /^\s*<script>/.test(RAW) && /<\/script>\s*$/.test(RAW));
  check('no stray closing script tag in the body', !SOURCE.includes('</script>'));
}

/* ── The capture model ───────────────────────────────────────────────── */

console.log('\nthe capture model');
{
  const { submissions } = await run('/standard', { success: false });
  check('submit alone pushes nothing', submissions.length === 0,
    `got ${submissions.length}`);
}
{
  const { submissions } = await run('/standard');
  check('submit then success pushes exactly once',
    submissions.length === 1, `got ${submissions.length}`);
  check('and carries user data', !!submissions[0]?.user_data);
}
{
  const { submissions } = await run('/standard', { successCount: 3 });
  check('three success events still push once',
    submissions.length === 1, `got ${submissions.length}`);
}
{
  const { submissions } = await run('/standard', { installs: 3 });
  check('three installs of the tag still push once',
    submissions.length === 1, `got ${submissions.length}`);
}
{
  const { submissions } = await run('/standard', { submit: false });
  check('success with no captured submit still reports it',
    submissions.length === 1, `got ${submissions.length}`);
  check('...and recovers user data, since Elementor resets after the event',
    !!submissions[0]?.user_data);
}

/* ── Field mapping ───────────────────────────────────────────────────── */

console.log('\nfield mapping on a standard form');
{
  const { submissions, blob } = await run('/standard');
  const ud = submissions[0]?.user_data || {};
  const addr = ud.address || {};

  check('type-email field → hashed email, gmail dots and plus stripped',
    ud.sha256_email_address === sha256('janedoe@gmail.com'), ud.sha256_email_address);
  check('type-tel field → E.164',
    ud.sha256_phone_number === sha256('+447700900123'), ud.sha256_phone_number);
  check('form_fields[name] split → first', addr.sha256_first_name === sha256('jane'));
  check('form_fields[name] split → last', addr.sha256_last_name === sha256('smith'));
  check('middle name discarded by the split', !blob.includes(sha256('ann')));

  check('textarea free text dropped', !blob.toLowerCase().includes('sickness'));
  check('company name dropped', !blob.toLowerCase().includes('acme'));
  check('acceptance checkbox dropped', !blob.includes(sha256('on')));
  check('hidden gclid field never read', !blob.includes('secret-click-id'));

  check('form id read from the hidden form_id input',
    submissions[0]?.form_details?.form_id === 'bc7d48e',
    submissions[0]?.form_details?.form_id);
  check('form name read from the name attribute',
    submissions[0]?.form_details?.form_name === 'Request a callback',
    submissions[0]?.form_details?.form_name);

  const keys = Object.keys(ud).concat(Object.keys(addr)).sort();
  check('only expected keys are present, nothing extra',
    keys.join(',') === [
      'address', 'country', 'postal_code', 'sha256_email_address',
      'sha256_first_name', 'sha256_last_name', 'sha256_phone_number'
    ].sort().join(','), keys.join(','));
}

/* ── The reason the type class outranks the field ID ─────────────────── */

console.log('\nmislabelled field IDs (real markup)');
{
  const { submissions, blob } = await run('/mislabelled', { selector: '.elementor-form' });
  const ud = submissions[0]?.user_data || {};

  check('the real type-email field wins the email slot',
    ud.sha256_email_address === sha256('real@example.com'), ud.sha256_email_address);
  check('a phone number in a field named "email" is NOT hashed as an email',
    ud.sha256_email_address !== sha256('07700 900456') &&
    !blob.includes(sha256('07700 900456')));
  check('...and is not silently promoted to the phone slot either',
    ud.sha256_phone_number === undefined, ud.sha256_phone_number);
}

/* ── Generated field IDs ─────────────────────────────────────────────── */

console.log('\ngenerated field IDs, type classes and autocomplete');
{
  const { submissions, blob } = await run('/opaque');
  const ud = submissions[0]?.user_data || {};
  const addr = ud.address || {};
  check('type class finds the email behind field_d8eb177',
    ud.sha256_email_address === sha256('opaque@example.com'));
  check('type class finds the phone behind field_e6f9a87',
    ud.sha256_phone_number === sha256('+447700900789'));
  check('given-name token → first', addr.sha256_first_name === sha256('john'));
  check('family-name token → last', addr.sha256_last_name === sha256('doe'));
  check('a generated ID with no type signal and no autocomplete is dropped',
    !blob.includes('nothing identifiable'));
}

/* ── Address, which Elementor has no composite field for ─────────────── */

console.log('\naddress assembled from separate text fields');
{
  const { submissions, blob } = await run('/address');
  const ud = submissions[0]?.user_data || {};
  const addr = ud.address || {};
  check('first_name by field ID', addr.sha256_first_name === sha256('jane'));
  check('last_name by field ID', addr.sha256_last_name === sha256('smith'));
  check('address → street', addr.sha256_street === sha256('123 new rd'));
  check('postcode by field ID', addr.postal_code === 'so99 9xx', addr.postal_code);
  check('country name → alpha-2', addr.country === 'GB', addr.country);
  check('data-upd="city" is honoured', addr.city === 'southampton', addr.city);
  check('data-upd="region" is honoured', addr.region === 'hampshire', addr.region);
  check('a field literally named "city" is NOT collected without data-upd',
    !blob.includes('not the one with data-upd'));
  check('an address-only submission still yields user_data',
    !!ud.address && !ud.sha256_email_address);
}

/* ── Multi-step and popups ───────────────────────────────────────────── */

console.log('\nmulti-step and popup forms');
{
  const { submissions } = await run('/multistep');
  const ud = submissions[0]?.user_data || {};
  check('a hidden earlier step is still read',
    ud.sha256_email_address === sha256('step1@example.com'));
  check('the current step is read too',
    ud.sha256_phone_number === sha256('+447700900222'));
}
{
  const { submissions } = await run('/popup');
  check('a form without the elementor-form class is found via the widget wrapper',
    submissions.length === 1, `got ${submissions.length}`);
  check('and its user data is collected',
    submissions[0]?.user_data?.sha256_email_address === sha256('popup@example.com'));
  check('form id falls back to the widget data-id',
    submissions[0]?.form_details?.form_id === 'p0pup01',
    submissions[0]?.form_details?.form_id);
}

/* ── Exclusions ──────────────────────────────────────────────────────── */

console.log('\nexclusions');
{
  const { submissions, blob } = await run('/password');
  check('password value never reaches the dataLayer', !blob.includes('hunter2'));
  check('a form containing a password yields no user data',
    !submissions[0]?.user_data);
  check('but the submission is still reported', submissions.length === 1);
}
{
  const { submissions } = await run('/no-track');
  check('data-no-track suppresses the event entirely',
    submissions.length === 0, `got ${submissions.length}`);
}
{
  const { submissions } = await run('/not-elementor');
  check('a non-Elementor form on the page is ignored',
    submissions.length === 0, `got ${submissions.length}`);
}
{
  // The success handler must gate on "is this an Elementor form", not on
  // "is this a form". With an Elementor form also on the page it would be
  // easy to accept the wrong one and call it a conversion.
  const { submissions } = await run('/mixed', { selector: '#newsletter' });
  check('a plain form beside an Elementor one is still ignored',
    submissions.length === 0, `got ${submissions.length}`);
}

/* ── Attribution across two forms on one page ────────────────────────── */

console.log('\ntwo forms on one page');
{
  const { submissions } = await run('/two-forms', {
    selector: 'form[name="Newsletter"]'
  });
  check('only the submitted form is reported',
    submissions.length === 1, `got ${submissions.length}`);
  check('and it is the right one',
    submissions[0]?.form_details?.form_id === '7ce0758',
    submissions[0]?.form_details?.form_id);
  check('the other form\'s values are nowhere in the payload',
    !JSON.stringify(submissions).includes(sha256('janedoe@gmail.com')));
}

/* ── A real install ──────────────────────────────────────────────────── */

console.log('\nlive markup: Elementor Pro 3.5.2 (rollerdor.net/contact)');
{
  const { submissions, blob } = await run('/rollerdor');
  const ud = submissions[0]?.user_data || {};
  const addr = ud.address || {};

  check('reports exactly one submission', submissions.length === 1,
    `got ${submissions.length}`);
  check('form id comes off the widget data-id — there is no form_id input',
    submissions[0]?.form_details?.form_id === 'ced666d',
    submissions[0]?.form_details?.form_id);
  check('form name from the name attribute',
    submissions[0]?.form_details?.form_name === 'Action Lead Form',
    submissions[0]?.form_details?.form_name);

  check('email', ud.sha256_email_address === sha256('janedoe@gmail.com'));
  check('phone found by type class alone (ID is field_0275ba1)',
    ud.sha256_phone_number === sha256('+447700900123'), ud.sha256_phone_number);
  check('first name from form_fields[name]', addr.sha256_first_name === sha256('jane'));
  check('last name from form_fields[name]', addr.sha256_last_name === sha256('smith'));
  check('street found by label (ID is field_dbf8253)',
    addr.sha256_street === sha256('123 new rd'), addr.sha256_street);
  check('postcode found by label (ID is field_33bb4d3)',
    addr.postal_code === 'so99 9xx', addr.postal_code);

  check('"City" sits between them and is still NOT collected',
    addr.city === undefined && !blob.toLowerCase().includes('southampton'),
    addr.city);
  check('the message textarea is dropped', !blob.toLowerCase().includes('sickness'));
  check('a ticked product checkbox is dropped',
    !blob.toLowerCase().includes('rd55'));
  check('the nested HTML field group does not confuse the wrapper lookup',
    !blob.toLowerCase().includes('choose your door'));

  const keys = Object.keys(ud).concat(Object.keys(addr)).sort();
  check('only expected keys are present, nothing extra',
    keys.join(',') === [
      'address', 'country', 'postal_code', 'sha256_email_address',
      'sha256_first_name', 'sha256_last_name', 'sha256_phone_number',
      'sha256_street'
    ].sort().join(','), keys.join(','));
}

/* ── Consent ─────────────────────────────────────────────────────────── */

console.log('\nconsent');
{
  const { submissions, blob } = await run('/standard', { consent: 'none' });
  check('no consent signal → no user_data', !submissions[0]?.user_data);
  check('no consent signal → still reports the submission', submissions.length === 1);
  check('no consent signal → nothing hashed at all', !blob.includes('sha256'));
  check('no consent signal → fields were never even read',
    !blob.toLowerCase().includes('jane'));
}
{
  const { submissions } = await run('/standard', {
    consent: 'none',
    before: () => window.dataLayer.push(['consent', 'update', { ad_user_data: 'granted' }])
  });
  check('explicit grant → user_data', !!submissions[0]?.user_data);
}
{
  const { submissions } = await run('/standard', {
    consent: 'none',
    before: () => window.dataLayer.push(['consent', 'update', { ad_user_data: 'denied' }])
  });
  check('explicit denial → no user_data', !submissions[0]?.user_data);
}
{
  const { submissions } = await run('/standard', {
    consent: 'none',
    before: () => {
      window.dataLayer.push(['consent', 'update', { ad_user_data: 'granted' }]);
      window.dataLayer.push(['consent', 'default', { ad_user_data: 'denied' }]);
    }
  });
  check('a default after an update does not override it',
    !!submissions[0]?.user_data);
}

/* ── Redirect race ───────────────────────────────────────────────────── */

console.log('\nhashing starts at submit, not at success');
{
  // The point of hashing early: by the time success fires, the push should
  // need no further await. eventTimeout is set on every push, so its
  // presence on the record confirms the push went through pushAndWait.
  const { submissions } = await run('/standard');
  check('the push carries an eventTimeout for GTM',
    submissions[0]?.eventTimeout === 1200, String(submissions[0]?.eventTimeout));
}
{
  // Success fired in the same tick as submit — no time for a round trip.
  // Hashing that started at submit has still not resolved here, so this
  // proves the deferred path works rather than dropping the data.
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const records = [];
  await pg.exposeFunction('__record', (o) => { records.push(o); });
  await pg.addInitScript(SHIM);
  await pg.addInitScript(`window.dataLayer.push(['consent','default',
    { ad_user_data: 'granted', ad_storage: 'granted' }]);`);
  await pg.addInitScript(script());
  await pg.goto(`${BASE}/standard`);
  await pg.evaluate(() => {
    const f = document.querySelector('form');
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    window.__success();                       // same tick, hash cannot be ready
  });
  await pg.waitForTimeout(250);
  await ctx.close();
  const subs = records.filter((r) => r.event === EVENT_NAME);
  check('success in the same tick as submit still delivers user data',
    subs.length === 1 && !!subs[0].user_data, JSON.stringify(subs));
}

/* ── Edge cases ──────────────────────────────────────────────────────── */

console.log('\nedge cases');
{
  // 07700 900123 with DEFAULT_COUNTRY=IT keeps the trunk zero, because
  // Italy is in KEEP_TRUNK_ZERO — so it becomes +3907700900123, not
  // +447700900123. Proves the setting actually changes behaviour.
  const { submissions } = await run('/standard', { country: 'IT' });
  check('DEFAULT_COUNTRY changes the E.164 result',
    submissions[0]?.user_data?.sha256_phone_number === sha256('+3907700900123'),
    submissions[0]?.user_data?.sha256_phone_number);
}
{
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const errors = [];
  const records = [];
  await pg.exposeFunction('__record', (o) => { records.push(o); });
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.addInitScript(SHIM);
  await pg.addInitScript(script());
  await pg.goto(`${BASE}/standard`);
  await pg.evaluate(() => {
    window.__successRaw(undefined);
    window.__successRaw(null);
    window.__successRaw({});
    window.__successRaw(document.createElement('div'));
  });
  await pg.waitForTimeout(150);
  await ctx.close();
  check('a success event with no usable form does not throw',
    errors.length === 0, errors.join('; '));
  check('...and reports nothing rather than guessing a form',
    records.filter((r) => r.event === EVENT_NAME).length === 0);
}


/*
  Expected statuses are hand-written literals. Deriving them from the
  script's own constants would make the assertions agree with a typo, which
  is how a suite goes green while the field is broken.
*/
console.log('\nuser_data_status says why');
{
  const { submissions } = await run('/standard');
  check("a grant reports 'collected'",
    submissions[0]?.user_data_status === 'collected', submissions[0]?.user_data_status);
  check('and adds no cmp_detected', !('cmp_detected' in (submissions[0] || {})));
}
{
  const { submissions } = await run('/standard', { consent: 'none',
    before: `window.dataLayer.push(['consent','update',{ ad_user_data: 'denied' }]);` });
  check("a denial reports 'consent_denied'",
    submissions[0]?.user_data_status === 'consent_denied', submissions[0]?.user_data_status);
  check('and carries no user_data', !submissions[0]?.user_data);
}
{
  const { submissions } = await run('/standard', { consent: 'none' });
  check("silence under CONSENT_MODE 'cmp' reports 'no_consent_signal'",
    submissions[0]?.user_data_status === 'no_consent_signal', submissions[0]?.user_data_status);
  check('and the conversion still fires', submissions.length === 1);
}
{
  const { submissions } = await run('/standard', { consent: 'none', consentMode: 'none' });
  check("silence under CONSENT_MODE 'none' collects and says so",
    submissions[0]?.user_data_status === 'collected_undeclared' && !!submissions[0]?.user_data,
    submissions[0]?.user_data_status);
}
{
  const { submissions } = await run('/mislabelled', { selector: 'form' });
  check('a form with matchable fields still reports collected',
    submissions[0]?.user_data_status === 'collected', submissions[0]?.user_data_status);
}
{
  const { submissions } = await run('/standard', {
    preScript: `Object.defineProperty(window, 'crypto', { value: {}, configurable: true });` });
  check("no SubtleCrypto reports 'no_crypto'",
    submissions[0]?.user_data_status === 'no_crypto', submissions[0]?.user_data_status);
  check('and the conversion still fires', submissions.length === 1);
}
{
  // Regression from the sibling plugin: a synchronous throw goes past
  // .catch and out of capture(), which left no pending state and no event.
  const { submissions } = await run('/standard', {
    before: `window.crypto.subtle.digest = function () { throw new Error('blocked'); };` });
  check('a synchronous crypto failure still fires the conversion',
    submissions.length === 1, `got ${submissions.length}`);
  check("and reports 'error'",
    submissions[0]?.user_data_status === 'error', submissions[0]?.user_data_status);
}

console.log('\nregion-scoped consent cannot be resolved in a browser');
{
  const { submissions } = await run('/standard', { consent: 'none',
    before: `window.dataLayer.push(['consent','default',{ ad_user_data: 'denied', region: ['GB','ES'] }]);
             window.dataLayer.push(['consent','default',{ ad_user_data: 'granted' }]);` });
  check('a regional deny + global grant collects nothing',
    !submissions[0]?.user_data, JSON.stringify(submissions[0]?.user_data));
  check("and reports 'region_unresolved'",
    submissions[0]?.user_data_status === 'region_unresolved', submissions[0]?.user_data_status);
}
{
  const { submissions } = await run('/standard', { consent: 'none',
    before: `window.dataLayer.push(['consent','default',{ ad_user_data: 'denied', region: ['GB'] }]);
             window.dataLayer.push(['consent','default',{ ad_user_data: 'granted' }]);
             window.dataLayer.push(['consent','update',{ ad_user_data: 'granted' }]);` });
  check('but a global update still resolves it',
    submissions[0]?.user_data_status === 'collected' && !!submissions[0]?.user_data,
    submissions[0]?.user_data_status);
}
{
  const { submissions } = await run('/standard', { consent: 'none',
    before: `window.dataLayer.push(['consent','update',{ ad_user_data: 'granted', region: ['GB'] }]);` });
  check('a region key on an update does not make it unresolvable',
    submissions[0]?.user_data_status === 'collected', submissions[0]?.user_data_status);
}

console.log('\nCMP detection contradicts the declaration, never decides it');
{
  const { submissions } = await run('/standard', { consent: 'none',
    before: `var s = document.createElement('script');
             s.id = 'cookieBanner-143376892';
             document.head.appendChild(s);` });
  check('a silent CMP is named rather than just missing',
    submissions[0]?.user_data_status === 'no_consent_signal' &&
    submissions[0]?.cmp_detected === 'HubSpot', JSON.stringify(submissions[0]));
}
{
  const { submissions } = await run('/standard', { consent: 'none', consentMode: 'none',
    before: `window.OneTrust = {};` });
  check("declaring 'none' with a CMP present is flagged",
    submissions[0]?.cmp_detected === 'OneTrust', submissions[0]?.cmp_detected);
  check('but the declaration still governs — it collects', !!submissions[0]?.user_data);
}

console.log('\nthe address block is all four fields or none');
{
  // /mislabelled has an email and a phone but no address parts at all.
  const { submissions } = await run('/mislabelled');
  check('a form with no address parts sends no address block',
    !submissions[0]?.user_data?.address,
    JSON.stringify(submissions[0]?.user_data?.address));
}
{
  const { submissions } = await run('/address');
  const addr = submissions[0]?.user_data?.address || {};
  check('a form carrying all four still sends the address',
    !!(addr.sha256_first_name && addr.sha256_last_name &&
       addr.postal_code && addr.country === 'GB'), JSON.stringify(addr));
}
{
  // Three of four. Google discards the whole block and warns, so sending it
  // is hashed personal data in a page-global array for nothing.
  const { submissions } = await run('/partial-address');
  const ud = submissions[0]?.user_data || {};
  check('name + postcode with no country sends no address at all',
    !ud.address, JSON.stringify(ud.address));
  check('but the email still goes, so the lead is not lost',
    ud.sha256_email_address === sha256('partial@example.com'), JSON.stringify(ud));
}
{
  const { submissions } = await run('/partial-address', { assumeCountry: true });
  const addr = submissions[0]?.user_data?.address || {};
  check('ASSUME_DEFAULT_COUNTRY completes the same form',
    addr.country === 'GB' && !!addr.postal_code &&
    !!addr.sha256_first_name && !!addr.sha256_last_name, JSON.stringify(addr));
}


console.log('\nno_fields, and the warnings that are the only remedy');
{
  // Fields matched at submit, but nothing survived as an identifier. This
  // is the async branch — buildUserData resolving to null — which is
  // reached by no other fixture.
  const { submissions } = await run('/postcode-only');
  check("a postcode alone reports 'no_fields'",
    submissions[0]?.user_data_status === 'no_fields', submissions[0]?.user_data_status);
  check('and carries no user_data', !submissions[0]?.user_data);
  check('and the conversion still fires', submissions.length === 1);
}
{
  // The synchronous branch: nothing matchable was found at all.
  const { submissions } = await run('/password');
  check("a form with nothing matchable also reports 'no_fields'",
    submissions[0]?.user_data_status === 'no_fields', submissions[0]?.user_data_status);
}
{
  // For region_unresolved the warning is the whole remedy: the status says
  // collection did not happen, only the warning says what to do about it.
  const warnings = [];
  await run('/standard', { consent: 'none',
    onConsole: (m) => { if (m.type() === 'warning') warnings.push(m.text()); },
    before: `window.dataLayer.push(['consent','default',{ ad_user_data: 'denied', region: ['GB'] }]);
             window.dataLayer.push(['consent','default',{ ad_user_data: 'granted' }]);` });
  const w = warnings.join(' | ');
  check('the region warning explains the cause and names the way out',
    /per region/.test(w) && /formTrackingConsentFn/.test(w), w);
}
{
  const warnings = [];
  await run('/standard', { consent: 'none', consentMode: 'none',
    onConsole: (m) => { if (m.type() === 'warning') warnings.push(m.text()); },
    before: `window.OneTrust = {};` });
  check("declaring 'none' with a CMP present warns, not just flags",
    /CONSENT_MODE is "none"/.test(warnings.join(' | ')) &&
    /OneTrust/.test(warnings.join(' | ')), warnings.join(' | '));
}
{
  const warnings = [];
  await run('/standard', { consent: 'none', consentMode: 'None',
    onConsole: (m) => { if (m.type() === 'warning') warnings.push(m.text()); } });
  check('a mis-cased CONSENT_MODE names the offending value',
    /"None"/.test(warnings.join(' | ')) && /neither/.test(warnings.join(' | ')),
    warnings.join(' | '));
}
{
  // Withdrawal between capture and commit. Elementor hashes at submit and
  // pushes at submit_success; the visitor can reject the banner in between.
  const { submissions } = await run('/standard', {
    before: `var __origSuccess = window.__success;
             window.__success = function (sel) {
               window.dataLayer.push(['consent','update',{ ad_user_data: 'denied' }]);
               return __origSuccess(sel);
             };` });
  check('consent withdrawn between submit and success is honoured',
    !submissions[0]?.user_data, JSON.stringify(submissions[0]?.user_data));
  check("and it reports 'consent_denied', not 'collected'",
    submissions[0]?.user_data_status === 'consent_denied', submissions[0]?.user_data_status);
  check('and the conversion still fires', submissions.length === 1);
}

/* ── Result ──────────────────────────────────────────────────────────── */

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures:');
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
