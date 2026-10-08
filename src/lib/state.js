export const S = {
  user: null,        // { userId, firstName, lastName, email, ... }
  households: [],    // active households of the signed-in user
  hid: null,         // current household id
};
export const household = () => S.households.find((h) => h.householdId === S.hid) ?? null;
export const resetState = () => { S.user = null; S.households = []; S.hid = null; };
