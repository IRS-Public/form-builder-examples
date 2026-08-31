// The browser half of `<input type="bank-account"/>`: account type, routing number, account number,
// assembled by the engine's own `BankAccountFactory`. See masked-number.js for why the built value
// goes to `factGraph.set` rather than a string.

import { fg } from '../../vendor/form-builder/flow-runtime/js/fact-graph-engine.js'
import { registerInputType } from '../../vendor/form-builder/flow-runtime/js/input-types.js'

function field (el, suffix) {
  return el.querySelector(`[name$="-${suffix}"]`)
}

function values (el) {
  return {
    // The radios share a name, so the checked one is the answer and none checked is no answer.
    type: el.querySelector('[name$="-type"]:checked')?.value ?? '',
    routing: field(el, 'routing').value.trim(),
    account: field(el, 'account').value.trim()
  }
}

registerInputType('bank-account', {
  read (el) {
    const v = values(el)
    if (!v.type && !v.routing && !v.account) return ''
    const built = fg.BankAccountFactory(v.type, v.routing, v.account)
    return built.isRight ? built.right : ''
  },

  write (el, value, fact) {
    // `Result.get` throws on an incomplete result rather than answering undefined, so the
    // completeness check has to come first — `fact?.get` threw a NoSuchElementException out of
    // connectedCallback on every page holding an unanswered one of these, which aborted the rest
    // of that element's render. `value` is already '' when incomplete; `fact` is the raw Result.
    const account = fact?.complete ? fact.get : null
    for (const radio of el.querySelectorAll('[name$="-type"]')) {
      radio.checked = account?.accountType === radio.value
    }
    field(el, 'routing').value = account?.routingNumber ?? ''
    field(el, 'account').value = account?.accountNumber ?? ''
  },

  clear (el) {
    for (const radio of el.querySelectorAll('[name$="-type"]')) radio.checked = false
    field(el, 'routing').value = ''
    field(el, 'account').value = ''
  },

  attach (el) {
    const commit = () => {
      const v = values(el)
      if (!v.type && !v.routing && !v.account) {
        el.clearValidationError()
        el.onChange()
        return
      }
      if (!fg.BankAccountFactory(v.type, v.routing, v.account).isRight) {
        el.setValidationError(field(el, 'routing').dataset.invalidMessage)
        return
      }
      el.clearValidationError()
      el.onChange()
    }

    for (const suffix of ['routing', 'account']) {
      field(el, suffix).addEventListener('input', () => {
        field(el, suffix).value = field(el, suffix).value.replace(/\D/g, '')
      })
      field(el, suffix).addEventListener('blur', commit)
      field(el, suffix).addEventListener('keydown', (event) => {
        if (event.key === 'Tab') commit()
      })
    }
    for (const radio of el.querySelectorAll('[name$="-type"]')) {
      radio.addEventListener('change', commit)
    }
  }
})
