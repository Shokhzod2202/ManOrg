import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiCall, type DeviceSession, loadSession, saveSession } from './session';

/** Spec section 9: push through Expo (FCM on Android, APNs on iOS); the inbox stays the record. */
export async function registerForPush(): Promise<void> {
  const session = await loadSession();
  if (!session || !Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Haydar',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId) return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await apiCall(session, 'POST', '/me/devices', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  const latest = (await loadSession()) ?? session;
  await saveSession({ ...latest, pushToken: token });
}

export async function unregisterPush(session: DeviceSession): Promise<void> {
  if (session.pushToken)
    await apiCall(session, 'POST', '/me/devices/remove', { token: session.pushToken });
}
