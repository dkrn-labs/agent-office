export const PROJECT_SCANNED = 'project:scanned';
export const PROJECT_UPDATED = 'project:updated';
export const PROJECT_REMOVED = 'project:removed';

export const SESSION_STARTED = 'session:started';
export const SESSION_UPDATE = 'session:update';
export const SESSION_IDLE = 'session:idle';
export const SESSION_ENDED = 'session:ended';
export const SESSION_ERROR = 'session:error';
export const ACTIVITY_TICK = 'activity:tick';

export const MEMORY_CREATED = 'memory:created';
export const MEMORY_UPDATED = 'memory:updated';
export const MEMORY_ARCHIVED = 'memory:archived';

export const GARDEN_RUN_STARTED = 'garden:run-started';
export const GARDEN_RUN_COMPLETED = 'garden:run-completed';
export const GARDEN_RUN_FAILED = 'garden:run-failed';

export const SKILL_MATCHED = 'skill:matched';
export const SKILL_UPDATED = 'skill:updated';

// P1-10 — WS bus minimum.
//
// `session:started` / `session:update` / `session:ended` already cover the
// session lifecycle. `savings:tick` fires on launch_budget changes so the
// UI's savings pill can refresh without polling. `quota:tick` is reserved
// for P4 (abtop-bridge) — declared here so the WS hub broadcasts it the
// instant a producer starts firing it; no need to redeploy the wire format.
export const SAVINGS_TICK = 'savings:tick';
export const QUOTA_TICK = 'quota:tick';
