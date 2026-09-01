// The browser half of `<input type="address"/>`.
//
// Six boxes in one fieldset, assembled into a Fact Graph `Address` by the engine's own
// `AddressFactory`. See masked-number.js for why the built value is handed to `factGraph.set`
// rather than a string, and why validation lives here rather than in `fg-set`.
//
// Country is not read from the form: the field is disabled and its value comes from the fieldset's
// `data-country`, which the template renders from the parser. Direct File never asks.

import { fg } from '../../vendor/form-builder/flow-runtime/js/fact-graph-engine.js'
import { registerInputType } from '../../vendor/form-builder/flow-runtime/js/input-types.js'

/** The one field whose id is not `${path}-${suffix}` — the fieldset itself carries the country. */
function field (el, suffix) {
  return el.querySelector(`[name$="-${suffix}"]`)
}

function values (el) {
  return {
    street: field(el, 'street').value.trim(),
    street2: field(el, 'street2').value.trim(),
    city: field(el, 'city').value.trim(),
    state: field(el, 'state').value,
    zip: field(el, 'zip').value.trim(),
    country: el.querySelector('fieldset').dataset.country
  }
}

/** An address the factory can accept: everything but the second street line is required. */
function build (v) {
  return fg.AddressFactory(v.street, v.city, v.zip, v.state, v.street2, v.country)
}

registerInputType('address', {
  read (el) {
    const v = values(el)
    // Nothing typed at all is "unanswered", which deletes the fact. A half-filled address is not
    // written either, but `attach` has already said so on screen.
    if (!v.street && !v.city && !v.state && !v.zip) return ''
    const built = build(v)
    return built.isRight ? built.right : ''
  },

  write (el, value, fact) {
    // `Result.get` throws on an incomplete result rather than answering undefined, so the
    // completeness check has to come first — `fact?.get` threw a NoSuchElementException out of
    // connectedCallback on every page holding an unanswered one of these, which aborted the rest
    // of that element's render. `value` is already '' when incomplete; `fact` is the raw Result.
    const address = fact?.complete ? fact.get : null
    field(el, 'street').value = address?.streetAddress ?? ''
    field(el, 'street2').value = address?.streetAddressLine2 ?? ''
    field(el, 'city').value = address?.city ?? ''
    field(el, 'state').value = address?.stateOrProvence ?? ''
    field(el, 'zip').value = address?.postalCode ?? ''
  },

  clear (el) {
    for (const suffix of ['street', 'street2', 'city', 'state', 'zip']) field(el, suffix).value = ''
  },

  attach (el) {
    const commit = () => {
      const v = values(el)
      if (!v.street && !v.city && !v.state && !v.zip) {
        el.clearValidationError()
        el.onChange()
        return
      }
      if (!build(v).isRight) {
        el.setValidationError(field(el, 'zip').dataset.invalidMessage)
        return
      }
      el.clearValidationError()
      el.onChange()
    }

    for (const suffix of ['street', 'street2', 'city', 'zip']) {
      field(el, suffix).addEventListener('blur', commit)
      field(el, suffix).addEventListener('keydown', (event) => {
        if (event.key === 'Tab') commit()
      })
    }
    field(el, 'state').addEventListener('change', commit)
  }
})
