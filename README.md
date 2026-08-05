# Elementor Pro forms tracking for Google Ads enhanced conversions

Author: Nathan O'Connor
Version: 1.0

Reads Elementor Pro form submissions, normalises and SHA-256 hashes the user-provided data fields
Google Ads wants, and pushes one `elementor_form_submit` event to the dataLayer. Personal data is
only ever read once your CMP has granted `ad_user_data`, re-checked on every submission.

**Install is one GTM Custom HTML tag.** Paste the file in, set one country code, trigger on All
Pages.

## What is verified, and what is not

**Verified against a live Elementor Pro 3.5.2 install.** The field markup in `test/` is the real
rendered HTML from a working contact form, kept verbatim — tab-padded labels, generated field IDs,
a nested field group inside an HTML field, and all. There is a test asserting exactly what that form
yields.

**The event contract is verified too, from the install's own JavaScript** rather than from
documentation. Inside Elementor Pro's `form.<hash>.bundle.min.js`:

```js
e.success ? ( t.trigger("submit_success", e.data),
              t.trigger("form_destruct", e.data),
              t.trigger("reset"), … )
```

`t` is the form. So `submit_success` is a jQuery event fired **on the form**, `form_destruct` is
what performs the redirect, and `trigger("reset")` — which empties every field — is two statements
later in the same synchronous run. That settles the two design questions this script turns on.

**Not verified: an actual submission.** Reading a client's form is free; submitting it creates a
real enquiry, so no payload has been captured end to end. Run the diagnostic below on a real
submission before treating this as proven.

## How it captures

Elementor posts the form over AJAX and, on success, fires the jQuery event `submit_success` — then
immediately resets the form. By the time anything downstream reacts, the values are on their way
out.

So this **reads the fields at submit**, while they are still there, **starts hashing immediately**,
and **commits on `submit_success`** once the submission is known to have succeeded. Nothing is
pushed for a submission that fails validation.

### Why the hashing starts at submit

SHA-256 through SubtleCrypto is asynchronous, and Elementor's **Redirect** action runs on
`form_destruct` — the statement immediately after `submit_success`, synchronously (`location.href =
t.data.redirect_url`). A hash that starts when success fires is racing a navigation that is already
queued.

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
| First name | field ID or label, or a Name field split | yes |
| Last name | field ID or label, or a Name field split | yes |
| Street | field ID or label (`address`, `street`, …) | yes |
| City | `data-upd="city"` only | no |
| Region | `data-upd="region"` only | no |
| Postcode | field ID or label (`postcode`, `zip`, …) | no |
| Country | field ID or label (`country`) | no |

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

**3. The `autocomplete` attribute**, which Elementor does not set by default but a theme might.

**4. The label, then the placeholder, then `aria-label`.** Matched whole, never as a substring.

That order is not academic. Real Elementor markup exists in which a field labelled and placeholdered
"Phone" is named `form_fields[email]`, while the actual email field sits on its generated ID
`form_fields[field_29e0ac1]`. Matching on the field ID first would hash a phone number into
`sha256_email_address` and match nothing, forever, with nothing reported anywhere. There is a test
for exactly that markup.

The phone number in that example is simply lost — there is no signal anywhere in the DOM saying it
is a phone. Losing a field is the correct outcome; poisoning the email hash is not.

**The label tier is not optional either.** Elementor generates a field ID like `field_0275ba1` for
every field nobody renames, and nobody renames them. On the live form this was verified against,
the phone, street, city, postcode and message fields all had generated IDs — so without the label
the street and the postcode were being dropped entirely.

It is matched by the same exact-match discipline as everything else: the **whole** normalised label
against the allowlist. A substring test would read "Email us your question" as an email field, and a
label is the freest text in the markup. `Street Address` matches. `Postcode*` matches. `Company
Name`, `Name of your business` and `Message` do not.

Note what this deliberately does **not** buy you: a field labelled `City` is still not collected,
because `city` and `region` live behind `data-upd` and the name matcher never looks at them. On the
verified form, "City" sits directly between "Street Address" and "Postcode" and is correctly left
alone.

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

Eight steps, in this order. Step 1 first, because until it is done Google discards everything the
rest of this sends and tells you nothing.

**Already set this up for another form type?** Steps 1, 2, 3, 5 and 6 are shared — the same
variables and the same two tags serve all of them. You only need step 4: a trigger on
`elementor_form_submit`, added to the tags you already have.

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

Not sure what your form's id or name is? Do step 7 (Preview) first with a temporary All Custom Events trigger,
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

### Step 6 — The GA4 event (if you want this in Analytics too)

Nothing so far sends anything to GA4. **The dataLayer does not reach GA4 on its own** — it is a
message bus inside the browser, and GA4 receives only what a GA4 tag explicitly sends. The event
name GA4 records is whatever you type in that tag, unrelated to the dataLayer event name.

**Before you build one, check the container for a catch-all.** If someone has previously made a GA4
Event tag on an **All Custom Events** trigger with `{{Event}}` as its name, it already forwards every
dataLayer event indiscriminately, and `elementor_form_submit` is already arriving in GA4. Adding a
second tag then double-counts. Containers that have been through a few hands often have one.

**Tags → New → Tag Configuration → Google Analytics: GA4 Event.**

1. **Measurement ID** — the property you want this in.
2. **Event Name:** `generate_lead`. See the note below before choosing.
3. **Event Parameters**, if you want to segment by form:

   | Parameter Name | Value |
   |---|---|
   | `form_id` | `{{DLV - form_id}}` |
   | `form_name` | `{{DLV - form_name}}` |

4. **Advanced Settings → Consent Settings → Require additional consent for tag to fire**, and add
   `analytics_storage`. Not `ad_storage` — that is the Ads tag's requirement, and they are separate
   permissions.
5. **Triggering:** the same trigger from step 4.
6. Name it `GA4 - Lead` and save.

To report on those parameters you also have to register them in GA4 as custom dimensions
(**Admin → Custom definitions → Create custom dimension**, event-scoped). Until you do, the data
arrives but nothing will display it.

**Then mark it a key event:** **Admin → Key events → New key event**, and type the event name. You
can do that before GA4 has ever seen the event; you do not have to wait for the first hit.

#### Do not send `user_data` to GA4

It exists for the Ads tag's User-Provided Data variable and nothing else. Adding the dataLayer
variables wholesale as event parameters pushes hashed email and phone numbers into Analytics, which
is against Google's Analytics policy. `form_id` and `form_name` are safe; the `user_data` object is
not.

#### Choosing the event name

`form_submit` is the one name to avoid — GA4's enhanced measurement already collects an automatic
event by exactly that name, and it fires on **attempt**, listening for the native submit event that
Elementor does fire. This script fires only on **success**. Reuse the name and you get a count that
is part-attempts and part-successes with no way to separate them.

Beyond that, either works:

- **`elementor_form_submit`** — matches the dataLayer name, so there is one string to search for
  across Preview, DebugView and the events list. Easiest to debug.
- **`generate_lead`** — a GA4 recommended event, which gets better treatment in the standard
  reports. More useful across several sites: the sibling scripts push `html_form_submit`,
  `nj_form_submit`, `cf7_form_submit` and `gf_form_submit`, so passing the dataLayer name through
  gives you five separate GA4 events to mark as five separate key events, and any cross-site
  reporting has to union them. Mapping them all to `generate_lead` gives one key event meaning the
  same thing everywhere, split back out by `form_name` when you need it.

On a single site it makes little difference. Across a portfolio it makes a lot.

#### Keep one path into Google Ads

If you mark this a key event in GA4 **and** import it into Google Ads as a conversion, while the
Ads conversion tag from step 5 is also firing on the same trigger, Ads counts every submission
twice.

Keep the Ads conversion tag as the thing Ads bids on and treat the GA4 event as reporting. That is
not just tidiness: **enhanced conversions only work down the Ads-tag path.** The user-provided data
rides on that tag. A GA4 key event imported into Ads uses GA4's own separate user-provided-data
mechanism instead, so importing it would cost you the one thing this script exists to do.

---

### Step 7 — Preview and check

**Preview**, load the site, submit a test form.

In the Tag Assistant window:

1. Find `elementor_form_submit` in the event list on the left. Not there? The script is not running,
   or `submit_success` is not firing. See "If no event fires" below.
2. Click the event, then the **Variables** tab. `{{DLV - user_data}}` should hold an object with
   `sha256_email_address`.
3. Check the **Tags** tab shows `Google Ads - Lead conversion` fired — and `GA4 - Lead` too, if you
   built it. Check it fired **once**, not twice: a second firing is the catch-all tag warned about
   in step 6.

**If the event fires but `user_data` is empty**, consent is being read as denied. Open the browser
console — the script logs one warning explaining exactly that. It fails closed, so no readable
`ad_user_data` signal means no user data, deliberately.

---

### Step 8 — Publish, then confirm properly

Submit the container.

GTM Preview proves the event fires and the tag runs. It does **not** prove Google accepted or
matched the data. For that, go back to **Goals → Conversions**, click the conversion action, and
look at the **Enhanced conversions diagnostics** panel. It takes a day or two to populate and it is
the only honest confirmation that any of this worked.

For the GA4 side, **Admin → DebugView** shows the event arriving in real time while Preview is on,
and the standard **Reports → Engagement → Events** list catches up within a day. The parameters will
not appear anywhere until the custom dimensions from step 6 are registered.

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

79 assertions. Fourteen of them run against markup taken verbatim from a live Elementor Pro 3.5.2
contact form, and assert exactly what that form yields — including that the form id falls back to
the widget's `data-id` because the install renders no `form_id` input at all, that the phone is
found by its type class alone, that the street and postcode are found only by their labels, and that
the "City" field sitting between them is still left alone.

Among the rest: that a field labelled "Phone" but named `form_fields[email]` never reaches
`sha256_email_address`; that a hidden earlier step of a multi-step form is still read; that a plain
non-Elementor form sitting beside an Elementor one is never reported as a conversion; that three
installs of the tag still push once; and that a success event arriving in the same tick as submit
still delivers the hashed data.

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
