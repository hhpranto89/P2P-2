/**
 * Nexus P2P Messenger - Unified Notification Service
 * Works across Web Browsers, Progressive Web Apps (PWA), Service Worker background pushes,
 * and native Android WebView JavascriptInterface bridges.
 */

class NotificationService {
  constructor() {
    this.permission = typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default';
  }

  /**
   * Check if notifications are granted
   */
  isGranted() {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    return Notification.permission === 'granted';
  }

  getPermissionState() {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  /**
   * Request notification permission from user
   */
  async requestPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    try {
      const res = await Notification.requestPermission();
      this.permission = res;
      return res === 'granted';
    } catch (e) {
      console.warn('[NotificationService] Permission request failed:', e);
      return false;
    }
  }

  /**
   * Send notification for incoming chat message
   */
  async showMessageNotification(senderId, senderName, text) {
    const title = `💬 ${senderName || senderId}`;
    const body = text || 'Sent you a message';

    // 1. Android Native WebView Bridge (if app is loaded in Android Studio WebView)
    if (typeof window !== 'undefined') {
      const android = window.AndroidBridge || window.Android;
      if (android && typeof android.showNotification === 'function') {
        try {
          android.showNotification(title, body, 'message');
          return true;
        } catch (e) {
          console.warn('[NotificationService] Android bridge failed:', e);
        }
      }
    }

    // 2. Service Worker showNotification (Best for Android background / screen lock)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: `msg-${senderId}`,
            vibrate: [200, 100, 200],
            renotify: true,
            data: { url: `/?peer=${encodeURIComponent(senderId)}`, type: 'message', senderId },
          });
          return true;
        }
      } catch (e) {
        console.warn('[NotificationService] Service worker showNotification failed:', e);
      }
    }

    // 3. Native Web Notification fallback
    if (this.isGranted()) {
      try {
        new Notification(title, {
          body,
          icon: '/icon.svg',
          tag: `msg-${senderId}`,
        });
        return true;
      } catch (e) {
        console.warn('[NotificationService] Web notification fallback failed:', e);
      }
    }

    return false;
  }

  /**
   * Send notification for incoming audio/video call
   */
  async showCallNotification(callerId, callerName, isVideo) {
    const callType = isVideo ? 'Video Call' : 'Voice Call';
    const title = `📞 Incoming ${callType}`;
    const body = `${callerName || callerId} is calling you...`;

    // 1. Android Native WebView Bridge
    if (typeof window !== 'undefined') {
      const android = window.AndroidBridge || window.Android;
      if (android && typeof android.showNotification === 'function') {
        try {
          android.showNotification(title, body, 'call');
          return true;
        } catch (e) {
          console.warn('[NotificationService] Android bridge call notification failed:', e);
        }
      }
    }

    // 2. Service Worker showNotification with actions & requireInteraction
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: `call-${callerId}`,
            vibrate: [500, 250, 500, 250, 500, 250, 1000],
            renotify: true,
            requireInteraction: true, // Remains on screen on Android lock screen / status bar
            actions: [
              { action: 'answer', title: '📞 Answer' },
              { action: 'decline', title: '❌ Decline' },
            ],
            data: { url: `/?peer=${encodeURIComponent(callerId)}`, type: 'call', callerId },
          });
          return true;
        }
      } catch (e) {
        console.warn('[NotificationService] Service worker call notification failed:', e);
      }
    }

    // 3. Web Notification fallback
    if (this.isGranted()) {
      try {
        new Notification(title, {
          body,
          icon: '/icon.svg',
          tag: `call-${callerId}`,
          requireInteraction: true,
        });
        return true;
      } catch (e) {
        console.warn('[NotificationService] Web call notification fallback failed:', e);
      }
    }

    return false;
  }

  /**
   * Clear any active call notification
   */
  async clearCallNotification(callerId) {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.getNotifications) {
          const notifications = await reg.getNotifications({ tag: `call-${callerId}` });
          notifications.forEach((n) => n.close());
        }
      } catch (e) {}
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
