import React, { useState, useEffect } from 'react';
import {
  Radio,
  Settings,
  Plus,
  Search,
  User,
  Copy,
  Check,
  Share2,
  Trash2,
  MessageSquare,
  ChevronRight,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
  Phone,
  Video,
  AlertTriangle,
  Bell,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

const AVATAR_GRADIENTS = [
  'from-cyan-500 to-blue-600',
  'from-indigo-500 to-purple-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-fuchsia-600',
];

function getAvatarGradient(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ContactsScreen({
  myPeerId,
  myStatus = 'active', // 'active' | 'away' | 'offline'
  presenceMap = {},
  contacts = [],
  notificationPermission = 'default',
  onRequestNotifications,
  onSelectContact,
  onAddContact,
  onDeleteContact,
  onOpenSettings,
  activeRemotePeerId,
  connectionState,
  p2p,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState(null);
  const [newPeerId, setNewPeerId] = useState('');
  const [newName, setNewName] = useState('');
  const [copiedMyId, setCopiedMyId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inputError, setInputError] = useState('');

  // Proactively ping saved contacts to refresh their presence (green/yellow/gray dot)
  useEffect(() => {
    if (!p2p || contacts.length === 0) return;
    contacts.slice(0, 8).forEach((c) => {
      if (c.peerId && c.peerId.toLowerCase() !== myPeerId.toLowerCase()) {
        p2p.connectToPeer(c.peerId);
      }
    });
  }, [contacts, myPeerId, p2p]);

  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.peerId.toLowerCase().includes(q)
    );
  });

  const handleCopyMyId = () => {
    navigator.clipboard.writeText(myPeerId);
    setCopiedMyId(true);
    setTimeout(() => setCopiedMyId(false), 2000);
  };

  const handleCopyShareLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?peer=${encodeURIComponent(myPeerId)}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handlePastePeerId = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setNewPeerId(text.trim());
      }
    } catch (e) {
      console.warn('Clipboard read failed:', e);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    setInputError('');

    const targetId = newPeerId.trim().toLowerCase();
    if (!targetId) {
      setInputError('Please enter a valid Peer ID.');
      return;
    }

    if (targetId === myPeerId.toLowerCase()) {
      setInputError('Cannot add your own Peer ID.');
      return;
    }

    const created = onAddContact(targetId, newName.trim() || targetId);
    setNewPeerId('');
    setNewName('');
    setIsAddModalOpen(false);

    if (created) {
      onSelectContact(created);
    }
  };

  const handleConfirmDelete = () => {
    if (contactToDelete) {
      onDeleteContact(contactToDelete.peerId);
      setContactToDelete(null);
    }
  };

  // Helper to determine contact's presence state
  const getContactPresence = (peerId) => {
    const cleanId = peerId?.toLowerCase();
    if (presenceMap && presenceMap[cleanId]) {
      return presenceMap[cleanId];
    }
    if (p2p && typeof p2p.getPeerStatus === 'function') {
      return p2p.getPeerStatus(cleanId);
    }
    return 'offline';
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden relative w-full">
      {/* 1. Top Header */}
      <header
        className="min-h-14 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between z-20 shrink-0"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <Radio className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-white tracking-tight">Nexus P2P</h1>
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                Decentralized
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono hidden xs:block">
              Serverless Encrypted Mesh
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <PWAInstallButton />

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            title="Settings & Screen Geometry"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. Notification Permission Alert Banner (if not yet granted) */}
      {notificationPermission !== 'granted' && (
        <div className="bg-gradient-to-r from-cyan-950/80 via-indigo-950/80 to-slate-900 border-b border-cyan-800/40 px-3 py-2 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 shrink-0">
              <Bell className="w-3.5 h-3.5" />
            </div>
            <p className="text-[11px] text-slate-200 truncate">
              ব্যাকগ্রাউন্ডে কল ও মেসেজের নোটিফিকেশন পেতে অনুমতি দিন
            </p>
          </div>
          <button
            onClick={onRequestNotifications}
            className="px-2.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[11px] transition shadow-md shadow-cyan-500/20 shrink-0"
          >
            অনুমতি দিন
          </button>
        </div>
      )}

      {/* 3. My Identity & Status Card */}
      <div className="px-3 sm:px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 shrink-0">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 bg-slate-950 p-2.5 rounded-2xl border border-slate-800 shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <User className="w-4 h-4" />
              </div>
              {/* User's own live status indicator dot */}
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${
                  myStatus === 'active'
                    ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm ring-1 ring-emerald-400'
                    : myStatus === 'away'
                    ? 'bg-amber-400 shadow-amber-400/50 shadow-sm animate-pulse ring-1 ring-amber-300'
                    : 'bg-slate-600'
                }`}
                title={
                  myStatus === 'active'
                    ? 'Online & Active in app'
                    : myStatus === 'away'
                    ? 'Online in background (Data ON)'
                    : 'Offline'
                }
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  My Peer ID
                </span>
                {/* Status pill */}
                {myStatus === 'active' && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                    🟢 Active Online
                  </span>
                )}
                {myStatus === 'away' && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium">
                    🟡 Background (Data On)
                  </span>
                )}
                {myStatus === 'offline' && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                    ⚪ Offline
                  </span>
                )}
              </div>
              <p className="text-xs font-mono font-semibold text-cyan-300 truncate">
                {myPeerId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCopyMyId}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1 text-xs"
              title="Copy My ID"
            >
              {copiedMyId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="text-[10px] hidden sm:inline">{copiedMyId ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleCopyShareLink}
              className="p-1.5 rounded-xl bg-indigo-950 hover:bg-indigo-900 text-indigo-300 hover:text-white border border-indigo-800/50 transition flex items-center gap-1 text-xs"
              title="Share Link"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span className="text-[10px] hidden sm:inline">{copiedLink ? 'Copied' : 'Share'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. Search Bar */}
      <div className="px-3 sm:px-4 pt-3 pb-1 max-w-2xl mx-auto w-full shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts by name or ID..."
            className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-2xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-400 outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 5. Contacts List with Real Presence Dots */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-2 max-w-2xl mx-auto w-full space-y-1.5 pb-24">
        {filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4">
            <div className="h-16 w-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 mb-4 shadow-inner">
              <MessageSquare className="h-8 w-8 text-cyan-400/80" />
            </div>
            <h3 className="text-base font-semibold text-slate-200">
              {contacts.length === 0 ? 'No contacts saved yet' : 'No contacts found'}
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
              {contacts.length === 0
                ? "Tap the '+' button in the corner to add and message a peer ID."
                : 'No saved contacts match your search query.'}
            </p>
          </div>
        ) : (
          filteredContacts.map((contact) => {
            const isCurrentlyActive =
              activeRemotePeerId?.toLowerCase() === contact.peerId.toLowerCase();
            const presence = getContactPresence(contact.peerId);
            const gradient = getAvatarGradient(contact.peerId);
            const initial = (contact.name || contact.peerId).charAt(0).toUpperCase();

            return (
              <div
                key={contact.peerId}
                onClick={() => onSelectContact(contact)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                  isCurrentlyActive
                    ? 'bg-slate-900/90 border-cyan-500/40 shadow-lg shadow-cyan-950/30'
                    : 'bg-slate-900/40 hover:bg-slate-900/80 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar + Live Status Dot */}
                  <div className="relative shrink-0">
                    <div
                      className={`w-11 h-11 rounded-2xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-bold text-base shadow-md`}
                    >
                      {initial}
                    </div>
                    {/* Live Presence Dot:
                        🟢 Emerald = Active in app
                        🟡 Amber/Yellow = Online in background (Data on)
                        ⚪ Slate = Offline
                    */}
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${
                        presence === 'active'
                          ? 'bg-emerald-500 ring-1 ring-emerald-400'
                          : presence === 'away'
                          ? 'bg-amber-400 ring-1 ring-amber-300 animate-pulse'
                          : isCurrentlyActive && connectionState === 'connecting'
                          ? 'bg-amber-500 animate-pulse'
                          : 'bg-slate-600'
                      }`}
                      title={
                        presence === 'active'
                          ? 'Online & Active in app'
                          : presence === 'away'
                          ? 'Online in background (Data ON)'
                          : 'Offline'
                      }
                    />
                  </div>

                  {/* Name, Presence tag, and Last Message */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-100 truncate group-hover:text-cyan-300 transition">
                        {contact.name || contact.peerId}
                      </h4>
                      {/* Presence Badge */}
                      {presence === 'active' && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          Active
                        </span>
                      )}
                      {presence === 'away' && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                          🟡 Background
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {contact.peerId}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {contact.lastMessage || 'Tap to chat...'}
                    </p>
                  </div>
                </div>

                {/* Right side: Timestamp & delete action */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatTime(contact.lastMessageTime)}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setContactToDelete(contact);
                    }}
                    className="p-2 rounded-xl bg-slate-800/40 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-transparent hover:border-rose-500/30 transition active:scale-95"
                    title={`Delete ${contact.name || contact.peerId}`}
                    aria-label={`Delete ${contact.name || contact.peerId}`}
                  >
                    <Trash2 className="w-4 h-4 text-slate-400 hover:text-rose-400" />
                  </button>

                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 6. Corner '+' Floating Action Button (FAB) */}
      <div
        className="fixed bottom-6 right-6 z-30 pointer-events-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          onClick={() => {
            setInputError('');
            setIsAddModalOpen(true);
          }}
          className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/25 flex items-center justify-center transition-all active:scale-95"
          title="Add New Contact"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>

      {/* 7. Add Contact Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 w-full max-w-md shadow-2xl relative">
            <button
              onClick={() => setIsAddModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2 mb-1">
              <Plus className="w-5 h-5 text-cyan-400" />
              Add New Contact
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Enter the recipient's Peer ID to connect and chat directly.
            </p>

            <form onSubmit={handleFormSubmit} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 mb-1 block">
                  Peer ID *
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    value={newPeerId}
                    onChange={(e) => {
                      setNewPeerId(e.target.value);
                      setInputError('');
                    }}
                    placeholder="e.g. nexus-abc123"
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePastePeerId}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium"
                  >
                    Paste
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 mb-1 block">
                  Contact Nickname (Optional)
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Friend, Colleague"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                />
              </div>

              {inputError && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  {inputError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-xs font-bold text-white shadow-lg shadow-cyan-500/25"
                >
                  Save & Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Delete Confirmation Modal */}
      {contactToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 w-full max-w-sm shadow-2xl">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-3">
              <Trash2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">Delete Contact?</h3>
            <p className="text-xs text-slate-400 mt-1">
              Are you sure you want to remove{' '}
              <span className="font-semibold text-slate-200">
                {contactToDelete.name || contactToDelete.peerId}
              </span>{' '}
              and clear chat history?
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setContactToDelete(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md shadow-rose-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
