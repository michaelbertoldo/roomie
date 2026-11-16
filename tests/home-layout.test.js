// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { HOME_PRESETS, normalizeHomeLayout, connectHomeLayout } from '../src/components/home-layout.js';
afterEach(() => { document.body.innerHTML = ''; });
it('normalizes every legacy order into complete presets without independent column pins', () => {
  const orders = [['schedule','board','finances'],['schedule','finances','board'],['board','schedule','finances'],['board','finances','schedule'],['finances','board','schedule'],['finances','schedule','board']];
  for (const order of orders) for (const preset of HOME_PRESETS) {
    const layout = normalizeHomeLayout(order.map((id) => ({ id, size:'expanded', column:3 })), preset);
    expect(layout.map((w) => w.id)).toEqual(order);
    expect(layout.filter((w) => w.size === 'expanded')).toHaveLength(preset === 'equal' ? 0 : 1);
    expect(layout.every((w) => !('column' in w))).toBe(true);
  }
});
it('clears old measured spans and enables heading movement only while editing', () => {
  document.body.innerHTML = '<div class="home-dashboard" data-preset="focus-left"><div class="home-widget" data-widget="schedule" data-editing="true" style="grid-column:3;grid-row-end:span 509"><h2>November</h2></div><div class="home-widget" data-widget="board"><h2>Household board</h2></div><div class="home-widget" data-widget="finances"><h2>Finances</h2></div></div>';
  connectHomeLayout();
  const widgets=[...document.querySelectorAll('.home-widget')];
  expect(widgets.map((w) => w.dataset.slot)).toEqual(['primary','secondary','tertiary']);
  expect(widgets.every((w) => !w.style.gridColumn && !w.style.gridRowEnd)).toBe(true);
  expect(widgets[0].querySelector('h2').tabIndex).toBe(0);
  widgets[0].dataset.editing='false';connectHomeLayout();
  expect(document.querySelector('[data-widget-drag]')).toBeNull();
});
it('keeps content growth from changing the fixed dashboard slots', () => {
  document.body.innerHTML = '<div class="home-dashboard" data-preset="focus-left"><div class="home-widget" style="grid-row-end:span 103"><section class="card"><h2>Schedule</h2></section></div></div>';
  const widget = document.querySelector('.home-widget');
  widget.querySelector('.card').getBoundingClientRect = () => ({height: 800});
  connectHomeLayout();
  expect(widget.style.gridRowEnd).toBe('');
  widget.querySelector('.card').innerHTML += '<p>More content</p>'.repeat(200);
  connectHomeLayout();
  expect(widget.style.gridRowEnd).toBe('');
});
