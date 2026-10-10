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
