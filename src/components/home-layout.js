// Presets choose slots inside a fixed rectangular frame. Long content scrolls inside each card.
export const HOME_PRESETS = ['focus-left', 'equal', 'focus-right'];
export function normalizeHomeLayout(widgets, preset = 'focus-left') {
  const ids = widgets.map((widget) => typeof widget === 'string' ? widget : widget.id);
  return ids.map((id, index) => ({ id, size: preset !== 'equal' && index === 0 ? 'expanded' : 'compact' }));
}
export function fitHomeWidgets(target = document.querySelector('.home-dashboard')) {
  if (!target?.isConnected) return;
  for (const [index, widget] of [...target.children].entries()) {
    widget.style.removeProperty('grid-column');
    widget.style.removeProperty('grid-row-end');
    widget.dataset.slot = ['primary', 'secondary', 'tertiary'][index];
    const heading = widget.querySelector('h2');
    if (!heading) continue;
    if (widget.dataset.editing === 'true') {
      heading.dataset.widgetDrag = widget.dataset.widget;
      heading.tabIndex = 0; heading.setAttribute('role', 'button');
      heading.setAttribute('aria-label', `Move ${widget.dataset.widget === 'board' ? 'Household board' : widget.dataset.widget === 'schedule' ? 'Schedule' : 'Finances'}`);
    } else {
      delete heading.dataset.widgetDrag; heading.removeAttribute('tabindex');
      heading.removeAttribute('role'); heading.removeAttribute('aria-label');
    }
  }
}
export const connectHomeLayout = () => fitHomeWidgets();
