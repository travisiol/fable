/** Wall clock for server components (kept out of render bodies for the React Compiler lint). */
export const now = (): number => Date.now();
