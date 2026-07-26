// Boundary violation fixture: an ambient Node global inside core must
// fail typecheck, because core pins types to an empty array.
export const violation = process.env.NODE_ENV;
