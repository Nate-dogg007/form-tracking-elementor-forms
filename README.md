# Elementor Pro forms tracking for Google Ads enhanced conversions

Author: Nathan O'Connor
Version: 1.0

Reads Elementor Pro form submissions, normalises and SHA-256 hashes the user-provided data fields
Google Ads wants, and pushes one `elementor_form_submit` event to the dataLayer. Personal data is
only ever read once your CMP has granted `ad_user_data`, re-checked on every submission.

**Install is one GTM Custom HTML tag.** Paste the file in, set one country code, trigger on All
Pages.

## Read this before you install it

**This one has not been verified against a live Elementor install.** The html-forms, ninja-forms
and contact-form-7 scripts were each built against payloads captured from real submissions on real
sites. This was built from Elementor Pro markup rendered by real sites, and from the
`submit_success` contract as a dozen independent plugins use it — better than working from the
documentation alone, which is what the Gravity script had, and still not the same as a captured
submission.

Run the diagnostic below against the real form first. The two things most worth confirming are that
`submit_success` fires with the form as its target, and that the `elementor-field-type-*` wrapper
classes are present on the fields you care about.

## How it captures

Elementor posts the form over AJAX and, on success, fires the jQuery event `submit_success` — then
resets the form. By the time anything downstream reacts, the values are on their way out.

So this **reads the fields at submit**, while they are still there, **starts hashing immediately**,
and **commits on `submit_success`** once the submission is known to have succeeded. Nothing is
pushed for a submission that fails validation.

### Why the hashing starts at submit

SHA-256 through SubtleCrypto is asynchronous, and Elementor's **Redirect** action navigates away
inside the same success handler that fires `submit_success`. A hash that starts when success fires
is racing the unload.

Starting it at submit buys a whole network round trip — typically a few hundred milliseconds — so
by the time success fires the hashes are already sitting there and the push is synchronous. There
is a test for the pathological case (success in the same tick as submit) and the data still gets
through; it just has to wait for the promise.

If you use Redirect and conversions still look light, redirect to a thank-you page and fire the
conversion there instead. That is the only version of this with no race in it at all.

## What it collects

An allowlist. Only these fields ever leave the page; everything else is discarded.

| Field | Where it comes from | Hashed |
|---|---|---|
| Email | `elementor-field-type-email` | yes |
| Phone | `elementor-field-type-tel` | yes |
| First name | field ID, or a Name field split | yes |
| Last name | field ID, or a Name field split | yes |
| Street | field ID (`address`, `street`, …) | yes |
| City | `data-upd="city"` only | no |
| Region | `data-upd="region"` only | no |
| Postcode | field ID (`postcode`, `zip`, …) | no |
| Country | field ID (`country`) | no |

Google needs at least an email, a phone number, or a complete address (first name, last name,
postal code and country). Without one of those the `user_data` object is dropped and you get a bare
`elementor_form_submit`.

Elementor has no composite address field — each part is a separate Text field — so an address is
only assembled if those fields happen to be named sensibly. Most Elementor lead forms will produce
an email, a phone and a name, which is plenty.

### How fields are matched, and why in that order

**1. The `elementor-field-type-*` wrapper class.** This comes from the field's actual type and
cannot be edited from the form builder. `email` and `tel` are decisive.

**2. The field ID inside `form_fields[...]`.** This is typed in by whoever built the form, so
`form_fields[email]` means only that somebody typed "email" into the Advanced tab.

**3. The `autocomplete` attribute**, for a form whose field IDs are all `field_a1b2c3`.

That order is not academic. Real Elementor markup exists in which a field labelled and placeholdered
"Phone" is named `form_fields[email]`, while the actual email field sits on its generated ID
`form_fields[field_29e0ac1]`. Matching on the field ID first would hash a phone number into
`sha256_email_address` and match nothing, forever, with nothing reported anywhere. There is a test
for exactly that markup.

The phone number in that example is simply lost — there is no signal anywhere in the DOM saying it
is a phone. Losing a field is the correct outcome; poisoning the email hash is not.

Never read: `submit`, `step`, `html`, `hidden`, `password`, `upload`, `acceptance`, `recaptcha`,
`recaptcha_v3` and `honeypot` field types. Plus any `type="password"` input whatever its wrapper
says, and a form containing one has no fields read at all.

**Hidden fields are skipped on purpose.** Elementor hidden fields usually carry `gclid`, UTMs and
page context — machine data, not the visitor's. Add `data-upd="email"` (or whichever key) to one if
you genuinely need it read.

## Multi-step forms and popups

**Multi-step works.** Earlier steps are hidden with a class, not removed and not disabled, so every
step's fields are readable at the moment the last one submits. The "next" button does not submit, so
nothing is pushed part-way through.

**Popup forms work.** The form is found through the `elementor-widget-form` wrapper even if a theme
or optimisation plugin has stripped the `elementor-form` class off the form itself.

## Excluding a form

Two ways, and both suppress the event **entirely** — no bare conversion either:

- `SKIP_FORM_IDS` takes Elementor form IDs as strings: `['bc7d48e', '7ce0758']`. That is the value
  of the hidden `form_id` input, which is the widget's ID — seven-ish hex characters, not a number.
- `data-no-track` on the `<form>` element.

This differs from the Gravity script, which still reports a bare conversion for a `data-no-track`
form. "Ignore entirely" reads as the more honest meaning of both settings.

Put `data-no-track` on an individual input to skip just that field.

## Consent

Google Ads already refuses to transmit user-provided data when `ad_user_data` is denied. This gate
is not about that. It keeps hashed personal data out of `window.dataLayer`, which every other tag in
the container and every third-party script on the page can read regardless of what Google Ads
decides.

Consent is checked **at submit, before a single field is read**, and again before the push. It
**fails closed**: no signal, an unreadable shape, a reset dataLayer, a `default` after an `update`,
or a region-scoped entry for somewhere else all resolve to denied.

If you are not running Consent Mode v2, no user data is collected, and the script logs one console
warning saying so. Set `REQUIRE_EXPLICIT_CONSENT = false` only if you have another lawful basis.
`window.formTrackingConsentFn` overrides the check and must return exactly `true` to grant.

## Install

1. **Tags → New → Tag Configuration → Custom HTML.**
2. Open the `elementor-forms` file in this repo, select **all of it**, and paste it into the HTML
   box. Include the `<script>` and `</script>` lines.
3. Set `DEFAULT_COUNTRY` to the country most of this site's visitors are in.
4. **Triggering → All Pages.**
5. Save.

### Why DEFAULT_COUNTRY matters

It turns national phone formats into E.164. Get it wrong and every hashed phone number fails to
match, with no error reported anywhere.

## GTM setup

Seven steps, in this order. Step 1 first, because until it is done Google discards everything the
rest of this sends and tells you nothing.

**Already set this up for another form type?** Steps 1, 2, 3 and 5 are shared — the same variables
and the same Google Ads tag serve all of them. You only need step 4: a trigger on
`elementor_form_submit`, added to the conversion tag you already have.

Names in backticks are what to type. Keep them exactly as written and the later steps will reference
variables that already exist.

---

### Step 1 — Turn on enhanced conversions in Google Ads

Not in GTM. In Google Ads itself.

1. **Goals → Conversions → Summary**, and click the conversion action you want to enhance.
2. **Settings → Enhanced conversions.**
3. Tick **Turn on enhanced conversions** and accept the terms.
4. For the setup method choose **Google Tag Manager**.

If you skip this, everything below will look correct in Preview and Google will silently throw the
data away.

---

### Step 2 — Three Data Layer Variables

**Variables → User-Defined Variables → New → Data Layer Variable.** Create all three.

| Name it | Data Layer Variable Name |
|---|---|
| `DLV - user_data` | `user_data` |
| `DLV - form_id` | `form_details.form_id` |
| `DLV - form_name` | `form_details.form_name` |

In each one, open **Additional Settings** and set **Data Layer Version** to **Version 2**. The
values are nested objects and Version 1 will not reach into them.

---

### Step 3 — The User-Provided Data variable

**Variables → New → Variable Configuration → User-Provided Data.**

1. Under **Type**, choose **Code**, not Manual configuration.
2. In **Variable**, select `{{DLV - user_data}}`.
3. Name it `UPD - form user data`.

If the picker refuses a Data Layer Variable, create a **Custom JavaScript** variable named
`CJS - user data` containing the below, and point the User-Provided Data variable at that instead:

```js
function () {
  return {{DLV - user_data}};
}
```

Code mode takes the whole object in one go, which is why this is one variable rather than the ten
the old setup needed. The script already emits exactly the shape Google expects:

```js
{
  "sha256_email_address": "...",
  "sha256_phone_number": "...",
  "address": {
    "sha256_first_name": "...",
    "sha256_last_name": "...",
    "sha256_street": "...",
    "city": "southampton",
    "region": "hampshire",
    "postal_code": "so99 9xx",
    "country": "GB"
  }
}
```

---

### Step 4 — The trigger

**Triggers → New → Trigger Configuration → Custom Event.**

1. **Event name:** `elementor_form_submit`
2. Choose **Some Custom Events**.
3. Set the condition to `{{DLV - form_id}}` **equals** your enquiry form's widget id — or
   `{{DLV - form_name}}` **contains** something like `contact`.
4. Name it `CE - elementor_form_submit (leads)`.

**Do not use "All Custom Events" here.** The script listens to every Elementor form on the site, so
a bare Custom Event trigger counts all of them. Newsletter signups, popup offers, filter forms and
footer subscribe boxes would all be counted as conversions — and Elementor sites tend to have a lot
of those. If you genuinely want every form, use All Custom Events knowingly rather than by default.

`{{DLV - form_name}}` is usually the better condition here. Elementor form IDs are opaque widget
hashes like `bc7d48e`, but the form name is whatever was typed in the editor, and it survives the
widget being duplicated onto another page.

Not sure what your form's id or name is? Do step 6 first with a temporary All Custom Events trigger,
read the values off the event, then come back and add the condition.

---

### Step 5 — The Google Ads conversion tag

**Tags → New → Tag Configuration → Google Ads Conversion Tracking.**

1. **Conversion ID** and **Conversion Label** — from the conversion action in step 1.
2. Tick **Include user-provided data from your website**, and select `UPD - form user data`.
3. **Advanced Settings → Consent Settings → Require additional consent for tag to fire**, and add
   `ad_storage`.
4. **Triggering:** the trigger from step 4.
5. Name it `Google Ads - Lead conversion` and save.

The `ad_storage` requirement is not optional. The script's consent gate governs reading personal
data out of a form; it has no say over this tag, which writes `_gcl` cookies and needs consent in
its own right under PECR.

One tag covers both consent states. When consent was denied, `{{DLV - user_data}}` is simply
undefined and the conversion fires without enhanced data, which is what you want.

---

### Step 6 — Preview and check

**Preview**, load the site, submit a test form.

In the Tag Assistant window:

1. Find `elementor_form_submit` in the event list on the left. Not there? The script is not running,
   or `submit_success` is not firing. See "If no event fires" below.
2. Click the event, then the **Variables** tab. `{{DLV - user_data}}` should hold an object with
   `sha256_email_address`.
3. Check the **Tags** tab shows `Google Ads - Lead conversion` fired.

**If the event fires but `user_data` is empty**, consent is being read as denied. Open the browser
console — the script logs one warning explaining exactly that. It fails closed, so no readable
`ad_user_data` signal means no user data, deliberately.

---

### Step 7 — Publish, then confirm properly

Submit the container.

GTM Preview proves the event fires and the tag runs. It does **not** prove Google accepted or
matched the data. For that, go back to **Goals → Conversions**, click the conversion action, and
look at the **Enhanced conversions diagnostics** panel. It takes a day or two to populate and it is
the only honest confirmation that any of this worked.

## Diagnostic — run this first

Paste into the console on a page with an Elementor form, then submit. It reports what the markup
actually looks like and whether the success event behaves as this script assumes.

```js
(function () {
  var form = document.querySelector('.elementor-form') ||
             document.querySelector('.elementor-widget-form form');
  if (!form) { console.warn('no Elementor form on this page'); return; }

  var idInput = form.querySelector('input[name="form_id"]');
  console.log('form id   :', idInput ? idInput.value : '(no form_id input)');
  console.log('form name :', form.getAttribute('name') || '(none)');
  console.log('jQuery    :', typeof jQuery !== 'undefined' ? jQuery.fn.jquery : 'MISSING');

  form.addEventListener('submit', function () {
    var rows = [];
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (!el.name) return;
      var wrap = el.closest('.elementor-field-group');
      var t = '';
      if (wrap) wrap.classList.forEach(function (c) {
        if (c.indexOf('elementor-field-type-') === 0) t = c;
      });
      rows.push({
        name: el.name,
        wrapperType: t || '(none)',
        inputType: el.type,
        autocomplete: el.getAttribute('autocomplete') || '',
        value: el.type === 'password' ? '(hidden)' : el.value
      });
    });
    console.table(rows);
  }, true);

  if (typeof jQuery !== 'undefined') {
    jQuery(document).on('submit_success', function (e) {
      console.log('submit_success fired. target =', e.target,
                  '| is the form:', e.target === form);
    });
  }

  // This one should stay silent. If it logs, Elementor has started
  // dispatching a native event too and the script can be simplified.
  document.addEventListener('submit_success', function () {
    console.log('NATIVE submit_success also fired — worth knowing');
  });

  console.log('ready — submit the form');
})();
```

What to check: that `submit_success` fires at all, that its target is the form, and that
`wrapperType` is populated on the email and phone fields. If the target is not the form, say so —
the script deliberately reports nothing rather than guessing which form was submitted.

## If no event fires

1. **Nothing at all** — `submit_success` is a **jQuery** event. `document.addEventListener('submit_success', …)`
   never fires, which is the single most common reason a hand-rolled Elementor listener does nothing.
   This script uses jQuery, which Elementor loads itself, but check jQuery is actually present.
2. **The event fires but `user_data` is empty** — consent is being read as denied. The console
   carries a one-line warning explaining why.
3. **It fires on some forms and not others** — check `SKIP_FORM_IDS` and `data-no-track`.
4. **It fires but the conversion is not counted on redirect forms** — see "Why the hashing starts at
   submit" above.

## Testing

```bash
npm install playwright
npx playwright install chromium
node test/elementor-forms.test.mjs
```

65 assertions. Among them: that a field labelled "Phone" but named `form_fields[email]` never
reaches `sha256_email_address`; that a hidden earlier step of a multi-step form is still read; that a
plain non-Elementor form sitting beside an Elementor one is never reported as a conversion; that
three installs of the tag still push once; and that a success event arriving in the same tick as
submit still delivers the hashed data.

Read the header of the test file before trusting that number. It explains what these tests do and do
not prove.

## Requirements and limits

- Elementor Pro. The Forms widget is a Pro feature; free Elementor has no form to track.
- jQuery, which WordPress and Elementor load themselves, for `submit_success`.
- HTTPS. `crypto.subtle` only exists in a secure context.
- No composite address field exists in Elementor, so a full address is only assembled if the
  individual fields are named sensibly.
- Redirect-on-success races the push. Mitigated, not eliminated — see above.
- Never put `{{ ... }}` in the script. GTM substitutes that syntax anywhere in a Custom HTML tag,
  including inside comments, and rejects the tag.

## Related

Same core, same `user_data` shape, different capture layer:

- [form-tracking-html-forms](https://github.com/Nate-dogg007/form-tracking-html-forms)
- [form-tracking-ninja-forms](https://github.com/Nate-dogg007/form-tracking-ninja-forms)
- [form-tracking-contact-form-7](https://github.com/Nate-dogg007/form-tracking-contact-form-7)
- form-tracking-gravity-forms

## Files

- `elementor-forms`: the script, paste into a GTM Custom HTML tag
- `test/elementor-forms.test.mjs`: the test suite

Questions: [info@nathanoconnor.co.uk](mailto:info@nathanoconnor.co.uk)
