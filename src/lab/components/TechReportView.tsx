import React from 'react';
import type { LabTelemetry } from '../scene/LabSceneManager';
import type { Locale } from '../i18n/translations';
import { t } from '../i18n/translations';

interface TechReportViewProps {
  locale: Locale;
  telemetry: LabTelemetry;
  audioState: string;
}

type EvidenceTag = 'Testado e observado' | 'Validado em testes unitários' | 'Ainda não verificado em aparelho físico';

function EvidenceLabel({ tag }: { tag: EvidenceTag }) {
  const colorMap: Record<EvidenceTag, string> = {
    'Testado e observado': 'text-emerald-400',
    'Validado em testes unitários': 'text-cyan-400',
    'Ainda não verificado em aparelho físico': 'text-amber-400',
  };
  return (
    <span className={`font-mono text-xs ${colorMap[tag]}`}>
      {tag}
    </span>
  );
}

export function TechReportView({ locale, telemetry, audioState }: TechReportViewProps) {
  return (
    <div
      className="h-full overflow-y-auto bg-[#0B0E17] text-slate-200 px-4 sm:px-8 py-6 pb-28"
      data-testid="tech-report-view"
    >
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="border-b border-slate-800 pb-5">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            {t(locale, 'reportHeading')}
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-3xl">
            {t(locale, 'reportSubtitle')}
          </p>
        </header>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Telemetria da Sessão Atual</h2>
            <EvidenceLabel tag="Testado e observado" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Renderizador WebGL</div>
              <div className="mt-1 font-mono text-sm text-white truncate" title={telemetry.rendererName}>
                {telemetry.isSoftwareGl ? 'Software WebGL (Headless)' : telemetry.rendererName}
              </div>
            </div>
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Motor Ativo / Passo</div>
              <div className="mt-1 font-mono text-sm text-cyan-300">
                {telemetry.engineKind === 'rapier' ? 'Rapier3D' : 'Cannon-es'} · {telemetry.physicsMs} ms
              </div>
            </div>
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Draw Calls / Triângulos</div>
              <div className="mt-1 font-mono text-sm text-white">
                {telemetry.drawCalls} calls · {telemetry.triangles} tris
              </div>
            </div>
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Posição / Apoio</div>
              <div className="mt-1 font-mono text-sm text-white">
                Y={telemetry.slimePos.y}m · {telemetry.isGrounded ? 'Apoiado' : 'Em voo'} · {audioState}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Arquitetura e Correções Implementadas na Etapa 1</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-white">1. Rapier3D Principal &amp; Apoio Real</h3>
                <EvidenceLabel tag="Validado em testes unitários" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Rapier3D foi estabelecido como motor padrão (`canSleep: false` no slime). O apoio usa `contactPairsWith` e `solverContactPoint`, exigindo normal ascendente (`ny &gt;= 0.58`) e velocidade de separação limitada (`dot(v, n) &lt;= 1.6`). Paredes verticais, tetos e subida após impulso são rejeitados sem temporizadores artificiais.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-white">2. Personagem Jellyzerī Desacoplado</h3>
                <EvidenceLabel tag="Testado e observado" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Corpo roxo orgânico levemente irregular com núcleo luminoso, micro-bolhas internas, borda Fresnel por shader (`onBeforeCompile`), piscar natural e expressões dinâmicas (repouso, carga concentrada, voo e aterrissagem) preservando o colisor esférico estável.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-white">3. Câmera &amp; Multitouch Isolado</h3>
                <EvidenceLabel tag="Testado e observado" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                O analógico direito virtual e as teclas Q/E foram removidos. Em dispositivos móveis, apenas o analógico esquerdo e o botão IMPULSO ficam sobre a tela; a área livre do canvas orbita a câmera com rastreamento estrito por `pointerId`.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-white">4. Validação Pendente em Hardware</h3>
                <EvidenceLabel tag="Ainda não verificado em aparelho físico" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Testes reais de toque simultâneo em tela capacitiva, temperatura/FPS contínuo no Infinix Smart 8 (Android 13 / 4 GB RAM) e mapeamento Bluetooth de controle físico exigem execução direta no dispositivo alvo.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
