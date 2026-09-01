// The browser half of `<input type="collection-item-reference"/>`: one radio per item of another
// collection, and the answer is the chosen item's id.
//
// The Scala half (`inputs/CollectionItemReference.scala`) resolves *which* collection out of the
// fact dictionary and puts it on the fieldset as `data-collection`; the flow carries the label
// pattern as `data-item-label`. Everything else is here, because how many options there are is a
// property of the graph in this tab rather than of the flow that was built.
//
// ## Why the options are cloned rather than rendered
//
// `<fg-collection>` already builds its rows this way, for the same reason: the count is not known
// until the page runs. The `<template class="df-item-reference__option">` in the Thymeleaf template
// is the one radio, so the markup still lives in HTML and this file wires it — the repo's rule
// (ADR-001), not an exception to it.
//
// ## Why an fg-update listener, when no other input type needs one
//
// The other custom types read one fact and write one control. This one's *options* are facts:
// `/hohQualifyingPerson` lists `/hohQualifyingPeople`, a `<Filter>` over the household, so
// answering a question elsewhere on the same page adds and removes options here.
// `setInputValueFromFactValue` runs on connect and not on fg-update, so nothing else would notice.
// The listener unsubscribes itself the first time it fires for an element that has left the
// document, which is what a collection row does when it is removed — registerInputType has no
// detach hook to do it from.

import { fg } from '../../vendor/form-builder/flow-runtime/js/fact-graph-engine.js'
import { factGraph } from '../../vendor/form-builder/flow-runtime/js/fg-fact-graph.js'
import { makeCollectionIdPath } from '../../vendor/form-builder/flow-runtime/js/fg-collection-utils.js'
import { registerInputType } from '../../vendor/form-builder/flow-runtime/js/input-types.js'

/** `{{/filers/*\/firstName}}` — one fact reference inside an authored label. */
const FACT_REFERENCE = /\{\{(\/[^}]+)\}\}/g

function group (el) {
  return el.querySelector('fieldset.df-item-reference')
}

function radios (el) {
  return group(el).querySelectorAll('input[type="radio"]')
}

/** The ids currently in the referenced collection. Empty rather than throwing on a path the graph
 *  cannot resolve yet — a collection that has no items is a picker with no options, not an error. */
function itemIds (fieldset) {
  try {
    return factGraph.getCollectionIds(fieldset.dataset.collection)
  } catch (error) {
    console.error(`Could not list ${fieldset.dataset.collection}:\n`, error)
    return []
  }
}

/**
 * One item's label: the authored pattern with each `{{/path/*\/leaf}}` replaced by that item's value.
 *
 * The `*` is substituted with this item's id, not with the id of any collection the question sits
 * inside — see CollectionItemReference.scala for why the pattern may name a different collection
 * than the one being listed.
 */
function labelFor (fieldset, id) {
  const text = fieldset.dataset.itemLabel.replace(FACT_REFERENCE, (_, path) => {
    try {
      const result = factGraph.get(makeCollectionIdPath(path, id))
      return result.hasValue ? result.get.toString() : ''
    } catch (error) {
      console.error(`Could not read ${path} for collection item ${id}:\n`, error)
      return ''
    }
  })
  // An item whose naming facts are all unanswered would otherwise be a radio with no words beside
  // it. Collapsing the whitespace first is what makes "{{firstName}} {{lastName}}" with neither
  // answered reach that fallback rather than arriving as a single space.
  return text.replace(/\s+/g, ' ').trim() || fieldset.dataset.unnamed
}

/** Rebuild the radios from the collection as it stands. Idempotent: the options are replaced. */
function build (el) {
  const fieldset = group(el)
  const container = fieldset.querySelector('.df-item-reference__options')
  const option = fieldset.querySelector('template.df-item-reference__option')
  const ids = itemIds(fieldset)

  container.replaceChildren()
  for (const id of ids) {
    const row = option.content.firstElementChild.cloneNode(true)
    const radio = row.querySelector('input')
    const label = row.querySelector('label')

    radio.id = `${fieldset.id}-${id}`
    // One name for the group, so the radios are mutually exclusive — and the fieldset's id rather
    // than the fact path, because inside a collection loop the id has had the enclosing item's id
    // spliced into it and the path attribute has too. Two rows of the same loop on one page would
    // otherwise share a name and answer each other.
    radio.name = fieldset.id
    radio.value = id
    radio.required = el.getAttribute('optional') !== 'true'
    label.htmlFor = radio.id
    label.textContent = labelFor(fieldset, id)

    container.appendChild(row)
  }

  fieldset.dataset.builtFor = ids.join(' ')
  return ids
}

/** The id the graph holds for this question, or '' — placeholders deliberately do not count. */
function answeredId (el) {
  const result = factGraph.get(el.getAttribute('path'))
  return result.complete ? (result.get?.idString ?? '') : ''
}

function check (el, id) {
  for (const radio of radios(el)) radio.checked = radio.value === id
}

registerInputType('collection-item-reference', {
  read (el) {
    const checked = group(el).querySelector('input[type="radio"]:checked')
    // '' is "unanswered", which is what makes fg-set delete the fact rather than write a blank.
    if (!checked) return ''
    // Built rather than handed over as a string, for the reason masked-number.js gives: the
    // string overload of factGraph.set knows six types and CollectionItem is not one of them.
    const built = fg.CollectionItemReferenceFactory(checked.value, group(el).dataset.collection, factGraph)
    return built.isRight ? built.right : ''
  },

  write (el, value, fact) {
    check(el, fact?.complete ? (fact.get?.idString ?? '') : '')
  },

  clear (el) {
    check(el, '')
  },

  attach (el) {
    build(el)

    group(el).addEventListener('change', (event) => {
      if (event.target.type !== 'radio') return
      el.clearValidationError()
      el.onChange()
    })

    // Re-listed when the collection behind the options changes, keeping whatever is answered.
    // Guarded on the id list so the common fg-update — a fact somewhere else on the page — costs a
    // string compare and no DOM.
    const onUpdate = () => {
      if (!el.isConnected) {
        document.removeEventListener('fg-update', onUpdate)
        return
      }
      const fieldset = group(el)
      if (itemIds(fieldset).join(' ') === fieldset.dataset.builtFor) return
      build(el)
      check(el, answeredId(el))
    }
    document.addEventListener('fg-update', onUpdate)
  }
})
