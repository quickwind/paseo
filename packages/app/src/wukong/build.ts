// Wukong edition switch for the web app. Set at build time (EXPO_PUBLIC_WUKONG=1) so the
// bundle carries no dead voice or GitHub entry points. Unset in upstream builds and tests.
export const WUKONG_BUILD = process.env.EXPO_PUBLIC_WUKONG === "1";

/** For a row Wukong removes without moving upstream's JSX: keeps the diff to one line. */
export const HIDDEN_ROW_STYLE = { display: "none" } as const;

const Hidden = () => null;

/**
 * An upstream component Wukong does not show. Swapping the component a JSX tag names keeps
 * upstream's markup and indentation untouched, so a sync merges as a rename of two tags.
 */
export function upstreamOnly<Component>(component: Component): Component {
  return WUKONG_BUILD ? (Hidden as Component) : component;
}

/** Host settings sections Wukong does not offer: pairing goes through the relay. */
const HIDDEN_HOST_SECTIONS: ReadonlySet<string> = new Set(["pair-device"]);

export function isHostSectionOffered(section: string): boolean {
  return !(WUKONG_BUILD && HIDDEN_HOST_SECTIONS.has(section));
}

// The daemon keeps each usage report for five minutes; asking a little later than that makes
// every poll reach the source instead of re-reading the cache.
const USAGE_POLL_MS = 330_000;

/** How often the sidebar's pinned usage re-reads on its own. Upstream only refreshes on focus. */
export function usageRefetchInterval(): number | false {
  return WUKONG_BUILD ? USAGE_POLL_MS : false;
}
