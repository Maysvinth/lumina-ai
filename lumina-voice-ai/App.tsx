
import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { ConnectionStatus } from './types';
import { encodeToBase64, decodeFromBase64, decodeAudioData } from './utils/audio';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const stopSession = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(console.error);
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(console.error);
      outputAudioContextRef.current = null;
    }
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus(ConnectionStatus.IDLE);
    sessionPromiseRef.current = null;
  }, []);

  const startSession = useCallback(async () => {
    if (status === ConnectionStatus.CONNECTING) return;
    
    try {
      setStatus(ConnectionStatus.CONNECTING);
      setErrorMessage(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch((err) => {
          if (err.name === 'NotAllowedError') throw new Error('Microphone access denied.');
          throw new Error('Microphone not detected.');
        });

      micStreamRef.current = stream;
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          systemInstruction: 'You are Lumina. Keep responses natural and very brief.',
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            if (inputAudioContextRef.current && micStreamRef.current) {
              const source = inputAudioContextRef.current.createMediaStreamSource(micStreamRef.current);
              const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                const pcmBlob: Blob = {
                  data: encodeToBase64(new Uint8Array(int16.buffer)),
                  mimeType: 'audio/pcm;rate=16000',
                };
                sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContextRef.current.destination);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decodeFromBase64(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: () => { setErrorMessage('Connection error.'); stopSession(); },
          onclose: () => stopSession()
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
      setErrorMessage(err.message);
      setStatus(ConnectionStatus.ERROR);
      stopSession();
    }
  }, [status, stopSession]);

  const isActive = status === ConnectionStatus.CONNECTED;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#020202] text-white">
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/30 rounded-full blur-[120px]"></div>
      </div>

      <main className="z-10 flex flex-col items-center">
        {/* Status indicator */}
        <div className="mb-12 text-[10px] uppercase tracking-[0.4em] text-white/40 font-bold transition-all duration-500">
          {status === ConnectionStatus.CONNECTED ? 'System Online' : 
           status === ConnectionStatus.CONNECTING ? 'Calibrating...' : 
           status === ConnectionStatus.ERROR ? 'Alert' : 'Standby'}
        </div>

        {/* Central Pulse Orb */}
        <div 
          onClick={isActive ? stopSession : startSession}
          className="relative cursor-pointer transition-transform duration-300 active:scale-95"
        >
          {/* Pulsing Aura - Only active when connected */}
          <div className={`absolute inset-0 rounded-full bg-cyan-400 transition-all duration-1000 ${
            isActive ? 'animate-orbit-pulse' : 'opacity-0 scale-50'
          }`}></div>

          {/* Main Circle Container */}
          <div className={`relative w-56 h-56 rounded-full border flex items-center justify-center transition-all duration-700 ${
            isActive 
            ? 'border-white bg-white/10 shadow-[0_0_80px_rgba(34,211,238,0.3)]' 
            : status === ConnectionStatus.ERROR 
            ? 'border-red-500/50 bg-red-500/5' 
            : 'border-white/10 bg-white/5 hover:border-white/30'
          }`}>
            {/* Inner Core */}
            <div className={`w-4 h-4 rounded-full transition-all duration-500 ${
              isActive ? 'bg-white shadow-[0_0_15px_white]' : 'bg-white/20'
            }`}></div>

            {/* Scanning Ring */}
            <div className={`absolute inset-4 rounded-full border border-white/5 transition-opacity duration-1000 ${
              isActive ? 'opacity-100 animate-[spin_10s_linear_infinite]' : 'opacity-0'
            }`}></div>
          </div>
        </div>

        {/* Controls / Errors */}
        <div className="mt-16 h-20 flex flex-col items-center">
          {status === ConnectionStatus.IDLE && (
            <button 
              onClick={startSession}
              className="px-10 py-3 bg-white text-black text-xs uppercase tracking-widest font-black rounded-full hover:bg-cyan-100 transition-all shadow-xl"
            >
              Initialize AI
            </button>
          )}

          {status === ConnectionStatus.ERROR && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-red-400 text-[10px] uppercase tracking-wider">{errorMessage}</p>
              <button onClick={startSession} className="text-white/60 text-[10px] uppercase border-b border-white/20 pb-1">Retry System</button>
            </div>
          )}

          {isActive && (
            <button 
              onClick={stopSession}
              className="text-white/20 text-[10px] uppercase tracking-widest hover:text-red-400 transition-colors"
            >
              Terminate Session
            </button>
          )}
        </div>
      </main>

      <footer className="fixed bottom-12 text-white/10 text-[8px] uppercase tracking-[0.8em]">
        Lumina Voice Interface 2.5
      </footer>
    </div>
  );
};

export default App;
