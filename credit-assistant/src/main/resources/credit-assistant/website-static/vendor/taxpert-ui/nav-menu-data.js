// Shared navigation taxonomy for the Taxpert global nav (app switcher).
//
// This is the single source of truth for the menu, consumed by every Taxpert
// app. Each leaf carries:
//   - `href`     real destination. Because the menu renders as real <a> links,
//                navigation works even before/without JS (progressive enhancement).
//   - `action`   (optional) a marker letting a host app intercept the item and
//                handle it in-app (e.g. a client-side view switch) instead of a
//                full navigation. Apps may also intercept by `id`.
//   - `disabled` (optional) a destination that does not exist yet (placeholder).
//
// Groups (items with `children`) render as an expandable section.

export const DEFAULT_MENU = [
  {
    id: 'experience-explorer',
    label: 'Experience Explorer',
    children: [
      { id: 'product-experience', label: 'Product Experience', href: '/app/eitc/' },
      { id: 'browse-all', label: 'Browse all', href: '/app/eitc/all-screens/' },
      // Interim scenario surface; refine once the scenario route is finalized.
      { id: 'scenario', label: 'Scenario', href: '/app/eitc/all-screens/?scenario=1' },
    ],
  },
  { id: 'fact-explorer', label: 'Fact Explorer', href: 'http://localhost:5180/studio' },
  { id: 'authoring-suite', label: 'Authoring Suite', href: '#', disabled: true },
]

// Resolve a menu item (group or leaf) by id, or null.
export function resolveItem(id, menu = DEFAULT_MENU) {
  if (!id) return null
  for (const item of menu) {
    if (item.id === id) return item
    const child = item.children?.find((c) => c.id === id)
    if (child) return child
  }
  return null
}

// The label shown as the current context, i.e. the part after "Taxpert |".
// For a leaf inside a group it is the group's label; for a top-level item it is
// its own label; for an unknown/absent id it is null.
export function contextLabel(activeId, menu = DEFAULT_MENU) {
  if (!activeId) return null
  for (const item of menu) {
    if (item.id === activeId) return item.label
    if (item.children?.some((c) => c.id === activeId)) return item.label
  }
  return null
}

// The full breadcrumb string shown next to the waffle, e.g.
// "Taxpert | Experience Explorer" — or just "Taxpert" when there is no context.
export function breadcrumbFor(activeId, menu = DEFAULT_MENU) {
  const ctx = contextLabel(activeId, menu)
  return ctx ? `Taxpert | ${ctx}` : 'Taxpert'
}
