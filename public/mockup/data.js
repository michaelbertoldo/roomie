// Mock data. "Today" is fixed at Thu 2026-10-01 so the demo is stable.
const TODAY = '2026-10-01';

function splitShares(total, buyer, ids) {
  const base = Math.floor(total / ids.length), rem = total - base * ids.length, sh = {};
  ids.forEach(id => { sh[id] = { amt: base + (id === buyer ? rem : 0), status: id === buyer ? 'paid' : 'unpaid', date: null }; });
  return sh;
}
function mkPurchase(id, item, total, buyer, date, ids, method, patch = {}) {
  const p = { id, item, total, buyer, date, method, split: ids, shares: splitShares(total, buyer, ids) };
  Object.entries(patch).forEach(([uid, s]) => Object.assign(p.shares[uid], s));
  return p;
}

const PEOPLE = {
  u1: { id: 'u1', first: 'Alex', last: 'Rivera', nick: 'Lex', color: '#6366f1', phone: '(512) 555-0141', email: 'alex@utexas.edu', location: 'Austin, TX', allergies: 'None', venmo: '@alex-rivera', zelle: '', apple: '', pref: 'Venmo', role: 'owner', manage: true },
  u2: { id: 'u2', first: 'Priya', last: 'Shah', nick: '', color: '#db2777', phone: '(512) 555-0188', email: 'priya@utexas.edu', location: 'Dallas, TX', allergies: 'Peanuts', venmo: '@priya-shah', zelle: '', apple: '', pref: 'Venmo', role: 'member', manage: false },
  u3: { id: 'u3', first: 'Jake', last: 'Moreno', nick: '', color: '#0d9488', phone: '(512) 555-0102', email: 'jake@utexas.edu', location: 'Houston, TX', allergies: 'Shellfish', venmo: '', zelle: 'jake.m@utexas.edu', apple: '', pref: 'Zelle', role: 'member', manage: false },
  u4: { id: 'u4', first: 'Sam', last: 'Okafor', nick: '', color: '#d97706', phone: '(512) 555-0177', email: 'sam@utexas.edu', location: 'Austin, TX', allergies: 'Lactose', venmo: '', zelle: '', apple: '', pref: '', role: 'member', manage: false },
};
const EXTRA = ['Riley', 'Morgan', 'Casey', 'Devon', 'Jordan'];

function seed() {
  return {
    me: 'u1',
    house: { name: '412 Maple St', color: 'indigo', address: '412 Maple St, Austin, TX 78705', currency: 'USD', type: 'Apartment', code: 'MAPLE-4821', calName: 'Maple House Calendar', landlord: '' },
    users: JSON.parse(JSON.stringify(PEOPLE)),
    order: ['u1', 'u2', 'u3', 'u4'],
    chores: [
      { id: 'c1', name: 'Take out trash', desc: 'Kitchen + bathroom bins to the curb.', assignee: 'u1', by: 'u2', type: 'recurring', days: [1, 4], time: '19:00', date: '2026-10-01', effort: 'easy', notes: '', status: 'pending', lastDone: '2026-09-28', rotate: false, cal: true },
      { id: 'c2', name: 'Clean bathroom', desc: 'Toilet, sink, shower, mirror, floor.', assignee: 'u2', by: 'u2', type: 'recurring', days: [6], time: '10:00', date: '2026-10-03', effort: 'hard', notes: 'Use the green spray.', status: 'pending', lastDone: '2026-09-26', rotate: false, cal: true, swap: { from: 'u2', toChore: 'c1', reason: 'Visiting family this weekend', status: 'pending' } },
      { id: 'c3', name: 'Vacuum living room', desc: '', assignee: 'u3', by: 'u1', type: 'one-time', days: [], time: '18:00', date: '2026-09-29', effort: 'medium', notes: '', status: 'overdue', lastDone: null, rotate: false, cal: true },
      { id: 'c4', name: 'Kitchen reset', desc: 'Dishes, counters, stovetop.', assignee: 'u4', by: 'u1', type: 'recurring', days: [0, 3], time: '20:00', date: '2026-10-04', effort: 'medium', notes: '', status: 'pending', lastDone: '2026-09-30', rotate: false, cal: true },
      { id: 'c5', name: 'Wipe down counters', desc: '', assignee: 'u1', by: 'u1', type: 'one-time', days: [], time: '17:00', date: '2026-10-02', effort: 'easy', notes: '', status: 'pending', lastDone: null, rotate: false, cal: true },
      { id: 'c6', name: 'Recycling run', desc: 'Rotates through the house.', assignee: 'u3', by: 'u1', type: 'recurring', days: [5], time: '09:00', date: '2026-10-02', effort: 'easy', notes: '', status: 'pending', lastDone: '2026-09-25', rotate: true, rotation: ['u1', 'u2', 'u3', 'u4'], cal: true },
    ],
    purchases: [
      mkPurchase('p1', 'Dish soap & sponges', 1250, 'u1', '2026-09-29', ['u1', 'u2', 'u3'], 'Venmo', { u2: { status: 'claimed' } }),
      mkPurchase('p2', 'Paper towels (bulk)', 2499, 'u2', '2026-09-28', ['u1', 'u2', 'u3', 'u4'], 'Venmo', { u4: { status: 'paid', date: '2026-09-30' } }),
      mkPurchase('p3', 'Wi-Fi router', 6000, 'u3', '2026-09-24', ['u1', 'u2', 'u3', 'u4'], 'Zelle', { u2: { status: 'paid', date: '2026-09-26' } }),
      mkPurchase('p4', 'Cleaning spray', 800, 'u4', '2026-09-27', ['u1', 'u4'], 'Venmo'),
      mkPurchase('p5', 'Toilet paper', 1800, 'u1', '2026-09-20', ['u1', 'u2', 'u3', 'u4'], 'Venmo', { u2: { status: 'paid', date: '2026-09-21' }, u3: { status: 'paid', date: '2026-09-22' }, u4: { status: 'paid', date: '2026-09-21' } }),
    ],
    notifs: [
      { id: 'n1', group: 'Chores', who: 'u2', text: 'asked to swap <b>Clean bathroom</b> for your <b>Take out trash</b>. “Visiting family this weekend.”', when: '2h ago', age: 0, unread: true, kind: 'swap', ref: 'c2' },
      { id: 'n2', group: 'Events & Hosting', who: 'u3', text: 'wants to host <b>6 guests</b> Friday, 7 to 11 PM. Is that okay?', when: '3h ago', age: 0, unread: true, kind: 'host', ref: 'e1' },
      { id: 'n3', group: 'Money', who: 'u2', text: 'says they paid you <b>$4.16</b> for Dish soap & sponges. Did you get it?', when: '5h ago', age: 0, unread: true, kind: 'claim', ref: 'p1:u2' },
      { id: 'n4', group: 'Money', who: 'u4', text: 'split <b>Cleaning spray</b> with you: you owe <b>$4.00</b>.', when: 'Yesterday', age: 1, unread: false, kind: 'info', route: '#/finances' },
      { id: 'n5', group: 'Board', who: 'u3', text: 'replied to your post: “Got it, will clean the kitchen.”', when: 'Yesterday', age: 1, unread: false, kind: 'info', route: '#/home' },
      { id: 'n6', group: 'Chores', who: null, text: '<b>Vacuum living room</b> is overdue (assigned to Jake).', when: '2 days ago', age: 2, unread: false, kind: 'info', route: '#/chore/c3' },
      { id: 'n7', group: 'Board', who: 'u4', text: 'mentioned you in a post.', when: '3 days ago', age: 3, unread: false, kind: 'deleted', ref: 'post' },
      { id: 'n8', group: 'Money', who: 'u2', text: 'confirmed your payment of <b>$15.00</b> for Wi-Fi router.', when: '9 days ago', age: 9, unread: false, kind: 'info', route: '#/finances' },
      { id: 'n9', group: 'Events & Hosting', who: 'u4', text: 'added <b>Sam’s birthday dinner</b> to the calendar.', when: '12 days ago', age: 12, unread: false, kind: 'info', route: '#/calendar' },
    ],
    events: [
      { id: 'e1', name: 'Game night (hosting)', date: '2026-10-02', time: '19:00', cat: 'hosting', desc: 'Jake is hosting friends.', link: '', by: 'u3', host: { guests: 6, from: '19:00', to: '23:00', responses: { u1: null, u2: 'agree', u3: 'agree', u4: null } } },
      { id: 'e2', name: 'House meeting', date: '2026-10-04', time: '18:00', cat: 'house meeting', desc: 'Landlord inspection prep and chore review.', link: '', by: 'u1' },
      { id: 'e3', name: 'Sam’s birthday dinner', date: '2026-10-10', time: '19:30', cat: 'other', desc: 'Dinner at home, everyone chips in.', link: '', by: 'u4', featured: true },
    ],
    posts: [
      { id: 'b1', by: 'u1', when: 'Yesterday', text: 'Reminder: landlord inspection is Tuesday. Please clear common areas.', ev: 'e2', replies: [{ by: 'u3', when: 'Yesterday', text: 'Got it, will clean the kitchen.' }] },
      { id: 'b2', by: 'u2', when: '2 days ago', text: 'Anyone want to split a pizza order tonight?', ev: null, replies: [] },
    ],
    wish: {
      needs: [{ id: 'w1', name: 'Dish soap', est: 600, who: 'u2', comments: [] }, { id: 'w2', name: 'Trash bags', est: 900, who: null, comments: [{ by: 'u3', text: 'The 13 gallon kind.' }] }],
      wants: [{ id: 'w3', name: 'Air fryer', est: 5500, who: null, comments: [] }, { id: 'w4', name: 'Throw blanket', est: 2500, who: null, comments: [] }],
    },
    rent: { amount: 240000, due: '2026-10-05', remind: true, paid: { u1: false, u2: true, u3: false, u4: false } },
    subs: [
      { id: 's1', name: 'Netflix', owner: 'u2', amount: 1799, due: '2026-10-10' },
      { id: 's2', name: 'Wi-Fi', owner: 'u3', amount: 6500, due: '2026-10-15' },
      { id: 's3', name: 'Spotify Family', owner: 'u4', amount: 1999, due: '2026-10-20' },
    ],
    history: [
      { d: '2026-09-30', t: 'Sam paid Priya $6.24 for Paper towels' },
      { d: '2026-09-26', t: 'Priya paid Jake $15.00 for Wi-Fi router' },
      { d: '2026-09-22', t: 'Jake paid you $4.50 for Toilet paper' },
    ],
    notes: [{ id: 'k1', date: '2026-10-02', text: 'Quiet hours start at 10 PM', urgent: false, by: 'u1' }],
    widgets: [
      { id: 'events', on: true }, { id: 'chores', on: true }, { id: 'owe', on: true }, { id: 'rent', on: true },
      { id: 'buy', on: true }, { id: 'featured', on: true }, { id: 'upcomingpay', on: false }, { id: 'important', on: false },
    ],
  };
}

// Empty household: used for the "just created" flow and the empty-state demo.
function emptySeed(order) {
  const s = seed();
  s.order = order;
  s.chores = []; s.purchases = []; s.notifs = []; s.events = []; s.posts = [];
  s.wish = { needs: [], wants: [] }; s.subs = []; s.history = []; s.notes = [];
  s.rent = { amount: 0, due: '2026-10-05', remind: true, paid: {} };
  return s;
}
