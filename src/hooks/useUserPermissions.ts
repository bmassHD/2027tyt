import { useState, useEffect } from 'react';

export function useUserPermissions() {
  const [locationStatus, setLocationStatus] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>('default');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    // Check initial notification permission status
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationStatus(Notification.permission);
    }

    // Check location permission
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        setLocationStatus(result.state);
        result.onchange = () => setLocationStatus(result.state);
      }).catch(() => {});
    }
  }, []);

  const requestLocation = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        setLocationStatus('denied');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
          setLocationStatus('granted');
          resolve(coords);
        },
        () => {
          setLocationStatus('denied');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  };

  const requestNotification = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotificationStatus(perm);
      return perm === 'granted';
    } catch {
      return false;
    }
  };

  return {
    locationStatus,
    notificationStatus,
    userCoords,
    requestLocation,
    requestNotification,
  };
}
