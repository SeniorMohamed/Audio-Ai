
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, GenerateContentResponse } from '@google/genai';
import { ConnectionStatus } from './types';
import { encode, decode, decodeAudioData, audioBufferToWav, saveAudioToDB, getAudioFromDB, deleteAudioFromDB } from './services/audioUtils';
import { Visualizer } from './components/Visualizer';

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

type AppMode = 'tts' | 'clone' | 'live';
type BaseVoice = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr' | 'Aoede' | 'Eos';

interface VoicePersona {
  id: string;
  name: string;
  gender: 'رجل' | 'امرأة' | 'طفل' | 'طفلة';
  base: BaseVoice;
  desc: string;
}

interface SavedRecording {
  id: string;
  text: string;
  voiceName: string;
  audioUrl: string;
  timestamp: number;
  mode: AppMode;
}

interface ClonedVoice {
  id: string;
  name: string;
  audioData: string; // base64
  mimeType: string;
  timestamp: number;
}

const VOICE_LIST: VoicePersona[] = [
  { id: 'v1', name: 'سارة', gender: 'امرأة', base: 'Kore', desc: 'صوت أنثوي احترافي وواضح' },
  { id: 'v2', name: 'عمر', gender: 'رجل', base: 'Charon', desc: 'صوت رجولي عميق ووقور' },
  { id: 'v3', name: 'ياسر', gender: 'رجل', base: 'Zephyr', desc: 'صوت رجولي حيوي وشبابي' },
  { id: 'v4', name: 'خالد', gender: 'رجل', base: 'Fenrir', desc: 'صوت رجولي قوي وجهوري' },
  { id: 'v5', name: 'بدر', gender: 'طفل', base: 'Puck', desc: 'صوت طفل مرح ومتحمس' },
  { id: 'v6', name: 'زياد', gender: 'رجل', base: 'Charon', desc: 'خبير التعليق على الجرائم - صوت عميق وغامض' },
  { id: 'v7', name: 'مريم', gender: 'امرأة', base: 'Kore', desc: 'خبيرة الأسرار والتحقيقات - صوت درامي ومثير' },
];

const STYLE_OPTIONS = [
  { id: 'child', label: 'أطفالي', prompt: 'تحدث بأسلوب طفولي بريء ومرح جداً وكأنك تخاطب أطفالاً: ' },
  { id: 'excited', label: 'حماسي', prompt: 'تحدث بحماس شديد وطاقة متفجرة كالمعلقين الرياضيين: ' },
  { id: 'horror', label: 'رعب', prompt: 'تحدث بنبرة مخيفة وغامضة جداً مع أنفاس ثقيلة وصوت مرعب: ' },
  { id: 'stories', label: 'حكايات/قصص', prompt: 'تحدث بأسلوب الحكواتي المشوق مع تلوين درامي في الإلقاء: ' },
  { id: 'narrator', label: 'راوي', prompt: 'تحدث بأسلوب الراوي الهادئ والعميق الذي يسرد الأحداث بوقار: ' },
  { id: 'announcer', label: 'معلن', prompt: 'تحدث بأسلوب الإعلانات التجارية المندفع والمقنع والجذاب: ' },
  { id: 'documentary', label: 'وثائقي', prompt: 'تحدث بأسلوب الأفلام الوثائقية الرصين والمثقف مع مخارج حروف دقيقة: ' },
  { id: 'escalating', label: 'تصاعدي 🔥', prompt: 'ابدأ بنبرة هادئة جداً ومنخفضة في بداية الكلام، ثم ارفع مستوى الحماس والطاقة تدريجياً وبشكل ملحوظ حتى تصل إلى ذروة الحماس في نهاية الكلام: ' },
  { id: 'damietta', label: 'دمياطي', prompt: 'تحدث بلهجة أهل دمياط المصرية الأصلية مع النغمة المشهورة والمصطلحات الدومياطية المميزة: ' },
  { id: 'crime', label: 'غموض وإثارة 🕵️‍♂️', prompt: 'تحدث بنبرة غامضة ومثيرة مع توقفات درامية وتغيير في سرعة الكلام للإيحاء بالترقب والسرية، مثل المعلقين على قصص الجرائم والغموض: ' },
  { id: 'natural', label: 'طبيعي', prompt: '' },
];

const DIALECT_OPTIONS = [
  { id: 'fusha', label: 'عربية فصحى', instruction: 'اللغة العربية الفصحى.' },
  { id: 'egyptian', label: 'عامية مصرية', instruction: 'اللهجة المصرية العامية.' },
  { id: 'saudi', label: 'لهجة سعودية', instruction: 'اللهجة السعودية البيضاء.' },
];

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('tts');
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [ttsText, setTtsText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('v1');
  const [selectedStyle, setSelectedStyle] = useState(STYLE_OPTIONS.find(s => s.id === 'natural') || STYLE_OPTIONS[STYLE_OPTIONS.length - 1]);
  const [selectedDialect, setSelectedDialect] = useState(DIALECT_OPTIONS[0]);

  // Cloning States
  const [referenceAudio, setReferenceAudio] = useState<ClonedVoice | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [history, setHistory] = useState<SavedRecording[]>([]);
  const [savedClones, setSavedClones] = useState<ClonedVoice[]>([]);

  // Player States
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Persistence
  useEffect(() => {
    const savedHistory = localStorage.getItem('hazza_history');
    const savedVoices = localStorage.getItem('hazza_clones');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedVoices) setSavedClones(JSON.parse(savedVoices));
  }, []);

  useEffect(() => {
    localStorage.setItem('hazza_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('hazza_clones', JSON.stringify(savedClones));
  }, [savedClones]);

  useEffect(() => {
    if (audioRef.current) {
      const el = audioRef.current;
      const updateProgress = () => setAudioProgress(el.currentTime);
      const onEnded = () => setIsPlaying(false);
      const onLoadedMetadata = () => setAudioDuration(el.duration);
      
      el.addEventListener('timeupdate', updateProgress);
      el.addEventListener('ended', onEnded);
      el.addEventListener('loadedmetadata', onLoadedMetadata);
      return () => {
        el.removeEventListener('timeupdate', updateProgress);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
    }
  }, [audioUrl]);

  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAiSpeaking(false);
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const buildSystemInstruction = () => {
    const voice = VOICE_LIST.find(v => v.id === selectedVoiceId) || VOICE_LIST[0];
    const styleNote = selectedStyle.id !== 'natural' ? `النمط المطلوب: ${selectedStyle.label}.` : "";
    return `أنت هزاع، مساعد ذكي احترافي. تقمص الشخصية التالية: ${voice.name} (${voice.gender}). اللهجة المستخدمة: ${selectedDialect.instruction} ${styleNote}`;
  };

  const previewVoice = async (vId: string) => {
    if (isPreviewing) return;
    const voice = VOICE_LIST.find(v => v.id === vId);
    if (!voice) return;
    setIsPreviewing(vId);
    setErrorMessage(null);
    stopAllAudio();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const greeting = `أهلاً بك في تطبيق Audio AI. أنا ${voice.name}، صوت ${voice.gender}، جاهز لمساعدتك بنبرتي المميزة.`;
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: greeting }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.base as any } } },
        },
      });
      const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (base64) {
        const ctx = new AudioContext();
        const buffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
        const wavBlob = audioBufferToWav(buffer);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
        setIsPlaying(true);
        setTimeout(() => audioRef.current?.play(), 100);
      } else {
        setErrorMessage("فشل في استلام بيانات الصوت للمعاينة.");
      }
    } catch (err) { 
      console.error(err);
      setErrorMessage("حدث خطأ أثناء معاينة الصوت. تأكد من صلاحية مفتاح API.");
    } finally { 
      setIsPreviewing(null); 
    }
  };

  const generateTTS = async () => {
    if (!ttsText.trim() || isGeneratingTts) return;
    if (mode === 'clone' && !referenceAudio) {
      setErrorMessage("يرجى رفع ملف صوتي أولاً لنسخ الصوت.");
      return;
    }

    setIsGeneratingTts(true);
    setErrorMessage(null);
    stopAllAudio();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      if (mode === 'clone' && referenceAudio) {
        // Voice Cloning Mode using Multimodal Audio Generation
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview",
          contents: [
            {
              inlineData: {
                data: referenceAudio.audioData,
                mimeType: referenceAudio.mimeType
              }
            },
            {
              text: `تحدث بالنص التالي بنفس نبرة وصوت الملف المرفق تماماً. لا تضف أي تعليقات، فقط انطق النص: "${ttsText}"`
            }
          ],
          config: {
            responseModalities: [Modality.AUDIO]
          }
        });

        const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (base64) {
          const ctx = new AudioContext();
          const buffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
          const wavBlob = audioBufferToWav(buffer);
          const url = URL.createObjectURL(wavBlob);
          setAudioUrl(url);
          setIsPlaying(true);
          setTimeout(() => audioRef.current?.play(), 100);

          // Save to history
          const id = Date.now().toString();
          await saveAudioToDB(id, wavBlob);
          
          const newRecord: SavedRecording = {
            id,
            text: ttsText,
            voiceName: referenceAudio.name,
            audioUrl: url, // Still keep url for immediate playback
            timestamp: Date.now(),
            mode: 'clone'
          };
          setHistory(prev => [newRecord, ...prev].slice(0, 20));
        } else {
          setErrorMessage("فشل في استلام بيانات الصوت المستنسخ.");
        }
      } else {
        // Standard TTS Mode
        const voice = VOICE_LIST.find(v => v.id === selectedVoiceId) || VOICE_LIST[0];
        const prompt = `تقمص شخصية: ${voice.name} (${voice.gender}). اللهجة: ${selectedDialect.instruction}. ${selectedStyle.prompt} النص المراد نطقه: "${ttsText}"`;
        
        const response = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.base as any } } },
          },
        });
        const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (base64) {
          const ctx = new AudioContext();
          const buffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
          const wavBlob = audioBufferToWav(buffer);
          const url = URL.createObjectURL(wavBlob);
          setAudioUrl(url);
          setIsPlaying(true);
          setTimeout(() => audioRef.current?.play(), 100);

          // Save to history
          const id = Date.now().toString();
          await saveAudioToDB(id, wavBlob);

          const newRecord: SavedRecording = {
            id,
            text: ttsText,
            voiceName: voice.name,
            audioUrl: url,
            timestamp: Date.now(),
            mode: 'tts'
          };
          setHistory(prev => [newRecord, ...prev].slice(0, 20));
        } else {
          setErrorMessage("فشل في استلام بيانات الصوت. حاول مرة أخرى.");
        }
      }
    } catch (err) { 
      console.error(err);
      setErrorMessage("حدث خطأ في الاتصال بواجهة Gemini. يرجى التحقق من اتصالك بالإنترنت.");
    } finally { 
      setIsGeneratingTts(false); 
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setErrorMessage("يرجى رفع ملف صوتي فقط.");
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        const newClone: ClonedVoice = {
          id: Date.now().toString(),
          name: file.name,
          audioData: base64,
          mimeType: file.type,
          timestamp: Date.now()
        };
        setReferenceAudio(newClone);
        setSavedClones(prev => [newClone, ...prev].slice(0, 5));
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setErrorMessage("فشل في قراءة الملف.");
    } finally {
      setIsUploading(false);
    }
  };

  const playFromHistory = async (item: SavedRecording) => {
    try {
      const blob = await getAudioFromDB(item.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setIsPlaying(true);
        setTimeout(() => audioRef.current?.play(), 100);
      } else {
        setErrorMessage("لم يتم العثور على الملف الصوتي في الذاكرة المحلية.");
      }
    } catch (err) {
      setErrorMessage("فشل في استعادة الملف الصوتي.");
    }
  };

  const deleteHistoryItem = async (id: string) => {
    await deleteAudioFromDB(id);
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const deleteClone = (id: string) => {
    setSavedClones(prev => prev.filter(c => c.id !== id));
    if (referenceAudio?.id === id) setReferenceAudio(null);
  };

  const handleStartLive = async () => {
    if (status !== ConnectionStatus.DISCONNECTED) return;
    setStatus(ConnectionStatus.CONNECTING);
    setErrorMessage(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const voice = VOICE_LIST.find(v => v.id === selectedVoiceId) || VOICE_LIST[0];
      
      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        callbacks: {
          onopen: () => setStatus(ConnectionStatus.CONNECTED),
          onmessage: async (message: LiveServerMessage) => {
            const base64 = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64) {
              setIsAiSpeaking(true);
              const ctx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) setIsAiSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSourcesRef.current.add(source);
            }
          },
          onerror: (e) => {
            console.error(e);
            setStatus(ConnectionStatus.ERROR);
            setErrorMessage("حدث خطأ في جلسة اللايف.");
          },
          onclose: () => handleStopLive()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.base } } },
          systemInstruction: buildSystemInstruction(),
        }
      });
      const source = inputAudioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
        sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContextRef.current.destination);
      sessionRef.current = await sessionPromise;
    } catch (err) { 
      setStatus(ConnectionStatus.ERROR);
      setErrorMessage("تعذر الوصول إلى الميكروفون أو بدء جلسة اللايف.");
    }
  };

  const handleStopLive = () => {
    if (sessionRef.current) sessionRef.current.close();
    stopAllAudio();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    setStatus(ConnectionStatus.DISCONNECTED);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    isPlaying ? audioRef.current.pause() : audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const seek = (time: number) => { if (audioRef.current) audioRef.current.currentTime = time; };
  const skip = (seconds: number) => { if (audioRef.current) audioRef.current.currentTime += seconds; };

  return (
    <div className="min-h-screen bg-studio text-slate-100 font-inter selection:bg-teal-500/30">
      <div className="max-w-[1600px] mx-auto min-h-screen flex flex-col">
        
        {/* Main Navigation / Header */}
        <header className="flex items-center justify-between px-8 py-6 border-b border-white/5 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-6">
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-teal-500 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
              <div className="relative w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center border border-white/10">
                <svg className="w-7 h-7 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold font-cairo tracking-tight text-white flex items-center gap-2">
                Audio AI
                <span className="px-2 py-0.5 bg-teal-500/10 text-teal-400 text-[10px] font-mono rounded-full border border-teal-500/20">ULTRA v2.5</span>
              </h1>
              <p className="text-slate-500 text-[11px] uppercase tracking-[0.2em] font-medium">Professional AI Voice Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
              <button 
                onClick={() => { setMode('tts'); handleStopLive(); }} 
                className={`px-6 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${mode === 'tts' ? 'bg-white/10 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                الاستوديو
              </button>
              <button 
                onClick={() => { setMode('clone'); handleStopLive(); }} 
                className={`px-6 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${mode === 'clone' ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-slate-500 hover:text-slate-300'}`}
              >
                نسخ الصوت
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* Left Panel: Controls & Settings */}
          <aside className="w-full lg:w-[400px] border-l border-white/5 bg-black/20 backdrop-blur-sm overflow-y-auto custom-scrollbar p-8 space-y-10">
            
            {mode === 'tts' ? (
              <>
                {/* Voice Selection */}
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-3">
                      <span className="w-1 h-4 bg-teal-500 rounded-full"></span>
                      اختيار الشخصية
                    </h3>
                    <span className="text-[10px] font-mono text-slate-600">{VOICE_LIST.length} VOICES</span>
                  </div>
                  <div className="space-y-3">
                    {VOICE_LIST.map(v => (
                      <div key={v.id} className="relative group">
                        <div 
                          role="button"
                          tabIndex={0}
                          onClick={() => { setSelectedVoiceId(v.id); stopAllAudio(); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { setSelectedVoiceId(v.id); stopAllAudio(); } }}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${selectedVoiceId === v.id ? 'bg-white/5 border-teal-500/50 ring-1 ring-teal-500/20' : 'bg-transparent border-white/5 hover:border-white/10'}`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold transition-colors ${selectedVoiceId === v.id ? 'bg-teal-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                            {v.name[0]}
                          </div>
                          <div className="flex-1 text-right">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-bold text-white">{v.name}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase ${v.gender === 'امرأة' ? 'bg-pink-500/10 text-pink-400' : v.gender === 'رجل' ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'}`}>
                                {v.gender}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-medium">{v.desc}</p>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); previewVoice(v.id); }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-teal-400 transition-all"
                          >
                            {isPreviewing === v.id ? <div className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"></div> : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"/></svg>}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Style Selection */}
                <section>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-3 mb-6">
                    <span className="w-1 h-4 bg-orange-500 rounded-full"></span>
                    نبرة الصوت
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLE_OPTIONS.map(m => (
                      <button 
                        key={m.id} 
                        onClick={() => setSelectedStyle(m)}
                        className={`p-3 rounded-xl border text-[11px] font-bold transition-all duration-300 ${selectedStyle.id === m.id ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Dialect Selection */}
                <section>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-3 mb-6">
                    <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                    اللهجة المحلية
                  </h3>
                  <div className="space-y-2">
                    {DIALECT_OPTIONS.map(d => (
                      <button 
                        key={d.id} 
                        onClick={() => setSelectedDialect(d)}
                        className={`w-full p-4 rounded-xl border text-xs font-bold transition-all duration-300 flex items-center justify-between ${selectedDialect.id === d.id ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10'}`}
                      >
                        {d.label}
                        {selectedDialect.id === d.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]"></div>}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <>
                {/* Clone Selection */}
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-3">
                      <span className="w-1 h-4 bg-teal-500 rounded-full"></span>
                      الأصوات المنسوخة
                    </h3>
                  </div>
                  
                  <div className="mb-6">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-2xl cursor-pointer hover:bg-white/5 transition-all">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <svg className="w-8 h-8 mb-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">ارفع ملف صوتي (MP3/WAV)</p>
                      </div>
                      <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} />
                    </label>
                  </div>

                  <div className="space-y-3">
                    {savedClones.map(c => (
                      <div key={c.id} className="relative group">
                        <div 
                          role="button"
                          tabIndex={0}
                          onClick={() => setReferenceAudio(c)}
                          onKeyDown={(e) => e.key === 'Enter' && setReferenceAudio(c)}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${referenceAudio?.id === c.id ? 'bg-teal-500/10 border-teal-500/50 text-teal-400' : 'bg-transparent border-white/5 hover:border-white/10'}`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-slate-800 text-slate-500`}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                          </div>
                          <div className="flex-1 text-right overflow-hidden">
                            <div className="text-sm font-bold text-white truncate">{c.name}</div>
                            <div className="text-[10px] text-slate-500">{new Date(c.timestamp).toLocaleDateString('ar-EG')}</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); deleteClone(c.id); }} className="p-2 text-slate-600 hover:text-red-400 transition-colors">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    {savedClones.length === 0 && (
                      <div className="text-center py-8 text-slate-600 text-[11px] font-bold uppercase tracking-widest">لا توجد أصوات منسوخة بعد</div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* History Section */}
            <section className="pt-6 border-t border-white/5">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-3 mb-6">
                <span className="w-1 h-4 bg-slate-500 rounded-full"></span>
                السجل (History)
              </h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {history.map(item => (
                  <div key={item.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 group hover:border-white/10 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-bold text-teal-400 uppercase tracking-widest">{item.voiceName}</span>
                      <span className="text-[9px] text-slate-600">{new Date(item.timestamp).toLocaleTimeString('ar-EG')}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 line-clamp-2 mb-3">{item.text}</p>
                    <div className="flex items-center justify-between">
                      <button 
                        onClick={() => playFromHistory(item)}
                        className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"/></svg>
                        تشغيل
                      </button>
                      <button onClick={() => deleteHistoryItem(item.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-center py-8 text-slate-600 text-[11px] font-bold uppercase tracking-widest">السجل فارغ</div>
                )}
              </div>
            </section>

          </aside>

          {/* Right Panel: Main Interface */}
          <section className="flex-1 flex flex-col p-8 lg:p-12 relative">
            
            {errorMessage && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/20 px-6 py-3 rounded-2xl backdrop-blur-xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                <p className="text-xs font-bold text-red-400">{errorMessage}</p>
                <button onClick={() => setErrorMessage(null)} className="text-slate-500 hover:text-white transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            )}

            {mode === 'clone' ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="relative mb-16">
                  <div className={`absolute -inset-20 bg-teal-500/20 rounded-full blur-[100px] transition-opacity duration-1000 ${referenceAudio ? 'opacity-100' : 'opacity-0'}`}></div>
                  <Visualizer isActive={!!referenceAudio} isSpeaking={isAiSpeaking} />
                </div>
                
                <div className="text-center space-y-8 max-w-2xl w-full">
                  <h2 className="text-3xl font-bold font-cairo text-white">
                    {referenceAudio ? `تم تجهيز صوت: ${referenceAudio.name}` : 'انسخ أي صوت الآن'}
                  </h2>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    ارفع ملفاً صوتياً للشخص الذي تريد محاكاة صوته، ثم اكتب النص في الأسفل. سيقوم هزاع بتحليل نبرة الصوت وتوليد الكلام بنفس الأسلوب.
                  </p>

                  {!referenceAudio ? (
                    <div className="flex justify-center">
                      <label className="group relative w-24 h-24 rounded-full bg-teal-500 flex items-center justify-center cursor-pointer shadow-[0_0_50px_rgba(20,184,166,0.3)] hover:scale-110 transition-all duration-500">
                        <div className="absolute inset-0 rounded-full animate-pulse-soft bg-teal-400/20"></div>
                        {isUploading ? (
                          <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        )}
                        <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} />
                      </label>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-6">
                      <div className="flex-1 w-full relative group">
                        <div className="absolute -inset-1 bg-gradient-to-b from-teal-500/10 to-transparent rounded-[32px] blur-xl opacity-0 group-focus-within:opacity-100 transition duration-1000"></div>
                        <textarea 
                          value={ttsText} 
                          onChange={(e) => setTtsText(e.target.value)} 
                          readOnly={isGeneratingTts}
                          placeholder="اكتب النص الذي تريد أن ينطقه الصوت المنسوخ..."
                          className="relative w-full h-48 bg-black/40 border border-white/10 rounded-[32px] p-8 text-xl leading-relaxed text-white outline-none focus:border-teal-500/30 transition-all resize-none shadow-2xl custom-scrollbar"
                        />
                      </div>
                      
                      <button 
                        onClick={generateTTS} 
                        disabled={!ttsText.trim() || isGeneratingTts}
                        className="group relative w-full h-16 bg-white text-black rounded-[20px] font-bold text-lg overflow-hidden transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-teal-400 to-blue-500 opacity-0 group-hover:opacity-10 transition-opacity"></div>
                        <div className="relative flex items-center justify-center gap-4">
                          {isGeneratingTts ? (
                            <>
                              <div className="w-5 h-5 border-4 border-black/10 border-t-black rounded-full animate-spin"></div>
                              <span>جارِ النسخ والتوليد...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                              <span>توليد الصوت المنسوخ</span>
                            </>
                          )}
                        </div>
                      </button>

                      {audioUrl && (
                        <div className="w-full p-6 bg-white/5 border border-white/10 rounded-[24px] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4">
                          <div className="flex items-center gap-6">
                            <button onClick={togglePlayback} className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all">
                              {isPlaying ? <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1-1v4a1 1 0 002 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg> : <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>}
                            </button>
                            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-teal-500" style={{ width: `${(audioProgress / audioDuration) * 100}%` }}></div>
                            </div>
                            <a href={audioUrl} download="cloned_voice.wav" className="text-slate-400 hover:text-white transition-colors">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            </a>
                          </div>
                          <audio ref={audioRef} src={audioUrl} className="hidden" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h2 className="text-3xl font-bold font-cairo text-white mb-2">تحويل النص إلى صوت</h2>
                    <p className="text-slate-500 text-sm">اكتب النص وسيقوم المحرك بتوليد نطق بشري فائق الجودة.</p>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/10">
                    <span className="text-[10px] font-mono text-slate-500">CHARS:</span>
                    <span className="text-xs font-bold text-teal-400">{ttsText.length}</span>
                  </div>
                </div>

                <div className="flex-1 relative group">
                  <div className="absolute -inset-1 bg-gradient-to-b from-teal-500/10 to-transparent rounded-[32px] blur-xl opacity-0 group-focus-within:opacity-100 transition duration-1000"></div>
                  <textarea 
                    value={ttsText} 
                    onChange={(e) => setTtsText(e.target.value)} 
                    readOnly={isGeneratingTts}
                    placeholder="أدخل النص المراد تحويله هنا..."
                    className="relative w-full h-full bg-black/40 border border-white/10 rounded-[32px] p-10 text-2xl leading-relaxed text-white outline-none focus:border-teal-500/30 transition-all resize-none shadow-2xl custom-scrollbar"
                  />
                </div>

                <div className="mt-8 space-y-6">
                  {audioUrl && (
                    <div className="p-8 bg-white/5 border border-white/10 rounded-[32px] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4">
                      <div className="flex items-center gap-8">
                        <button 
                          onClick={togglePlayback}
                          className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all"
                        >
                          {isPlaying ? <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1-1v4a1 1 0 002 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg> : <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>}
                        </button>
                        
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                            <span>{Math.floor(audioProgress / 60)}:{Math.floor(audioProgress % 60).toString().padStart(2, '0')}</span>
                            <span>{Math.floor(audioDuration / 60)}:{Math.floor(audioDuration % 60).toString().padStart(2, '0')}</span>
                          </div>
                          <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden group/progress">
                            <div 
                              className="absolute inset-y-0 left-0 bg-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.5)] transition-all duration-100"
                              style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                            ></div>
                            <input 
                              type="range" 
                              min="0" 
                              max={audioDuration || 0} 
                              step="0.01" 
                              value={audioProgress} 
                              onChange={(e) => seek(parseFloat(e.target.value))}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <a 
                            href={audioUrl} 
                            download="hazza_voice.wav"
                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-all"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </a>
                        </div>
                      </div>
                      <audio ref={audioRef} src={audioUrl} className="hidden" />
                    </div>
                  )}

                  <button 
                    onClick={generateTTS} 
                    disabled={!ttsText.trim() || isGeneratingTts}
                    className="group relative w-full h-20 bg-white text-black rounded-[24px] font-bold text-xl overflow-hidden transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-teal-400 to-blue-500 opacity-0 group-hover:opacity-10 transition-opacity"></div>
                    <div className="relative flex items-center justify-center gap-4">
                      {isGeneratingTts ? (
                        <>
                          <div className="w-6 h-6 border-4 border-black/10 border-t-black rounded-full animate-spin"></div>
                          <span>جارِ المعالجة الذكية...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <span>توليد الصوت الآن</span>
                        </>
                      )}
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Footer Info */}
            <footer className="mt-auto pt-12 flex items-center justify-between border-t border-white/5">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Engine: Gemini 2.5 Flash</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Latency: ~240ms</span>
                </div>
              </div>
              <p className="text-[10px] font-medium text-slate-600 uppercase tracking-widest">© 2026 Hazza AI Labs</p>
            </footer>

          </section>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        
        @keyframes pulse-soft {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.05); }
        }
        .animate-pulse-soft { animation: pulse-soft 4s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default App;
