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
  cameraYawDeg: 14,
  chargeRatio: 0,
  isGrounded: true,
  supportNormalY: 1,
  slimePos: { x: 0, y: 0.65, z: 4.0 },
  slimeVelY: 0,
  balloonPos: { x: 0, y: 2.55, z: 1.8 },
  balloonVelY: 0,
  attemptState: 'playing',
  popSurfaceId: null,
  impulseVec: { x: 0, y: 0, z: 0 },
  gamepadName: null,
  engineKind: 'rapier',
  rapierReady: false,
};

export default function App() {
  const [locale, setLocale] = useState<Locale>('pt-BR');
  const [activeTab, setActiveTab] = useState<LabTab>('ARENA');
  const [engineKind, setEngineKind] = useState<PhysicsEngineKind>('rapier');
  const [stressCount, setStressCount] = useState<number>(24);
  const [touchVisible, setTouchVisible] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [dockOpen, setDockOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const userToggledTouchRef = useRef(false);
  const userToggledDockRef = useRef(false);
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

    const onResize = () => {
      const mobile = window.innerWidth < 768;
      if (!userToggledTouchRef.current) {
        setTouchVisible(mobile || window.matchMedia?.('(pointer: coarse)').matches === true);
      }
      if (!userToggledDockRef.current) {
        setDockOpen(window.innerWidth >= 640);
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
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

  const handleToggleTouch = () => {
    userToggledTouchRef.current = true;
    setTouchVisible((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 640) {
        userToggledDockRef.current = true;
        setDockOpen(false);
      }
      return next;
    });
  };

  const handleUnlockAudio = async () => {
    const ok = await audioRef.current?.unlock();
    setAudioUnlocked(Boolean(ok));
    if (ok) {
      audioRef.current?.playLaunch(0.4);
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
    { id: 'ARENA', label: t(locale, 'tabArena') },
    { id: 'STRESS', label: t(locale, 'tabStress') },
    { id: 'REPORT', label: t(locale, 'tabReport') },
  ];

  const activeInfo = (() => {
    if (activeTab === 'ARENA') {
      return { title: t(locale, 'arenaTitle'), desc: t(locale, 'arenaDesc'), hint: t(locale, 'arenaHint') };
    }
    if (activeTab === 'STRESS') {
      return { title: t(locale, 'stressTitle'), desc: t(locale, 'stressDesc'), hint: t(locale, 'stressHint') };
    }
    return null;
  })();

  const isPopped = activeTab === 'ARENA' && telemetry.attemptState === 'popped';

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#0B0E17] text-slate-100"
      data-active-tab={activeTab}
      data-engine={telemetry.engineKind}
      data-grounded={telemetry.isGrounded ? 'true' : 'false'}
      data-charge={telemetry.chargeRatio}
      data-slime-y={telemetry.slimePos.y}
      data-balloon-y={telemetry.balloonPos.y}
      data-attempt-state={telemetry.attemptState}
      data-pop-surface={telemetry.popSurfaceId ?? ''}
      data-camera-yaw={telemetry.cameraYawDeg}
    >
      {/* Top Header */}
      <header className="flex items-center justify-between gap-2 sm:gap-8 px-3 sm:px-6 h-14 border-b border-slate-800 bg-[#0B0E17] shrink-0 z-30">
        <span className="font-display text-sm sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
          {t(locale, 'brandTitle')}
        </span>

        <nav
          aria-label="Modos da Etapa 2"
          className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar py-1"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors min-h-[36px] ${
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

      {/* Main Viewport */}
      <main className="relative flex-1 overflow-hidden">
        <div
          ref={canvasHostRef}
          data-testid="lab-webgl-container"
          className="absolute inset-0 w-full h-full"
        />

        {activeTab !== 'REPORT' && activeInfo && (
          <div className="pointer-events-none absolute top-2.5 left-3 right-3 sm:top-3 sm:left-4 sm:right-auto sm:max-w-lg z-10 bg-[#0B0E17]/80 border border-slate-800 rounded-lg px-3 py-2 sm:px-3.5 sm:py-2.5">
            <h1 className="font-display text-xs sm:text-base font-semibold text-white">
              {activeInfo.title}
            </h1>
            <p className="hidden sm:block text-xs text-slate-300 mt-0.5 leading-snug">
              {activeInfo.desc}
            </p>
            <p className="text-[10px] sm:text-[11px] font-mono text-cyan-300 mt-0.5 sm:mt-1 leading-tight">
              {activeInfo.hint}
            </p>
          </div>
        )}

        {/* Popped Attempt Prompt (no backdrop-filter over WebGL) */}
        {isPopped && (
          <div
            role="alertdialog"
            aria-labelledby="pop-alert-title"
            data-testid="balloon-popped-overlay"
            className="fixed inset-0 z-40 flex items-center justify-center px-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-rose-500/50 bg-[#0f172a]/95 p-5 text-center shadow-2xl space-y-3">
              <h2 id="pop-alert-title" className="font-display text-lg font-semibold text-rose-300">
                {t(locale, 'popTitle')}
              </h2>
              <p className="text-xs text-slate-300">
                {t(locale, 'popSubtitle')}{' '}
                <strong className="font-mono text-white">{telemetry.popSurfaceId}</strong>
              </p>
              <button
                type="button"
                data-testid="retry-attempt-button"
                onClick={() => void sceneMgrRef.current?.resetScenario()}
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors min-h-[44px]"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>{t(locale, 'popRetry')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Touch Overlay: Left Stick + Impulse Button ONLY */}
        {activeTab !== 'REPORT' && !isPopped && (
          <TouchControlsOverlay
            visible={touchVisible}
            leftStickLabel={t(locale, 'leftStickLabel')}
            chargeLabel={t(locale, 'chargeButton')}
            chargeRatio={telemetry.chargeRatio}
            isGrounded={telemetry.isGrounded}
            onLeftStick={(x, y) => sceneMgrRef.current?.setTouchLeftStick(x, y)}
            onChargeChange={(charging) => sceneMgrRef.current?.setTouchCharge(charging)}
          />
        )}

        {activeTab === 'REPORT' && (
          <div className="absolute inset-0 z-20 bg-[#0B0E17]">
            <TechReportView
              locale={locale}
              telemetry={telemetry}
              audioState={audioUnlocked ? 'running' : 'suspended'}
            />
          </div>
        )}

        {/* Collapsible Bottom Control & Telemetry Dock */}
        {activeTab !== 'REPORT' && (
          <div className="fixed bottom-3 left-1/2 -translate-x-1/2 w-[min(960px,95vw)] z-30 flex flex-col items-center pointer-events-none">
            <button
              type="button"
              onClick={() => {
                userToggledDockRef.current = true;
                setDockOpen((v) => !v);
              }}
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
                aria-label="Controles e telemetria da Etapa 2"
                className="pointer-events-auto w-full rounded-lg border border-slate-700/90 bg-[#0f172a]/95 px-3.5 py-2.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-300 border-b border-slate-800 pb-2 tabular-nums">
                  <span>
                    {t(locale, 'metricState')}:{' '}
                    <strong className={telemetry.isGrounded ? 'text-emerald-400' : 'text-amber-300'}>
                      {telemetry.isGrounded ? t(locale, 'stateGrounded') : t(locale, 'stateAirborne')}
                    </strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricCharge')}: <strong className="text-cyan-300">{Math.round(telemetry.chargeRatio * 100)}%</strong>
                  </span>
                  {activeTab === 'ARENA' && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        {t(locale, 'metricBalloonY')}: <strong className="text-sky-300">{telemetry.balloonPos.y} m</strong>
                      </span>
                    </>
                  )}
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricFps')}: <strong className="text-white">{telemetry.fps}</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    {t(locale, 'metricPhysicsTime')}: <strong className="text-cyan-300">{telemetry.physicsMs} ms</strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span>
                    Yaw: <strong className="text-white">{telemetry.cameraYawDeg}°</strong>
                  </span>
                  {telemetry.heapMb !== null && (
                    <>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>
                        {t(locale, 'metricMemory')}: <strong className="text-white">{telemetry.heapMb} MB</strong>
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md p-0.5">
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
                    </div>

                    {activeTab === 'STRESS' && (
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

                    <button
                      type="button"
                      onClick={handleToggleTouch}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap min-h-[34px] transition-colors ${
                        touchVisible
                          ? 'border-purple-400/50 bg-purple-500/20 text-purple-200'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t(locale, 'touchOverlayToggle')}</span>
                    </button>

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

                    {activeTab === 'STRESS' && (
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
