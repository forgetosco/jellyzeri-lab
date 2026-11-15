import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Smartphone, Volume2, Music } from 'lucide-react';
import { LOCALES, t, type Locale, type TestId } from './lab/i18n/translations';
import { WebAudioSynth } from './lab/audio/WebAudioSynth';
import { LabSceneManager, type LabTelemetry } from './lab/scene/LabSceneManager';
import type { PhysicsEngineKind } from './lab/physics/PhysicsEngine';
import { TouchControlsOverlay } from './lab/components/TouchControlsOverlay';
import { TechReportView } from './lab/components/TechReportView';

type LabTab = TestId | 'REPORT';

const INITIAL_TELEMETRY: LabTelemetry = {
  fps: 0,
  frameMs: 0,
  physicsMs: 0,
  bodyCount: 0,
  drawCalls: 0,
  triangles: 0,
  heapMb: null,
  rendererName: 'WebGL2',
  isSoftwareGl: false,
  cameraYawDeg: 0,
  chargeRatio: 0,
  impulseVec: { x: 0, y: 0, z: 0 },
  gamepadName: null,
  balloonAltitude: 0,
  balloonInGoal: false,
  engineKind: 'cannon',
  rapierReady: false,
};

export default function App() {
  const [locale, setLocale] = useState<Locale>('pt-BR');
  const [activeTab, setActiveTab] = useState<LabTab>('A');
  const [engineKind, setEngineKind] = useState<PhysicsEngineKind>('cannon');
  const [stressCount, setStressCount] = useState<number>(24);
  const [touchVisible, setTouchVisible] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(true);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);
  const [musicPlaying, setMusicPlaying] = useState<boolean>(false);
  const [sfxVol, setSfxVol] = useState<number>(0.7);
  const [musicVol, setMusicVol] = useState<number>(0.35);
  const [telemetry, setTelemetry] = useState<LabTelemetry>(INITIAL_TELEMETRY);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneMgrRef = useRef<LabSceneManager | null>(null);
  const audioRef = useRef<WebAudioSynth | null>(null);

  useEffect(() => {
    const audio = new WebAudioSynth();
    audioRef.current = audio;

    if (!canvasHostRef.current) return;
    const mgr = new LabSceneManager(canvasHostRef.current, audio, (next) => {
      setTelemetry(next);
      setAudioUnlocked(audio.isUnlocked());
    });
    sceneMgrRef.current = mgr;

    return () => {
      mgr.dispose();
      audio.dispose();
      sceneMgrRef.current = null;
      audioRef.current = null;
    };
  }, []);

  const handleSelectTab = (tab: LabTab) => {
    setActiveTab(tab);
    if (tab !== 'REPORT') {
      void sceneMgrRef.current?.setActiveTest(tab);
      if (tab === 'D') {
        setTouchVisible(true);
      }
    }
  };

  const handleEngineChange = (kind: PhysicsEngineKind) => {
    setEngineKind(kind);
    void sceneMgrRef.current?.setEngineKind(kind);
  };

  const handleStressChange = (count: number) => {
    setStressCount(count);
    void sceneMgrRef.current?.setStressCount(count);
  };

  const handleUnlockAudio = async () => {
    const ok = await audioRef.current?.unlock();
    setAudioUnlocked(Boolean(ok));
    if (ok) {
      audioRef.current?.playBalloonChime();
    }
  };

  const handleTriggerSfx = async () => {
    const ok = await audioRef.current?.unlock();
    setAudioUnlocked(Boolean(ok));
    if (ok) {
      audioRef.current?.playLaunch(0.8);
      window.setTimeout(() => audioRef.current?.playBalloonChime(), 160);
    }
  };

  const handleToggleMusic = async () => {
    if (!audioRef.current) return;
    const playing = await audioRef.current.toggleMusic();
    setAudioUnlocked(audioRef.current.isUnlocked());
    setMusicPlaying(playing);
  };

  const tabs: { id: LabTab; label: string }[] = [
    { id: 'A', label: t(locale, 'tabA') },
    { id: 'B', label: t(locale, 'tabB') },
    { id: 'C', label: t(locale, 'tabC') },
    { id: 'D', label: t(locale, 'tabD') },
    { id: 'E', label: t(locale, 'tabE') },
    { id: 'REPORT', label: t(locale, 'tabReport') },
  ];

  const activeInfo = (() => {
    switch (activeTab) {
      case 'A':
        return { title: t(locale, 'testATitle'), desc: t(locale, 'testADesc'), hint: t(locale, 'moveHint') };
      case 'B':
        return { title: t(locale, 'testBTitle'), desc: t(locale, 'testBDesc'), hint: t(locale, 'chargeHint') };
      case 'C':
        return { title: t(locale, 'testCTitle'), desc: t(locale, 'testCDesc'), hint: t(locale, 'balloonHint') };
      case 'D':
        return { title: t(locale, 'testDTitle'), desc: t(locale, 'testDDesc'), hint: t(locale, 'cameraHint') };
      case 'E':
        return { title: t(locale, 'testETitle'), desc: t(locale, 'testEDesc'), hint: t(locale, 'moveHint') };
      case 'REPORT':
        return null;
    }
  })();

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#0B0E17] text-slate-100"
      data-active-tab={activeTab}
      data-engine={telemetry.engineKind}
    >
      {/* 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 h-14 border-b border-slate-800 bg-[#0B0E17] shrink-0 z-30">
        <span className="font-display text-base sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
          {t(locale, 'brandTitle')}
        </span>

        <nav
          aria-label="Testes do laboratório"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center border border-slate-800 rounded-md overflow-hidden bg-[#111827]">
            {LOCALES.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setLocale(loc.id)}
                className={`px-2 py-1 text-[11px] font-mono transition-colors ${
                  locale === loc.id
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void sceneMgrRef.current?.resetScenario()}
            aria-label={t(locale, 'resetScene')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[36px] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden md:inline">{t(locale, 'resetScene')}</span>
          </button>
        </div>
      </header>

      {/* Main Stage */}
      <main className="relative flex-1 overflow-hidden">
        {/* Isolated WebGL mount container */}
        <div
          ref={canvasHostRef}
          data-testid="lab-webgl-container"
          className="absolute inset-0 w-full h-full"
        />

        {/* Subtle Top-Left Test Readout (unobtrusive, pointer-events-none) */}
        {activeTab !== 'REPORT' && activeInfo && (
          <div className="pointer-events-none absolute top-3 left-4 right-4 sm:right-auto sm:max-w-md z-10 bg-[#0B0E17]/85 border border-slate-800 rounded-lg px-3.5 py-2.5">
            <h1 className="font-display text-sm sm:text-base font-semibold text-white">
              {activeInfo.title}
            </h1>
            <p className="text-xs text-slate-300 mt-0.5 leading-snug">
              {activeInfo.desc}
            </p>
            <p className="text-[11px] font-mono text-cyan-300 mt-1">
              {activeInfo.hint}
            </p>
          </div>
        )}

        {/* Touch Virtual Sticks Overlay */}
        {activeTab !== 'REPORT' && (
          <TouchControlsOverlay
            visible={touchVisible}
            chargeLabel={t(locale, 'chargeButton')}
            chargeRatio={telemetry.chargeRatio}
            onLeftStick={(x, y) => sceneMgrRef.current?.setTouchLeftStick(x, y)}
            onRightStick={(x, y) => sceneMgrRef.current?.setTouchRightStick(x, y)}
            onChargeChange={(charging) => sceneMgrRef.current?.setTouchCharge(charging)}
          />
        )}

        {/* Technical Evaluation Report Overlay */}
        {activeTab === 'REPORT' && (
          <div className="absolute inset-0 z-20 bg-[#0B0E17]">
            <TechReportView
              locale={locale}
              telemetry={telemetry}
              audioState={audioUnlocked ? 'running' : 'suspended'}
            />
          </div>
        )}

        {/* Collapsible Bottom Control & Telemetry Dock (no backdrop-filter over WebGL) */}
        {activeTab !== 'REPORT' && (
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 w-[min(960px,95vw)] z-30 flex flex-col items-center pointer-events-none">
            <button
              type="button"
              onClick={() => setDockOpen((v) => !v)}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-md border border-b-0 border-slate-700 bg-[#0f172a] text-[11px] font-medium text-slate-300 hover:text-white min-h-[30px]"
            >
              {dockOpen ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t(locale, 'collapseDock')}</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t(locale, 'expandDock')}</span>
                </>
              )}
            </button>

            {dockOpen && (
              <section
                aria-label="Controles e telemetria do laboratório"
                className="pointer-events-auto w-full rounded-lg border border-slate-700/90 bg-[#0f172a]/95 px-3.5 py-2.5 space-y-2.5"
              >
                {/* Telemetry Readout Row (clean unboxed text with tabular-nums) */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-300 border-b border-slate-800 pb-2">
                  <span>
                    {t(locale, 'metricFps')}: <strong className="text-white">{telemetry.fps}</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricFrameTime')}: <strong className="text-white">{telemetry.frameMs} ms</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricPhysicsTime')}: <strong className="text-cyan-300">{telemetry.physicsMs} ms</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricBodies')}: <strong className="text-white">{telemetry.bodyCount}</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricDrawCalls')}: <strong className="text-white">{telemetry.drawCalls}</strong>
                  </span>
                  {telemetry.heapMb !== null && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        {t(locale, 'metricMemory')}: <strong className="text-white">{telemetry.heapMb} MB</strong>
                      </span>
                    </>
                  )}
                  {activeTab === 'D' && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        Yaw: <strong className="text-cyan-300">{telemetry.cameraYawDeg}°</strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        {t(locale, 'metricGamepad')}:{' '}
                        <strong className="text-slate-200">
                          {telemetry.gamepadName ? telemetry.gamepadName : t(locale, 'gamepadDisconnected')}
                        </strong>
                      </span>
                    </>
                  )}
                  {activeTab === 'C' && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        Alt. Balão: <strong className="text-sky-300">{telemetry.balloonAltitude} m</strong>
                      </span>
                      {telemetry.balloonInGoal && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <strong className="text-emerald-400">Alvo alcançado</strong>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Interactive Controls Row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Physics Engine Selector */}
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md p-0.5">
                      <button
                        type="button"
                        onClick={() => handleEngineChange('cannon')}
                        className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors min-h-[32px] ${
                          engineKind === 'cannon'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t(locale, 'engineCannon')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEngineChange('rapier')}
                        className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors min-h-[32px] ${
                          engineKind === 'rapier'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t(locale, 'engineRapier')}
                      </button>
                    </div>

                    {/* Stress Body Count (Test E) */}
                    {activeTab === 'E' && (
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md p-0.5">
                        {[12, 24, 48, 60].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => handleStressChange(count)}
                            className={`px-2 py-1 rounded text-xs font-mono transition-colors min-h-[32px] ${
                              stressCount === count
                                ? 'bg-purple-500/25 text-purple-200'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Touch Controls Toggle */}
                    <button
                      type="button"
                      onClick={() => setTouchVisible((v) => !v)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap min-h-[34px] transition-colors ${
                        touchVisible
                          ? 'border-purple-400/50 bg-purple-500/20 text-purple-200'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t(locale, 'touchOverlayToggle')}</span>
                    </button>

                    {/* Mobile Locale Switcher */}
                    <div className="flex sm:hidden items-center border border-slate-800 rounded-md overflow-hidden bg-slate-900">
                      {LOCALES.map((loc) => (
                        <button
                          key={loc.id}
                          type="button"
                          onClick={() => setLocale(loc.id)}
                          className={`px-2 py-1 text-[11px] font-mono min-h-[32px] ${
                            locale === loc.id ? 'bg-slate-700 text-white' : 'text-slate-400'
                          }`}
                        >
                          {loc.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Web Audio API Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={audioUnlocked ? handleTriggerSfx : handleUnlockAudio}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap min-h-[34px] transition-colors ${
                        audioUnlocked
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-400/50'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{audioUnlocked ? t(locale, 'audioTestSfx') : t(locale, 'audioUnlock')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleMusic()}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap min-h-[34px] transition-colors ${
                        musicPlaying
                          ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Music className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{musicPlaying ? t(locale, 'audioStopMusic') : t(locale, 'audioPlayMusic')}</span>
                    </button>

                    {activeTab === 'E' && (
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 pl-1">
                        <label className="flex items-center gap-1">
                          <span>SFX</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={sfxVol}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setSfxVol(v);
                              audioRef.current?.setSfxVolume(v);
                            }}
                            className="w-14 accent-cyan-400"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          <span>BGM</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={musicVol}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setMusicVol(v);
                              audioRef.current?.setMusicVolume(v);
                            }}
                            className="w-14 accent-purple-400"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
