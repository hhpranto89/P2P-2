/**
 * Contact and Chat History Manager
 * Persists saved contacts, messages, outbox queue for offline peer delivery,
 * and call log records indexed by user ID and peer ID in local storage.
 */

const CONTACTS_PREFIX = 'nexus_contacts_';
const CHAT_PREFIX = 'nexus_chats_';
const OUTBOX_PREFIX = 'nexus_outbox_';

export class ContactService {
  /**
   * Get all contacts saved against a specific User Peer ID
   */
  getContacts(myPeerId) {
    if (!myPeerId) return [];
    try {
      const raw = localStorage.getItem(`${CONTACTS_PREFIX}${myPeerId}`);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          return list.sort((a, b) => (b.lastMessageTime || b.addedAt || 0) - (a.lastMessageTime || a.addedAt || 0));
        }
      }
    } catch (e) {
      console.warn('Failed to load contacts:', e);
    }
    return [];
  }

  /**
   * Add or update a contact
   */
  saveContact(myPeerId, peerId, name = '') {
    if (!myPeerId || !peerId) return null;
    const cleanPeerId = peerId.trim().toLowerCase();
    const cleanName = name.trim() || cleanPeerId;

    const contacts = this.getContacts(myPeerId);
    const existingIndex = contacts.findIndex((c) => c.peerId.toLowerCase() === cleanPeerId);

    const now = Date.now();
    let contact;

    if (existingIndex >= 0) {
      contact = {
        ...contacts[existingIndex],
        name: cleanName,
        updatedAt: now,
      };
      contacts[existingIndex] = contact;
    } else {
      contact = {
        peerId: cleanPeerId,
        name: cleanName,
        addedAt: now,
        lastMessage: 'Tap to start conversation',
        lastMessageTime: now,
      };
      contacts.unshift(contact);
    }

    try {
      localStorage.setItem(`${CONTACTS_PREFIX}${myPeerId}`, JSON.stringify(contacts));
    } catch (e) {
      console.warn('Failed to save contact:', e);
    }

    return contact;
  }

  /**
   * Delete a contact
   */
  deleteContact(myPeerId, peerId) {
    if (!myPeerId || !peerId) return [];
    const cleanTargetId = peerId.trim().toLowerCase();
    const contacts = this.getContacts(myPeerId).filter(
      (c) => c.peerId.toLowerCase() !== cleanTargetId
    );
    try {
      localStorage.setItem(`${CONTACTS_PREFIX}${myPeerId}`, JSON.stringify(contacts));
      const chatKey = `${CHAT_PREFIX}${myPeerId}_${cleanTargetId}`;
      localStorage.removeItem(chatKey);
      const outboxKey = `${OUTBOX_PREFIX}${myPeerId}_${cleanTargetId}`;
      localStorage.removeItem(outboxKey);
    } catch (e) {
      console.warn('Failed to delete contact:', e);
    }
    return contacts;
  }

  /**
   * Update the latest message snippet and timestamp for a contact
   */
  updateLastMessage(myPeerId, peerId, text, timestamp = Date.now()) {
    if (!myPeerId || !peerId) return;
    const cleanPeerId = peerId.trim().toLowerCase();
    const contacts = this.getContacts(myPeerId);
    const index = contacts.findIndex((c) => c.peerId.toLowerCase() === cleanPeerId);

    if (index >= 0) {
      contacts[index].lastMessage = text || 'Media message';
      contacts[index].lastMessageTime = timestamp;
      try {
        localStorage.setItem(`${CONTACTS_PREFIX}${myPeerId}`, JSON.stringify(contacts));
      } catch (e) {}
    } else {
      this.saveContact(myPeerId, cleanPeerId, cleanPeerId);
      this.updateLastMessage(myPeerId, cleanPeerId, text, timestamp);
    }
  }

  /**
   * Get chat messages history with a specific peer
   */
  getChatHistory(myPeerId, peerId) {
    if (!myPeerId || !peerId) return [];
    try {
      const key = `${CHAT_PREFIX}${myPeerId}_${peerId.trim().toLowerCase()}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {}
    return [];
  }

  /**
   * Append a chat message to history (limit to last 300 messages per peer)
   */
  saveChatMessage(myPeerId, peerId, message) {
    if (!myPeerId || !peerId || !message) return;
    try {
      const cleanPeerId = peerId.trim().toLowerCase();
      const key = `${CHAT_PREFIX}${myPeerId}_${cleanPeerId}`;
      const history = this.getChatHistory(myPeerId, cleanPeerId);
      const existingIdx = history.findIndex((m) => m.id === message.id);
      let updated;
      if (existingIdx >= 0) {
        updated = [...history];
        updated[existingIdx] = { ...updated[existingIdx], ...message };
      } else {
        updated = [...history, message].slice(-300);
      }
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (e) {}
  }

  /**
   * Update message delivery/read status in history
   */
  updateMessageStatus(myPeerId, peerId, messageId, status) {
    if (!myPeerId || !peerId || !messageId) return;
    try {
      const cleanPeerId = peerId.trim().toLowerCase();
      const key = `${CHAT_PREFIX}${myPeerId}_${cleanPeerId}`;
      const history = this.getChatHistory(myPeerId, cleanPeerId);
      const updated = history.map((m) => (m.id === messageId ? { ...m, status } : m));
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (e) {}
  }

  /**
   * Save a call event directly into chat history (WhatsApp-like Call Log bubble)
   */
  saveCallLog(myPeerId, peerId, { isVideo, isOutgoing, status, duration = 0, timestamp = Date.now() }) {
    if (!myPeerId || !peerId) return null;
    const cleanPeerId = peerId.trim().toLowerCase();
    const id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const callMessage = {
      id,
      type: 'call-log',
      isVideo: !!isVideo,
      isOutgoing: !!isOutgoing,
      status, // 'connected' | 'missed' | 'declined' | 'cancelled'
      duration, // in seconds
      timestamp,
      sender: isOutgoing ? myPeerId : cleanPeerId,
      isSelf: !!isOutgoing,
    };

    this.saveChatMessage(myPeerId, cleanPeerId, callMessage);

    // Human-readable snippet for contact screen list
    let snippet = '';
    if (status === 'missed') {
      snippet = isVideo ? '📹 Missed video call' : '📞 Missed audio call';
    } else if (status === 'declined') {
      snippet = isVideo ? '📹 Declined video call' : '📞 Declined audio call';
    } else {
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const durStr = `${mins}:${secs.toString().padStart(2, '0')}`;
      snippet = isVideo ? `📹 Video call (${durStr})` : `📞 Audio call (${durStr})`;
    }

    this.updateLastMessage(myPeerId, cleanPeerId, snippet, timestamp);
    return callMessage;
  }

  /**
   * Offline Outbox Queue: Store messages on sender device when recipient is offline
   */
  saveToOutbox(myPeerId, peerId, message) {
    if (!myPeerId || !peerId || !message) return;
    try {
      const cleanPeerId = peerId.trim().toLowerCase();
      const key = `${OUTBOX_PREFIX}${myPeerId}_${cleanPeerId}`;
      const existing = this.getOutbox(myPeerId, cleanPeerId);
      if (!existing.some((m) => m.id === message.id)) {
        const updated = [...existing, message];
        localStorage.setItem(key, JSON.stringify(updated));
      }
    } catch (e) {}
  }

  getOutbox(myPeerId, peerId) {
    if (!myPeerId || !peerId) return [];
    try {
      const cleanPeerId = peerId.trim().toLowerCase();
      const key = `${OUTBOX_PREFIX}${myPeerId}_${cleanPeerId}`;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  removeFromOutbox(myPeerId, peerId, messageId) {
    if (!myPeerId || !peerId || !messageId) return;
    try {
      const cleanPeerId = peerId.trim().toLowerCase();
      const key = `${OUTBOX_PREFIX}${myPeerId}_${cleanPeerId}`;
      const existing = this.getOutbox(myPeerId, cleanPeerId);
      const filtered = existing.filter((m) => m.id !== messageId);
      localStorage.setItem(key, JSON.stringify(filtered));
    } catch (e) {}
  }
}

export const contactService = new ContactService();
export default contactService;
