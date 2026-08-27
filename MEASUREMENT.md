# Measuring form submissions in GA4 and Google Ads

What to build in GTM and GA4 once the tracking script is on a site. Applies whether the
script is served from the Worker or pasted into a Custom HTML tag — the dataLayer payload is
the same either way.

Every trap in here cost real time on a live site. They are written down because none of them
produce an error.

---

## What the script gives you

One event per visitor submission, on every platform:

```js
{
  event: 'nj_form_submit',              // cf7_ · gf_ · nj_ · elementor_ · html_
  form_details: {
    form_id:   '2',
    form_name: 'Callback Form'
  },
  user_data_status: 'collected',        // one of nine, see below
  cmp_detected: 'CookieYes',            // only when a CMP was found but stayed silent
  user_data: { ... }                    // hashed. Google Ads ONLY. Never GA4
}
```

**The event fires on every submission, always.** Consent only decides whether `user_data` is
attached. Anything that suppresses the event itself is a bug, not a stricter reading of
consent.

### user_data_status

| Value | Meaning |
|---|---|
| `collected` | user data attached, after a positive consent signal |
| `collected_undeclared` | attached because the site declared `CONSENT_MODE = 'none'` |
| `consent_denied` | a signal said no |
| `no_consent_signal` | `CONSENT_MODE = 'cmp'` and nothing emitted a signal |
| `region_unresolved` | consent is set per region, which a browser cannot resolve |
| `no_fields` | consent fine, nothing on the form to match on |
| `no_crypto` | SubtleCrypto missing, so not a secure context |
| `error` | hashing or assembly threw |
| `no_submit_captured` | gravity-forms only |

Before this existed, four different outcomes pushed a byte-identical event. A live site ran
for months where 342 of 365 conversions arrived with no user data, and the only trace was a
console warning nobody was reading.

---

## Step 1 — GTM variables

Three Data Layer Variables. Variables → New → **Data Layer Variable**.

| Variable name | Data Layer Variable Name | Version |
|---|---|---|
| `DLV - form_id` | `form_details.form_id` | **2** |
| `DLV - form_name` | `form_details.form_name` | **2** |
| `DLV - user_data_status` | `user_data_status` | **2** |

> **Type matters, and getting it wrong is silent.** On one live site `form_details.form_name`
> was created as a **Constant** holding the text `form_details.form_name`. It emitted that
> string on every fire, so GA4 filled up with 20 events *named* `form_details.form_name`, plus
> 4 more from a duplicated `- 1` copy. Form names had never worked there and nothing said so.
> Check the Variable **Type** is "Data Layer Variable", not the text you typed into a Constant.

> **Version 2 matters for the dotted names.** `form_details.form_name` is nested in the push.
> Version 1 looks for a flat key with a literal dot in it and finds nothing. `user_data_status`
> is top level and has **no dot** — v1 would work there, but set v2 anyway so every variable in
> the container behaves the same way.

Leave **Default Value** unset. If a key is ever missing you want the parameter absent, not
filled with something that looks like real data.

---

## Step 2 — the trigger

One Custom Event trigger covers the whole plugin family. Every adapter's event name ends in
`_form_submit`.

```
Trigger type:  Custom Event
Event name:    ^(html|cf7|gf|nj|elementor)_form_submit$
               [x] Use regex matching
Fires on:      All Custom Events
```

Anchored alternation, not `_form_submit$` — the loose version would also catch any
third-party script that happens to push a matching name.

---

## Step 3 — the GA4 event tag

**One tag. Not one per form.**

| Field | Value |
|---|---|
| Tag type | Google Analytics: GA4 Event |
| Event Name | `generate_lead` |
| Trigger | the one above |

Event Parameters:

| Parameter | Value |
|---|---|
| `form_id` | `{{DLV - form_id}}` |
| `form_name` | `{{DLV - form_name}}` |
| `user_data_status` | `{{DLV - user_data_status}}` |

> **Never add `user_data` as a parameter.** Hashed or not, that is personal data in
> Analytics — against Google's terms, and the script's own header says so. Google Ads
> enhanced conversions is the only destination for that object.

### Why `generate_lead` rather than `{{Event}}`

`{{Event}}` sends the dataLayer event name, so submissions arrive as `nj_form_submit` and a
site that changes form plugin silently changes its GA4 event name.

`generate_lead` is a Google **recommended event**: it opts into existing and future lead-gen
reporting, `value` and `currency` are understood natively if you attach them later, and it
needs no explanation at handover. The benefit is modest and real. Marking key events and
importing to Ads both work with any name.

If an action is not a lead — a brochure download, a newsletter signup — either give it its
own event name or keep it under `generate_lead` and separate it by `form_name`. The second
is fine as long as you do not mark the whole event as a key event.

### cmp_detected — optional

A fourth parameter, `{{DLV - cmp_detected}}`, fires only when no consent signal could be read
**and** a known CMP was on the page anyway. It is not a consent mechanism and adds no
protection; it tells you *which vendor* to go and fix.

`user_data_status = no_consent_signal` already detects the problem. Add `cmp_detected` if that
value ever shows up and you cannot immediately tell why.

---

## Step 4 — GA4 Admin

### Register the custom dimensions

Admin → Data display → **Custom definitions** → Create custom dimension. **Event-scoped**, all
three:

| Dimension name | Scope | Event parameter |
|---|---|---|
| Form ID | Event | `form_id` |
| Form name | Event | `form_name` |
| User data status | Event | `user_data_status` |

Without this the parameters arrive and are invisible in every report. They are not
retroactive — registration applies from the moment you save it.

### Turn off enhanced measurement "Form interactions"

Admin → Data streams → your stream → Enhanced measurement → **Form interactions: off**.

GA4 collects an automatic event called `form_submit`. On one live site it was firing 632 times
alongside the plugin, double-counting every submission under a second name.

---

## Step 5 — the reporting model

**One event, broken down by dimension.** Not one event per form.

```
generate_lead  →  break down by form_name
```

Quote form, contact form, callback form — separate rows, one tag, and a sixth form appears on
its own with no GTM work.

Building `quote_form` / `contact_form` as separate GA4 events costs:

| Limit | Cap | What eats it |
|---|---|---|
| Key events | **30 per property** | one per form, per client |
| Distinct event names | 500 | one per form |
| GTM tags to maintain | — | one per form, per container |

And you lose the "how many leads this month" number, because it is scattered across five event
names.

### When you genuinely need a separate event name

Only one reason, and it has two faces: **GA4 marks key events by event name, not by parameter
value**, and Google Ads imports conversions by event name. So if one form must be a key event
and the others must not — or one must be its own Ads conversion action — it needs its own name.

**Do that split in GA4 Admin, not GTM.** Admin → Events → Create event:

```
Create:  quote_form_submit
When:    event_name  equals    generate_lead
  AND    form_name   contains  quote
```

No new tag, no container publish. Then mark `quote_form_submit` as a key event.

Three things about created events:

- **They are additive, not a split.** The original keeps firing. You will see
  `generate_lead` 100 *and* `quote_form_submit` 20 — 120 events, not 100. Treat `generate_lead`
  as the total and the derived event as the breakdown. (`Modify event` replaces instead, but
  then you lose the single total.)
- **Not retroactive.** The rule applies from the moment you save it.
- **Matching is case-sensitive.** "Quote Form" will not match `contains quote`. Standardise
  the form names or use the regex operator, and verify with a live submission either way.

You only need a derived event for forms that need their own key event. Everything else is
already reportable as a `form_name` breakdown.

---

## Naming forms

`form_name` is the dimension the whole model rests on. Each platform supplies its own title;
when that is wrong or missing, set it on the form **or any element above it**:

```html
<div data-form-name="Quote Request">
  [ninja_form id=2]
</div>
```

The ancestor lookup is not a convenience. Ninja renders its `<form>` with no id and no class
inside a generated container, so a wrapper is the only override that platform has.

A form with no title and no override reports `unnamed_form`. Nothing is manufactured — an
invented id changes when the page changes, and a `form_name` that silently re-buckets is worse
than one visibly absent. `unnamed_form` in a report is the signal to add the attribute.

If you filter or condition on a form anywhere, **use `form_id`, not `form_name`.** A client
renaming their form silently breaks a name-based condition and nothing errors.

---

## Google Ads

Separate path, and it is the one `user_data` is for.

1. A **User-Provided Data** variable: Variables → New → User-Provided Data → **Manual
   configuration is not needed** — set it to code/variable mode and point it at
   `{{DLV - user_data}}` (a Data Layer Variable for `user_data`).
2. On the Ads Conversion Tracking tag: **Include user-provided data** → that variable.

Verified working shape, from a live container:

```
__awct  enableEnhancedConversion = true
        cssProvidedEnhancedConversionValue = __awec (mode CODE) <- DLV: user_data
```

The script hashes to Google's spec before anything reaches the dataLayer, so the UPD variable
receives already-hashed fields. `city`, `region`, `postal_code` and `country` are deliberately
in the clear, as Google requires.

The address block is **all four fields or none** — Google discards a partial address, so
sending three of four is zero benefit plus needless disclosure.

---

## Verifying it

**GTM Preview** — submit a form, confirm the `*_form_submit` event carries `form_details` and
`user_data_status`, and that the GA4 tag fired.

**GA4 DebugView** — `generate_lead` with all three parameters attached.

**GA4 Realtime** — confirms the event arrived. Note: **realtime does not expose event-scoped
custom dimensions**, so query `eventName` alone there.

**GA4 Data API / reports** — same-day data has a processing delay of a few hours. Zero rows an
hour after a test submission is normal and not evidence of a fault. Use realtime for
"did it arrive", reports for "how many".

### The report worth building once

```
generate_lead  ×  user_data_status  ×  hostname
```

That single exploration tells you which installs are collecting and which are silently not.
It is the difference between knowing collection works and assuming it. The 342-of-365 failure
would have been visible on day two.
