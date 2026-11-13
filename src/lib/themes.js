const light = { bg: '#f6f6f5', card: '#ffffff', ink: '#202124', mute: '#55585f', line: '#d8dadd', accent: '#292b30', 'on-accent': '#ffffff', good: '#16733D', warn: '#855000', bad: '#A92B2B' };
const dark = { bg: '#151515', card: '#222222', ink: '#f5f5f5', mute: '#c0c0c0', line: '#515151', accent: '#eeeeee', 'on-accent': '#202124', good: '#62D493', warn: '#F3B859', bad: '#FF8585' };
// Roles describe interface styling, not Events/Chores/Finances categories.
const definitions = {
  coastal: ['Coastal', 'Orange, golden yellow, olive, and charcoal blue.', ['#FE7F2D','#FCCA46','#89925F','#627F67','#233D4D','#426C6C','#619B8A'], [0,4,1,5,3,6,2]],
  orchid: ['Orchid', 'Orchid pink, blue grey, Baltic blue, and navy.', ['#CC87D4','#9877BC','#6466A3','#709BCE','#435E85','#16213C','#210127'], [0,2,3,4,1,5,6]],
  berry: ['Berry', 'Burgundy, blackberry, berry pinks, and mint.', ['#694D6D','#63274B','#5C0029','#882F5F','#B35E94','#A0DBC0','#ACF7C1'], [4,2,6,5,3,0,1]],
  retro: ['Retro', 'Mustard yellow, paprika, berry pink, blue, and teal.', ['#F1C40F','#E5643C','#D90368','#913977','#2274A5','#11A086','#00CC66'], [1,3,0,4,5,2,6]],
  sunset: ['Sunset', 'Deep purples, blush pink, tangerine, and saffron.', ['#22162B','#341B40','#451F55','#724E91','#E54F6D','#EF8B4F','#F8C630'], [5,3,6,4,2,1,0]],
};
// Mix to opaque hex values: every surface is solid, not a translucent overlay.
function blend(base, color, amount) {
  const channels = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16));
  const a = channels(base), b = channels(color);
  return '#' + a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount).toString(16).padStart(2, '0')).join('');
}
// Retro and Coastal need curated surface balance rather than the shared recipe.
function curatedSurfaces(id, isDark, palette) {
  if (id === 'coastal') return isDark ? {
    bg: blend('#111115', palette[4], .70), card: blend('#222226', palette[4], .82),
    raised: blend('#303034', palette[5], .48), alternate: blend('#303034', palette[6], .32),
    tile: blend('#303034', palette[5], .65),
  } : {
    bg: blend('#ffffff', palette[6], .11), card: blend('#ffffff', palette[1], .08),
    raised: blend('#ffffff', palette[6], .19), alternate: blend('#ffffff', palette[0], .10),
    tile: blend('#ffffff', palette[1], .20),
  };
  if (id === 'retro') return isDark ? {
    bg: blend('#111115', palette[4], .25), card: blend('#222226', palette[4], .32),
    raised: blend('#303034', palette[4], .40), alternate: blend('#303034', palette[5], .18),
    tile: blend('#303034', palette[4], .58),
  } : {
    bg: blend('#ffffff', palette[0], .11), card: blend('#ffffff', palette[0], .045),
    raised: blend('#ffffff', palette[1], .10), alternate: blend('#ffffff', palette[0], .18),
    tile: blend('#ffffff', palette[0], .26),
  };
  return null;
}
function themeColors(base, palette, order, id) {
  const [accent, nav, highlight, detail, secondary, decoration, outline] = order.map(i => palette[i]);
  const isDark = base === dark;
  let bg = isDark ? blend('#111115', outline, .42) : blend('#ffffff', decoration, .16);
  let card = isDark ? blend('#222226', nav, .38) : blend('#ffffff', nav, .09);
  let raised = isDark ? blend('#303034', secondary, .30) : blend('#ffffff', secondary, .19);
  let alternate = isDark ? blend('#303034', accent, .19) : blend('#ffffff', accent, .15);
  let tile = isDark ? blend('#303034', highlight, .18) : blend('#ffffff', highlight, .25);
  const curated = curatedSurfaces(id, isDark, palette);
  if (curated) ({ bg, card, raised, alternate, tile } = curated);
  const surfaces = [bg, card, raised, alternate, tile];
  const ink = isDark ? '#ffffff' : '#202124';
  let mute = isDark ? '#d4d0d8' : '#55505b';
  for (let i = 0; i < 10 && surfaces.some(c => contrastRatio(c, mute) < 4.5); i++) mute = blend(mute, ink, .25);
  const readable = palette.filter(c => surfaces.every(surface => contrastRatio(c, surface) >= 4.5));
  const textAccent = readable.includes(detail) ? detail : readable[0] ?? ink;
  const focus = [highlight, detail, accent, ...palette].find(c => surfaces.every(surface => contrastRatio(c, surface) >= 3)) ?? ink;
  return { ...base, bg, card, ink, mute, line: blend(card, ink, isDark ? .25 : .22),
    'surface-raised': raised, 'surface-alternate': alternate, 'surface-tile': tile,
    accent, 'on-accent': onColor(accent), 'nav-accent': nav, 'on-nav': onColor(nav),
    highlight, 'on-highlight': onColor(highlight), 'on-decoration': onColor(decoration), 'on-outline': onColor(outline), detail, secondary, decoration, outline,
    'text-accent': textAccent, focus, good: textAccent, warn: textAccent, bad: textAccent, danger: accent };

}
export const themes = Object.fromEntries(Object.entries(definitions).map(([id, [name, description, palette, order]]) => [id, {
  name, description, palette, light: themeColors(light, palette, order, id), dark: themeColors(dark, palette, order, id),
}]));

export function onColor(hex) {
  const luminance = (color) => {
    const c = color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const value = luminance(hex), darkText = 0;
  return (value + 0.05) / (darkText + 0.05) >= 1.05 / (value + 0.05) ? '#000000' : '#FFFFFF';
}

export function contrastRatio(a, b) {
  const luminance = hex => {
    const c = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
