import { withHousehold } from '../context.js';
import { HttpError, id, json, segments } from '../http.js';
import { completeAssignment, remindAssignee, uncompleteAssignment } from '../chores.js';

// POST /households/:id/assignments/:assignmentId/(complete | uncomplete | remind)
export const POST = withHousehold(async ({ user, householdId, req }) => {
  const seg = segments(req);
  const assignmentId = id(seg[3], 'chore id');
  switch (seg[4]) {
    case 'complete': return json(await completeAssignment(user, householdId, assignmentId));
    case 'uncomplete': return json(await uncompleteAssignment(user, householdId, assignmentId));
    case 'remind': return json(await remindAssignee(user, householdId, assignmentId));
    default: throw new HttpError(404, 'Not found');
  }
});
