import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  pollCloneRpc,
  searchProjectsRpc,
  startCloneRpc,
  type CloneResult,
  type GitLabProject,
} from "../shared/rpc.js";

const SEARCH_DELAY_MS = 300;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const POLL_INTERVAL_MS = 1000;
const GIVE_UP_AFTER_MS = 30 * 60 * 1000;

type CloneState =
  | { status: "idle" }
  | { status: "running"; path: string; fork: boolean; step: string }
  | { status: "done"; path: string; fork: boolean; result: CloneResult }
  | { status: "failed"; path: string; fork: boolean; error: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Starts a clone (or fork then clone) on the daemon, follows it, and opens the result. */
function useCloneJob(parentDirectory: string) {
  const start = useRpc(startCloneRpc);
  const poll = useRpc(pollCloneRpc);
  const paseo = usePaseo();
  const [state, setState] = useState<CloneState>({ status: "idle" });
  const running = state.status === "running";

  const run = useCallback(
    async (project: GitLabProject, fork: boolean) => {
      if (running) return;
      const path = project.path;
      setState({ status: "running", path, fork, step: fork ? "Forking…" : "Cloning…" });
      try {
        const { id } = await start({
          path,
          fork,
          parentDirectory: parentDirectory.trim() || undefined,
        });
        for (let waited = 0; waited <= GIVE_UP_AFTER_MS; waited += POLL_INTERVAL_MS) {
          const job = await poll({ id });
          if (job.state === "failed") throw new Error(job.error ?? "The clone failed");
          if (job.state === "done" && job.result) {
            await paseo.workspaces.open(job.result.directory);
            setState({ status: "done", path, fork, result: job.result });
            return;
          }
          setState({ status: "running", path, fork, step: job.step });
          await sleep(POLL_INTERVAL_MS);
        }
        throw new Error("The clone is taking too long; check the daemon log");
      } catch (error) {
        setState({ status: "failed", path, fork, error: messageOf(error) });
      }
    },
    [running, start, poll, paseo, parentDirectory],
  );

  return { state, run };
}

function createStyles(theme: PluginScreenProps["theme"], compact: boolean) {
  return {
    screen: {
      flex: 1,
      padding: compact ? 16 : 24,
      backgroundColor: theme.colors.surface0,
    },
    label: { color: theme.colors.foregroundMuted, marginBottom: 4, marginTop: 12 },
    input: {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 6,
      padding: 10,
    },
    row: {
      padding: 12,
      marginTop: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    title: { color: theme.colors.foreground, fontWeight: "600" as const },
    muted: { color: theme.colors.foregroundMuted, marginTop: 2 },
    button: {
      marginTop: 8,
      padding: 8,
      alignSelf: "flex-start" as const,
      borderRadius: 6,
      backgroundColor: theme.colors.accent,
    },
    buttonText: { color: theme.colors.accentForeground },
    buttons: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
    secondaryButton: {
      marginTop: 8,
      padding: 8,
      alignSelf: "flex-start" as const,
      borderRadius: 6,
      borderColor: theme.colors.accent,
      borderWidth: 1,
    },
    secondaryButtonText: { color: theme.colors.accent },
    error: { color: theme.colors.statusDanger, marginTop: 12 },
    success: { color: theme.colors.statusSuccess, marginTop: 12 },
  };
}

interface ProjectRowProps {
  project: GitLabProject;
  styles: ReturnType<typeof createStyles>;
  busy: boolean;
  /** What the running job on this row is doing, or null if it is not the running row. */
  activeKind: "clone" | "fork" | null;
  onClone(project: GitLabProject, fork: boolean): void;
}

function ProjectRow({ project, styles, busy, activeKind, onClone }: ProjectRowProps) {
  const pressClone = useCallback(() => onClone(project, false), [onClone, project]);
  const pressFork = useCallback(() => onClone(project, true), [onClone, project]);
  // A team project is cloned through the user's own fork; a personal project or a fork is cloned as is.
  const offersFork = project.namespaceKind === "group";
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{project.path}</Text>
      {project.forkedFrom ? <Text style={styles.muted}>Fork of {project.forkedFrom}</Text> : null}
      {project.description ? <Text style={styles.muted}>{project.description}</Text> : null}
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clone ${project.path}`}
          style={styles.button}
          disabled={busy}
          onPress={pressClone}
        >
          <Text style={styles.buttonText}>
            {activeKind === "clone" ? "Cloning…" : "Clone and open"}
          </Text>
        </Pressable>
        {offersFork ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Fork and clone ${project.path}`}
            style={styles.secondaryButton}
            disabled={busy}
            onPress={pressFork}
          >
            <Text style={styles.secondaryButtonText}>
              {activeKind === "fork" ? "Forking…" : "Fork clone"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function activeKindFor(state: CloneState, path: string): "clone" | "fork" | null {
  if (state.status !== "running" || state.path !== path) return null;
  return state.fork ? "fork" : "clone";
}

function describe(state: Extract<CloneState, { status: "done" }>): string {
  const { result } = state;
  if (result.forkedFrom) {
    return (
      `${result.alreadyCloned ? "Opened your existing clone of" : "Forked and cloned"} ` +
      `${result.clonedPath} in ${result.directory}. Its "upstream" remote is ${result.forkedFrom}.`
    );
  }
  return `${result.alreadyCloned ? "Opened existing clone " : "Cloned and opened "}${result.directory}`;
}

export function AddFromGitLabScreen({ theme, layout }: PluginScreenProps) {
  const search = useRpc(searchProjectsRpc);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [localFolder, setLocalFolder] = useState("");
  const debouncedQuery = useDebounced(query);
  const paseo = usePaseo();

  const results = useQuery({
    queryKey: ["wukong-gitlab", "search", debouncedQuery],
    queryFn: () => search({ query: debouncedQuery }),
  });
  const cloneRoot = results.data?.cloneRoot ?? "";

  const { state: cloneState, run: runClone } = useCloneJob(folder);

  const openLocal = useMutation({
    mutationFn: async (directory: string) => (await paseo.workspaces.open(directory)).directory,
  });
  const openLocalFolder = useCallback(() => {
    const directory = localFolder.trim();
    if (directory) openLocal.mutate(directory);
  }, [localFolder, openLocal]);

  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>Search your GitLab projects</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="group/project"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search GitLab projects"
      />
      <Text style={styles.label}>Clone into</Text>
      <TextInput
        style={styles.input}
        value={folder}
        onChangeText={setFolder}
        placeholder={cloneRoot || "Default folder"}
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Folder to clone into"
      />

      <Text style={styles.label}>Or open a folder that is already on this machine</Text>
      <TextInput
        style={styles.input}
        value={localFolder}
        onChangeText={setLocalFolder}
        onSubmitEditing={openLocalFolder}
        placeholder="/absolute/path/to/project"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Local folder to open"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open local folder"
        style={styles.button}
        disabled={openLocal.isPending || !localFolder.trim()}
        onPress={openLocalFolder}
      >
        <Text style={styles.buttonText}>Open folder</Text>
      </Pressable>
      {openLocal.error ? <Text style={styles.error}>{messageOf(openLocal.error)}</Text> : null}
      {openLocal.data ? <Text style={styles.success}>Opened {openLocal.data}</Text> : null}

      {cloneState.status === "running" ? (
        <Text style={styles.muted}>
          {cloneState.path}: {cloneState.step}
        </Text>
      ) : null}
      {cloneState.status === "failed" ? (
        <Text style={styles.error}>
          {cloneState.path}: {cloneState.error}
        </Text>
      ) : null}
      {cloneState.status === "done" ? (
        <Text style={styles.success}>{describe(cloneState)}</Text>
      ) : null}
      {results.error ? <Text style={styles.error}>{messageOf(results.error)}</Text> : null}

      <ScrollView>
        {results.isFetching && !results.data ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : null}
        {results.data?.projects.map((project) => (
          <ProjectRow
            key={project.path}
            project={project}
            styles={styles}
            busy={cloneState.status === "running"}
            activeKind={activeKindFor(cloneState, project.path)}
            onClone={runClone}
          />
        ))}
        {results.data && results.data.projects.length === 0 ? (
          <Text style={styles.muted}>No projects found.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
