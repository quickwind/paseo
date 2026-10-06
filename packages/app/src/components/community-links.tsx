import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { openExternalUrl } from "@/utils/open-external-url";
import { INTERNAL_EDITION_BRAND } from "@getpaseo/protocol/internal-edition";

const renderGitHubIcon = (color: string) => <GitHubIcon color={color} size={14} />;

// Internal edition: one link to the company repository; no star, sponsor, or Discord.
export function CommunityLinks() {
  const handleOpenGitHub = useCallback(() => {
    void openExternalUrl(INTERNAL_EDITION_BRAND.repositoryUrl);
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={renderGitHubIcon}
        onPress={handleOpenGitHub}
        testID="community-links-github"
      >
        GitHub
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
