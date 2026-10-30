export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type ThrottleState = {
  attempts: number;
  blockedUntil: Date | null;
};

export function mayVerifyPassword(state: ThrottleState, now: Date): boolean {
  return state.attempts <= LOGIN_ATTEMPT_LIMIT && (state.blockedUntil === null || state.blockedUntil <= now);
}
