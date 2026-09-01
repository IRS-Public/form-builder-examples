// The browser half of the five fixed-length digit inputs: tin, ein, pin, ip-pin, phone-number.
//
// The Scala half (`inputs/MaskedNumber.scala`) says which Fact Graph node each one binds to and
// which template renders it; this says what the digits mean. One module for the five because they
// differ only in how many digits there are, where the separators go, and which factory turns them
// into a value — see MaskedNumber.scala for why that is a parameter rather than five files.
//
// ## Why these do not go through factGraph.set(path, string)
//
// `JSGraph.set(path, value)` converts a string for the six types it knows — Boolean, Int, Enum,
// Dollar, Day, String — and returns UnsupportedTypeError for everything else. Its exported form
// dispatches on `typeof value === 'string'`, so handing it an already-built value goes to
// `Graph.set(path, WritableType)` instead, which takes the typed value as-is. That is the route the
// runtime's own multi-enum takes, and it is the one every type here takes: build the value with the
// engine's own factory, hand over the object.
//
// A consequence worth knowing: that overload returns a Scala tuple rather than a SetReturnValue, so
// `fg-set`'s `res.errorType` is undefined and it reports nothing. Validation is therefore this
// module's job, done in `attach` before the commit, with the message coming from the template's
// `data-invalid-message` so it is translated like every other string on the page.

import { fg } from '../../vendor/form-builder/flow-runtime/js/fact-graph-engine.js'
import { registerInputType } from '../../vendor/form-builder/flow-runtime/js/input-types.js'

/** Everything but the digits. Typing, pasting and autofill all arrive here. */
function digitsOf (text) {
  return (text || '').replace(/\D/g, '')
}

/** Group `digits` by inserting `separator` at each offset in `at`, as far as the digits reach. */
function group (digits, at, separator) {
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (at.includes(i)) out += separator
    out += digits.charAt(i)
  }
  return out
}

const TYPES = [
  {
    name: 'tin',
    digits: 9,
    // 123-45-6789. TinFactory takes the bare digits and splits them itself.
    display: (d) => group(d, [3, 5], '-'),
    build: (d) => fg.TinFactory(d),
    // Tin is a case class of three parts and does not override toString, so the display form is
    // rebuilt from the parts rather than parsed back out of `${value}`.
    parts: (v) => `${v.area}${v.group}${v.serial}`
  },
  {
    name: 'ein',
    digits: 9,
    display: (d) => group(d, [2], '-'),
    build: (d) => fg.EinFactory(d),
    parts: (v) => `${v.prefix}${v.serial}`
  },
  {
    name: 'pin',
    digits: 5,
    display: (d) => d,
    build: (d) => fg.PinFactory(d),
    parts: (v) => `${v}`
  },
  {
    name: 'ip-pin',
    digits: 6,
    display: (d) => d,
    build: (d) => fg.IpPinFactory(d),
    parts: (v) => `${v}`
  },
  {
    name: 'phone-number',
    digits: 10,
    display: (d) => {
      if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
      if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`
      return d
    },
    // Stored in E.164, so the country code is added on the way in and stripped on the way out.
    build: (d) => fg.UsPhoneNumberFactory(`+1${d}`),
    parts: (v) => `${v}`.replace(/^\+1/, '')
  }
]

for (const type of TYPES) {
  registerInputType(type.name, {
    read (el) {
      const digits = digitsOf(el.querySelector('input').value)
      // '' is "unanswered", which is what makes fg-set delete the fact rather than write a blank.
      if (digits.length !== type.digits) return ''
      const built = type.build(digits)
      return built.isRight ? built.right : ''
    },

    write (el, value, fact) {
      const input = el.querySelector('input')
      // `Result.get` throws on an incomplete result rather than answering undefined, so the
      // completeness check has to come first — `fact?.get` threw a NoSuchElementException out of
      // connectedCallback on every page holding an unanswered one of these, which aborted the rest
      // of that element's render. `value` is already '' when incomplete; `fact` is the raw Result.
      input.value = fact?.complete ? type.display(digitsOf(type.parts(fact.get))) : ''
    },

    clear (el) {
      el.querySelector('input').value = ''
    },

    attach (el) {
      const input = el.querySelector('input')

      input.addEventListener('input', () => {
        input.value = type.display(digitsOf(input.value).slice(0, type.digits))
      })

      const commit = () => {
        const digits = digitsOf(input.value)
        // Empty is an answer being taken back, not an error: commit it so the fact is deleted.
        if (digits === '') {
          el.clearValidationError()
          el.onChange()
          return
        }
        if (digits.length !== type.digits || !type.build(digits).isRight) {
          el.setValidationError(input.dataset.invalidMessage)
          return
        }
        el.clearValidationError()
        el.onChange()
      }

      input.addEventListener('blur', commit)
      // Before focus moves, so a question this answer reveals is focusable by the time Tab lands.
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') commit()
      })
    }
  })
}
