export const S = {
  user: null,        // { userId, firstName, lastName, email, ... }
  households: [],    // active households of the signed-in user
  hid: null,         // current household id
  alerts: { unread: 0, swapPending: 0 }, // for the bell in the top bar
};
export const household = () => S.households.find((h) => h.householdId === S.hid) ?? null;
export const resetState = () => { S.user = null; S.households = []; S.hid = null; S.alerts = { unread: 0, swapPending: 0 }; };
