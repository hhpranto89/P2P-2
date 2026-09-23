import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  PhoneCall,
  SwitchCamera,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  ShieldCheck,
  Radio,
  PauseCircle,
  PlayCircle,
  Disc,
  Download,
  Check,
} from 'lucide-react';
import audioRinger from '../services/audioRinger';

export default function CallScreen({
  callState, // 'idle' | 'calling' | 'incoming' | 'connected'
  callInfo,  // { peerId, isVideo, callerName }
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onEndCall,
  p2p,
  onRecordingComplete,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isCallHeld, setIsCallHeld] = useState(false);
  const [remoteIsHolding, setRemoteIsHolding] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioWaves, setAudioWaves] = useState([20, 45, 80, 50, 30, 70, 90, 40]);
  
  // Audio Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const speakerGainNodeRef = useRef(null);

  // Play incoming ringtone or outgoing ringback
  useEffect(() => {
    if (callState === 'incoming') {
      audioRinger.startIncomingRingtone();
    } else if (callState === 'calling') {
      audioRinger.startOutgoingRingback();
    } else {
      audioRinger.stop();
    }

    return () => {
      audioRinger.stop();
    };
  }, [callState]);

  // Audio wave animation timer
  useEffect(() => {
    if (callState === 'connected' && !isCallHeld) {
      const interval = setInterval(() => {
        setAudioWaves([
          Math.floor(Math.random() * 80) + 15,
          Math.floor(Math.random() * 95) + 20,
          Math.floor(Math.random() * 90) + 25,
          Math.floor(Math.random() * 100) + 15,
          Math.floor(Math.random() * 85) + 20,
          Math.floor(Math.random() * 95) + 25,
          Math.floor(Math.random() * 80) + 15,
          Math.floor(Math.random() * 70) + 20,
        ]);
      }, 250);
      return () => clearInterval(interval);
    }
  }, [callState, isCallHeld]);

  // Call duration stopwatch
  useEffect(() => {
    let timer;
    if (callState === 'connected') {
      setCallDuration(0);
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [callState]);

  // Listen for peer call-control messages (e.g. hold / unhold)
  useEffect(() => {
    if (!p2p) return;
    const handleControl = (msg) => {
      if (msg.type === 'call-control') {
        if (msg.action === 'hold') {
          setRemoteIsHolding(!!msg.isHold);
        }
      }
    };
    p2p.on('onMessage', handleControl);
  }, [p2p]);

  // Attach media streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Handle Mute Mic
  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      const nextMuted = !isMuted;
      audioTracks.forEach((track) => {
        track.enabled = !nextMuted;
      });
      setIsMuted(nextMuted);
    }
  };

  // Handle Cam Video Disable
  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextDisabled = !isVideoDisabled;
        videoTracks.forEach((track) => {
          track.enabled = !nextDisabled;
        });
        setIsVideoDisabled(nextDisabled);
      }
    }
  };

  // Flip/Switch Camera (User vs Environment)
  const flipCamera = async () => {
    if (!localStream) return;
    try {
      const currentTrack = localStream.getVideoTracks()[0];
      if (!currentTrack) return;

      const currentFacing = currentTrack.getSettings()?.facingMode;
      const newFacing = currentFacing === 'user' ? 'environment' : 'user';

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: newFacing } },
      });
      const newTrack = newStream.getVideoTracks()[0];

      localStream.removeTrack(currentTrack);
      currentTrack.stop();
      localStream.addTrack(newTrack);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
    } catch (err) {
      console.warn('Camera switch error:', err);
    }
  };

  // Loudspeaker Mode (Boost Audio & Route to Speaker)
  const toggleSpeaker = async () => {
    const nextState = !isSpeakerOn;
    setIsSpeakerOn(nextState);

    try {
      if (remoteVideoRef.current) {
        // Use setSinkId if browser supports audio output device routing
        if (typeof remoteVideoRef.current.setSinkId === 'function') {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const speakers = devices.filter((d) => d.kind === 'audiooutput');
            const targetSink = nextState && speakers.length > 1 ? speakers[speakers.length - 1].deviceId : 'default';
            await remoteVideoRef.current.setSinkId(targetSink);
          } catch (e) {
            console.warn('setSinkId failed:', e);
          }
        }

        // Web Audio gain boost for speakerphone effect
        if (nextState) {
          remoteVideoRef.current.volume = 1.0;
        } else {
          remoteVideoRef.current.volume = 0.7;
        }
      }
    } catch (err) {
      console.warn('Speaker toggle failed:', err);
    }
  };

  // Call Hold Toggle
  const toggleHold = () => {
    const nextHold = !isCallHeld;
    setIsCallHeld(nextHold);

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.enabled = !nextHold;
      });
    }

    if (p2p) {
      p2p.sendData({
        type: 'call-control',
        action: 'hold',
        isHold: nextHold,
      });
    }
  };

  // Call Recording (Mixes Local Voice + Remote Peer Voice)
  const startRecording = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const dest = ctx.createMediaStreamDestination();

      // Connect local mic audio if present
      if (localStream && localStream.getAudioTracks().length > 0) {
        const localSource = ctx.createMediaStreamSource(localStream);
        localSource.connect(dest);
      }

      // Connect remote caller audio if present
      if (remoteStream && remoteStream.getAudioTracks().length > 0) {
        const remoteSource = ctx.createMediaStreamSource(remoteStream);
        remoteSource.connect(dest);
      }

      const recorder = new MediaRecorder(dest.stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const fileName = `CallRecord_${callInfo?.peerId || 'nexus'}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
        
        if (onRecordingComplete) {
          onRecordingComplete(audioBlob, fileName, recordDuration);
        }
        setIsRecording(false);
        setRecordDuration(0);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordDuration(0);

      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Call recording failed:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleEndCallWithCleanup = () => {
    audioRinger.stop();
    if (isRecording) {
      stopRecording();
    }
    onEndCall(callDuration);
  };

  const formatDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;
  };

  // 1. Incoming Call Dialog View
  if (callState === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-300">
        <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 text-center shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-radial from-cyan-500/15 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center">
            {/* Pulsing Avatar */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute h-28 w-28 rounded-full bg-cyan-500/20 animate-ping" />
              <div className="absolute h-24 w-24 rounded-full bg-cyan-500/40 animate-pulse" />
              <div className="h-20 w-20 rounded-full bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-cyan-500/30">
                <PhoneCall className="h-9 w-9 animate-bounce text-white" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-white tracking-tight">
              Incoming {callInfo?.isVideo ? 'Video' : 'Voice'} Call
            </h3>
            <p className="mt-1 text-sm font-semibold text-cyan-400 font-mono">
              {callInfo?.callerName || callInfo?.peerId}
            </p>
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 text-xs text-slate-300 border border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Direct P2P Encrypted</span>
            </div>

            {/* Accept / Decline actions */}
            <div className="mt-8 flex w-full items-center justify-around gap-4">
              <button
                onClick={() => {
                  audioRinger.stop();
                  onReject();
                }}
                className="flex flex-col items-center gap-1.5 group"
              >
                <div className="h-14 w-14 rounded-full bg-red-600 group-hover:bg-red-500 transition flex items-center justify-center text-white shadow-lg shadow-red-600/30 active:scale-95">
                  <PhoneOff className="h-6 w-6" />
                </div>
                <span className="text-xs text-slate-400 group-hover:text-slate-200">Decline</span>
              </button>

              <button
                onClick={() => {
                  audioRinger.stop();
                  onAccept({ isVideo: false });
                }}
                className="flex flex-col items-center gap-1.5 group"
              >
                <div className="h-14 w-14 rounded-full bg-emerald-600 group-hover:bg-emerald-500 transition flex items-center justify-center text-white shadow-lg shadow-emerald-600/30 active:scale-95">
                  <Volume2 className="h-6 w-6" />
                </div>
                <span className="text-xs text-slate-400 group-hover:text-slate-200">Voice</span>
              </button>

              {callInfo?.isVideo && (
                <button
                  onClick={() => {
                    audioRinger.stop();
                    onAccept({ isVideo: true });
                  }}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div className="h-14 w-14 rounded-full bg-cyan-600 group-hover:bg-cyan-500 transition flex items-center justify-center text-white shadow-lg shadow-cyan-600/30 active:scale-95">
                    <Video className="h-6 w-6" />
                  </div>
                  <span className="text-xs text-slate-400 group-hover:text-slate-200">Video</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Active Call or Calling Out View
  if (callState === 'calling' || callState === 'connected') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between overflow-hidden h-dynamic-screen w-full">
        {/* Top Header Bar */}
        <div
          className="relative z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/90 via-black/50 to-transparent"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-700 text-xs font-mono text-cyan-300">
              <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="truncate max-w-[120px] sm:max-w-none">{callInfo?.peerId}</span>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              {callState === 'calling' ? 'Ringing...' : formatDuration(callDuration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Live Recording Badge */}
            {isRecording && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-mono animate-pulse">
                <Disc className="w-3.5 h-3.5 text-rose-400 animate-spin" />
                <span>REC {formatDuration(recordDuration)}</span>
              </div>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Video Canvas / Audio Viewport */}
        <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950">
          {/* Call On Hold Notification Banner */}
          {(isCallHeld || remoteIsHolding) && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-semibold backdrop-blur-md">
              <PauseCircle className="w-4 h-4" />
              <span>{remoteIsHolding ? 'Peer put call on hold' : 'Call is on hold'}</span>
            </div>
          )}

          {callInfo?.isVideo && remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover transition-opacity ${
                isCallHeld || remoteIsHolding ? 'opacity-30 blur-sm' : 'opacity-100'
              }`}
            />
          ) : (
            /* Audio Only Display */
            <div className="flex flex-col items-center justify-center p-4 sm:p-6 text-center">
              <div className="relative flex items-center justify-center mb-4 sm:mb-6">
                <div className="h-24 w-24 sm:h-32 sm:w-32 rounded-full bg-gradient-to-tr from-cyan-600/30 to-indigo-600/30 animate-pulse flex items-center justify-center">
                  <div className="h-18 w-18 sm:h-24 sm:w-24 rounded-full bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white text-xl sm:text-2xl font-bold shadow-2xl">
                    {callInfo?.peerId?.slice(0, 2).toUpperCase() || 'P2P'}
                  </div>
                </div>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {callInfo?.callerName || callInfo?.peerId}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-400">
                {callState === 'calling'
                  ? 'Waiting for peer to answer...'
                  : isCallHeld
                  ? 'You put this call on hold'
                  : remoteIsHolding
                  ? 'Peer paused transmission'
                  : 'End-to-End Encrypted Audio'}
              </p>

              {/* Animated audio wave bars */}
              {callState === 'connected' && !isCallHeld && !remoteIsHolding && (
                <div className="mt-6 sm:mt-8 flex items-center justify-center gap-1.5 h-10 sm:h-12">
                  {audioWaves.map((height, i) => (
                    <div
                      key={i}
                      style={{ height: `${height}%` }}
                      className="w-1 sm:w-1.5 rounded-full bg-gradient-to-t from-cyan-500 to-indigo-400 transition-all duration-200"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Picture-in-Picture Local Video Preview */}
          {callInfo?.isVideo && localStream && (
            <div className="absolute bottom-4 right-4 z-20 w-24 h-34 sm:w-36 sm:h-48 rounded-2xl overflow-hidden border-2 border-slate-700 shadow-2xl bg-black">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isVideoDisabled ? 'hidden' : ''}`}
              />
              {isVideoDisabled && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-400 text-xs">
                  <VideoOff className="w-5 h-5 sm:w-6 sm:h-6 mb-1" />
                  <span>Cam Off</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div
          className="relative z-20 px-3 py-4 sm:py-6 bg-gradient-to-t from-black/95 via-black/85 to-transparent flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Mute Audio Toggle */}
          <button
            onClick={toggleMute}
            className={`p-3 sm:p-3.5 rounded-2xl transition shadow-lg flex flex-col items-center gap-1 ${
              isMuted
                ? 'bg-amber-600 text-white shadow-amber-600/30'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-[10px] hidden xs:block">{isMuted ? 'Muted' : 'Mute'}</span>
          </button>

          {/* Loudspeaker Toggle */}
          <button
            onClick={toggleSpeaker}
            className={`p-3 sm:p-3.5 rounded-2xl transition shadow-lg flex flex-col items-center gap-1 ${
              isSpeakerOn
                ? 'bg-cyan-600 text-white shadow-cyan-600/30'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title="Loudspeaker mode"
          >
            <Volume2 className="w-5 h-5" />
            <span className="text-[10px] hidden xs:block">{isSpeakerOn ? 'Speaker' : 'Earpiece'}</span>
          </button>

          {/* Call Hold Toggle */}
          <button
            onClick={toggleHold}
            className={`p-3 sm:p-3.5 rounded-2xl transition shadow-lg flex flex-col items-center gap-1 ${
              isCallHeld
                ? 'bg-indigo-600 text-white shadow-indigo-600/30'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title="Hold Call"
          >
            {isCallHeld ? <PlayCircle className="w-5 h-5" /> : <PauseCircle className="w-5 h-5" />}
            <span className="text-[10px] hidden xs:block">{isCallHeld ? 'Resume' : 'Hold'}</span>
          </button>

          {/* Audio Recording Button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`p-3 sm:p-3.5 rounded-2xl transition shadow-lg flex flex-col items-center gap-1 ${
              isRecording
                ? 'bg-rose-600 text-white shadow-rose-600/40 animate-pulse'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
            title={isRecording ? 'Stop Recording' : 'Record Call Audio'}
          >
            <Disc className="w-5 h-5" />
            <span className="text-[10px] hidden xs:block">{isRecording ? 'Stop Rec' : 'Record'}</span>
          </button>

          {/* Video Toggle & Switch Camera (If Video Call) */}
          {callInfo?.isVideo && (
            <>
              <button
                onClick={toggleVideo}
                className={`p-3 sm:p-3.5 rounded-2xl transition shadow-lg flex flex-col items-center gap-1 ${
                  isVideoDisabled
                    ? 'bg-amber-600 text-white shadow-amber-600/30'
                    : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                }`}
                title={isVideoDisabled ? 'Turn Cam On' : 'Turn Cam Off'}
              >
                {isVideoDisabled ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                <span className="text-[10px] hidden xs:block">{isVideoDisabled ? 'Cam Off' : 'Cam'}</span>
              </button>

              <button
                onClick={flipCamera}
                className="p-3 sm:p-3.5 rounded-2xl bg-slate-800/90 text-slate-200 hover:bg-slate-700 transition flex flex-col items-center gap-1"
                title="Switch Camera (Front/Back)"
              >
                <SwitchCamera className="w-5 h-5" />
                <span className="text-[10px] hidden xs:block">Flip</span>
              </button>
            </>
          )}

          {/* End Call / Hang Up */}
          <button
            onClick={handleEndCallWithCleanup}
            className="p-3.5 sm:p-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/40 transition active:scale-95 flex flex-col items-center gap-1"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[10px] font-semibold">End</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
