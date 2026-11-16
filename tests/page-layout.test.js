// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { connectPageLayout, sizePageFrame } from '../src/components/page-layout.js';
afterEach(() => { document.body.innerHTML = ''; });
it('fits the frame below page controls and ignores content height', () => {
  document.body.innerHTML = '<main id="page"><div class="page-content"><section class="card"><h2>Plans</h2></section></div></main>';
  const frame = document.querySelector('.page-content');
  frame.getBoundingClientRect = () => ({top: 200, height: 9000});
  connectPageLayout('finances');
  expect(frame.style.getPropertyValue('--panel-height')).toBe(`${window.innerHeight - 224}px`);
  const panel = frame.querySelector('.scroll-panel');
  expect(panel.getAttribute('role')).toBe('region');
  expect(panel.getAttribute('aria-label')).toBe('Plans');
  expect(panel.tabIndex).toBe(0);
  panel.innerHTML += '<p>Long content</p>'.repeat(100);
  sizePageFrame(frame);
  expect(frame.style.getPropertyValue('--panel-height')).toBe(`${window.innerHeight - 224}px`);
});
it('keeps feature sidebars as equal bounded sections and excludes nested cards', () => {
  document.body.innerHTML = '<main id="page"><div class="page-content split cal"><section class="card"><h2>Calendar</h2><div class="card">Nested content</div></section><aside class="event-board-column"><section class="card"><h2>Make announcement</h2></section><section class="card"><h2>Announcements</h2></section></aside></div></main>';
  connectPageLayout('calendar');
  expect(document.querySelector('.panel-column').style.getPropertyValue('--panel-count')).toBe('2');
  expect(document.querySelectorAll('.scroll-panel')).toHaveLength(3);
  expect(document.querySelector('.card .card').classList.contains('scroll-panel')).toBe(false);
});
it('groups standalone page cards without swallowing page headings or actions', () => {
  document.body.innerHTML = '<main id="page"><h1 class="sr-only">Appearance</h1><section class="card"><h2>Mode</h2></section><section class="card"><h2>Palette</h2></section></main>';
  connectPageLayout('appearance'); connectPageLayout('appearance');
  expect(document.querySelectorAll('.boxed-frame')).toHaveLength(1);
  expect(document.querySelector('.boxed-frame').children).toHaveLength(2);
  expect(document.querySelector('h1').parentElement.id).toBe('page');
});
it('gives three Household cards complete columns and keeps Sign out outside profile panels', () => {
  document.body.innerHTML = '<main id="page"><div class="stack"><section class="card"><h2>Invite</h2></section><section class="card"><h2>Roommates</h2></section><section class="card"><h2>Details</h2></section><div class="acts"><button>Sign out</button></div></div></main>';
  connectPageLayout('household');
  expect(document.querySelector('.boxed-frame').style.getPropertyValue('--panel-columns')).toBe('3');
  expect(document.querySelector('.acts').parentElement.id).toBe('page');
});
