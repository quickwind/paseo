// Wukong edition switch for the web app. Set at build time (EXPO_PUBLIC_WUKONG=1) so the
// bundle carries no dead voice or GitHub entry points. Unset in upstream builds and tests.
export const WUKONG_BUILD = process.env.EXPO_PUBLIC_WUKONG === "1";
