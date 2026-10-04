import { fmtTime } from '../core/math';
export { bracketInfo } from '../config/difficulty';
export const fmtTimeSafe = (s: number) => fmtTime(Math.max(0, s));
