// Wukong edition switch for the web app. Set at build time (EXPO_PUBLIC_WUKONG=1) so the
// bundle carries no dead voice or GitHub entry points. Unset in upstream builds and tests.
export const WUKONG_BUILD = process.env.EXPO_PUBLIC_WUKONG === "1";

/** For a row Wukong removes without moving upstream's JSX: keeps the diff to one line. */
export const HIDDEN_ROW_STYLE = { display: "none" } as const;
