import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, minTouchTarget, spacing } from '@manorg/ui';
import { stopArrivalWatch, syncArrivalWatch } from './src/arrival';
import { notificationTarget, parseMessage } from './src/bridge';
import { registerForPush, unregisterPush } from './src/push';
import { clearSession, loadSession, saveSession } from './src/session';

/** The website, which already works like the phone app on a phone (decided 2026-11-14). */
const WEB_URL: string =
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ??
  'http://localhost:3000';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Thin native wrapper: the web app in a WebView, plus the two things a web page cannot do while
 * closed: the arrival reminder (geofence) and push notifications.
 */
export default function App() {
  // WebView's type parameter defaults to undefined, which empties its props once a ref pins it.
  const web = useRef<WebView<object> | null>(null);
  const [url, setUrl] = useState(WEB_URL);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Tapping a notification opens the page it is about (the punch card for arrivals), also when
    // the tap started the app from closed.
    const open = (data: unknown) => setUrl(`${notificationTarget(WEB_URL, data)}?t=${Date.now()}`);
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) open(r.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, []);

  async function onMessage(event: WebViewMessageEvent) {
    const message = parseMessage(event.nativeEvent.data, event.nativeEvent.url, WEB_URL);
    if (!message) return;
    if (message.type === 'session') {
      await saveSession({
        refreshToken: message.refreshToken,
        orgId: message.orgId,
        origin: message.origin,
      });
      await registerForPush().catch(() => undefined);
      await syncArrivalWatch().catch(() => undefined);
    } else if (message.type === 'org') {
      const s = await loadSession();
      if (s) await saveSession({ ...s, orgId: message.orgId });
      await syncArrivalWatch().catch(() => undefined);
    } else if (message.type === 'signed-out') {
      const s = await loadSession();
      if (s) await unregisterPush(s).catch(() => undefined);
      await stopArrivalWatch().catch(() => undefined);
      await clearSession();
    }
  }

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.muted}>Check the internet and try again.</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            setFailed(false);
            web.current?.reload();
          }}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <WebView
        ref={web}
        source={{ uri: url }}
        onMessage={(e) => void onMessage(e)}
        onError={() => setFailed(true)}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        // The site's own cookie keeps the person signed in between launches.
        sharedCookiesEnabled
        // Task photos: the page asks for the camera; the API still refuses gallery pictures.
        mediaCapturePermissionGrantType="prompt"
        allowsInlineMediaPlayback
      />
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.textMuted },
  button: {
    minHeight: minTouchTarget,
    minWidth: 200,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.onPrimary, fontSize: 18, fontWeight: '600' },
});
