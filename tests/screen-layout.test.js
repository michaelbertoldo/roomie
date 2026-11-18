// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { connectScreenLayout } from '../src/components/screen-layout.js';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('sizes the dashboard to the screen below its header', () => {
  document.body.innerHTML = '<main id="page"><div class="home-dashboard"></div></main>';
  const dashboard = document.querySelector('.home-dashboard');
  vi.spyOn(dashboard, 'getBoundingClientRect').mockReturnValue({ top: 240 });
  vi.stubGlobal('innerHeight', 900);
  connectScreenLayout('home');
  expect(dashboard.style.getPropertyValue('--dashboard-height')).toBe('596px');
  vi.unstubAllGlobals();
});
