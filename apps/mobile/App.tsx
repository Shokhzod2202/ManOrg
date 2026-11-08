import { colors, minTouchTarget, spacing } from '@manorg/ui';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Employee app shell. The punch card (SHF-3) is built in Phase 1; its three buttons are the
 * largest controls on the home screen (spec section 11).
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Organization Management</Text>
      <Text style={styles.muted}>Sign in to see your punch card and tasks.</Text>
      <Pressable accessibilityRole="button" style={styles.button}>
        <Text style={styles.buttonText}>Sign in</Text>
      </Pressable>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.textMuted },
  button: {
    minHeight: minTouchTarget * 1.5,
    minWidth: 200,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.onPrimary, fontSize: 18, fontWeight: '600' },
});
