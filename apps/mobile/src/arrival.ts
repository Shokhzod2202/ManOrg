import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { apiCall, loadSession } from './session';

/**
 * Spec section 9: "You came to work. Start shift".
 * - Only the geofence enter event is used; no tracking, and no location is sent to the server.
 * - The server decides (planned shift in the window, not already working); the app only shows the
 *   notification. Tapping it opens the punch card; the employee still taps Start Shift.
 */
export const ARRIVAL_TASK = 'manorg-arrival';

interface Region {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

interface ArrivalCheck {
  prompt: boolean;
  message: string | null;
}

interface OrganizationLocation {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
}

// Must be defined when the JavaScript bundle loads, so the OS can wake the app for it.
TaskManager.defineTask<Region>(ARRIVAL_TASK, async ({ data, error }) => {
  if (error || data?.eventType !== Location.GeofencingEventType.Enter) return;
  const session = await loadSession();
  if (!session?.orgId) return;
  const check = await apiCall<ArrivalCheck>(session, 'POST', '/punch/arrival');
  if (!check?.prompt) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: check.message ?? 'You came to work. Start shift',
      body: 'Open your punch card',
      data: { url: '/app' },
    },
    trigger: null,
  });
});

/**
 * Registers the bakery geofence when the organization has the prompt on and the employee has not
 * turned it off; otherwise removes it. Asks for location permission only when it is needed.
 */
export async function syncArrivalWatch(): Promise<'on' | 'off' | 'no-permission'> {
  const session = await loadSession();
  const stop = async () => {
    if (await Location.hasStartedGeofencingAsync(ARRIVAL_TASK).catch(() => false)) {
      await Location.stopGeofencingAsync(ARRIVAL_TASK);
    }
  };
  if (!session?.orgId) {
    await stop();
    return 'off';
  }
  const [place, me] = await Promise.all([
    apiCall<OrganizationLocation>(session, 'GET', '/organization/location'),
    apiCall<{ preferences?: { arrivalPrompt?: boolean } }>(
      { ...session, orgId: null },
      'GET',
      '/me',
    ),
  ]);
  const wanted =
    place?.enabled &&
    place.latitude !== null &&
    place.longitude !== null &&
    me?.preferences?.arrivalPrompt !== false;
  if (!wanted || !place || place.latitude === null || place.longitude === null) {
    await stop();
    return 'off';
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'no-permission';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'no-permission';
  await Location.startGeofencingAsync(ARRIVAL_TASK, [
    {
      identifier: 'bakery',
      latitude: place.latitude,
      longitude: place.longitude,
      radius: place.radiusM,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
  ]);
  return 'on';
}

export async function stopArrivalWatch(): Promise<void> {
  if (await Location.hasStartedGeofencingAsync(ARRIVAL_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(ARRIVAL_TASK);
  }
}
