import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { cloneProjectRpc, searchProjectsRpc, type GitLabProject } from "../shared/rpc.js";

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
    error: { color: theme.colors.statusDanger, marginTop: 12 },
    success: { color: theme.colors.statusSuccess, marginTop: 12 },
  };
}

interface ProjectRowProps {
  project: GitLabProject;
  styles: ReturnType<typeof createStyles>;
  busy: boolean;
  cloning: boolean;
  onClone(project: GitLabProject): void;
}

function ProjectRow({ project, styles, busy, cloning, onClone }: ProjectRowProps) {
  const press = useCallback(() => onClone(project), [onClone, project]);
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{project.path}</Text>
      {project.description ? <Text style={styles.muted}>{project.description}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Clone ${project.path}`}
        style={styles.button}
        disabled={busy}
        onPress={press}
      >
        <Text style={styles.buttonText}>{cloning ? "Cloning…" : "Clone and open"}</Text>
      </Pressable>
    </View>
  );
}

export function AddFromGitLabScreen({ theme, layout }: PluginScreenProps) {
  const search = useRpc(searchProjectsRpc);
  const clone = useRpc(cloneProjectRpc);
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

  const add = useMutation({
    mutationFn: (project: GitLabProject) =>
      clone({ path: project.path, parentDirectory: folder.trim() || undefined }),
  });

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

      {add.error ? <Text style={styles.error}>{messageOf(add.error)}</Text> : null}
      {add.data ? (
        <Text style={styles.success}>
          {add.data.alreadyCloned ? "Opened existing clone " : "Cloned and opened "}
          {add.data.directory}
        </Text>
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
            busy={add.isPending}
            cloning={add.isPending && add.variables?.path === project.path}
            onClone={add.mutate}
          />
        ))}
        {results.data && results.data.projects.length === 0 ? (
          <Text style={styles.muted}>No projects found.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
