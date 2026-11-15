import React from 'react';
import type { LabTelemetry } from '../scene/LabSceneManager';
import type { Locale } from '../i18n/translations';
import { t } from '../i18n/translations';

interface TechReportViewProps {
  locale: Locale;
  telemetry: LabTelemetry;
  audioState: string;
}

type EvidenceTag = 'Testado e observado' | 'Investigado documentalmente' | 'Estimado' | 'Ainda não verificado';

function EvidenceLabel({ tag }: { tag: EvidenceTag }) {
  const colorMap: Record<EvidenceTag, string> = {
    'Testado e observado': 'text-emerald-400',
    'Investigado documentalmente': 'text-cyan-400',
    'Estimado': 'text-amber-400',
    'Ainda não verificado': 'text-rose-400',
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

        {/* Live Session Telemetry */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Medições Observadas na Sessão Atual</h2>
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
                {telemetry.engineKind === 'cannon' ? 'Cannon-es' : 'Rapier3D'} · {telemetry.physicsMs} ms
              </div>
            </div>
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Draw Calls / Triângulos</div>
              <div className="mt-1 font-mono text-sm text-white">
                {telemetry.drawCalls} calls · {telemetry.triangles} tris
              </div>
            </div>
            <div className="border border-slate-800 bg-[#111827] rounded-lg p-3.5">
              <div className="text-xs text-slate-400">Heap JS / Web Audio</div>
              <div className="mt-1 font-mono text-sm text-white">
                {telemetry.heapMb !== null ? `${telemetry.heapMb} MB` : 'N/D'} · {audioState}
              </div>
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Matriz Comparativa de Tecnologias</h2>
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead className="bg-[#111827] text-slate-300 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-medium">Camada</th>
                  <th className="py-2.5 px-3 font-medium">Candidato A</th>
                  <th className="py-2.5 px-3 font-medium">Candidato B</th>
                  <th className="py-2.5 px-3 font-medium">Recomendação & Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-[#0d121f]">
                <tr>
                  <td className="py-3 px-3 font-medium text-white">Renderização 3D</td>
                  <td className="py-3 px-3 text-slate-300">
                    Three.js — núcleo enxuto, controle fino de PBR/shaders (onBeforeCompile), InstancedMesh, menor peso inicial.
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    Babylon.js — motor completo integrado, porém pacote significativamente maior (~4.5+ MB) para entrada em Android 4 GB.
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-medium">Three.js</div>
                    <EvidenceLabel tag="Testado e observado" />
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-medium text-white">Física 3D</td>
                  <td className="py-3 px-3 text-slate-300">
                    Cannon-es (JS) — ~90 KB, inicialização instantânea sem WASM, impulsos e forças simples; solver Gauss-Seidel pode exigir ajuste em pilhas densas.
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    Rapier3D WASM — solver mais determinístico e estável em contatos contínuos e múltiplos corpos; custo de ~1.8 MB WASM + init assíncrono.
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-medium">Rapier3D (principal) / Cannon-es (fallback)</div>
                    <EvidenceLabel tag="Testado e observado" />
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-medium text-white">Deformação do Slime</td>
                  <td className="py-3 px-3 text-slate-300">
                    Mola amortecida com preservação de volume (scaleXZ = 1/√scaleY) + shader de vértice (onBeforeCompile) sobre colisor esférico estável.
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    Soft-body real (malha de vértices física) — alto custo de CPU em GPU/SoC de entrada e risco de instabilidade em colisões de plataforma.
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-medium">Mola Visual + Shader + Colisor Esférico</div>
                    <EvidenceLabel tag="Testado e observado" />
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-medium text-white">Áudio Procedural</td>
                  <td className="py-3 px-3 text-slate-300">
                    Web Audio API nativa (osciladores, filtro passa-baixa, compressor, barramentos separados SFX/Música, desbloqueio por gesto).
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    Arquivos MP3/OGG externos — aumentam tempo de download e consumo de memória de decodificação no GitHub Pages.
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-medium">Web Audio API Procedural</div>
                    <EvidenceLabel tag="Testado e observado" />
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-medium text-white">Gamepad em Android</td>
                  <td className="py-3 px-3 text-slate-300">
                    navigator.getGamepads() integrado para polling de eixos 0–3 e botões A/RT com deadzone.
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    Mapeamento Bluetooth no Android 13 varia entre fabricantes (eixos D-pad vs gatilhos analógicos).
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-white font-medium">Implementado via API; exige teste físico</div>
                    <EvidenceLabel tag="Ainda não verificado" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Architecture & Hardware Notes */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Arquitetura Modular Proposta (Etapa 1)</h3>
              <EvidenceLabel tag="Investigado documentalmente" />
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Separação estrita por domínio sem acoplamento circular:
            </p>
            <ul className="text-xs font-mono text-slate-300 space-y-1">
              <li>src/core/loop.ts — timestep fixo + pausa</li>
              <li>src/physics/world.ts — interface única (Rapier3D)</li>
              <li>src/render/renderer.ts — Three.js + DPR ≤ 1.5 no mobile</li>
              <li>src/entities/slime.ts &amp; balloon.ts — estado físico + rig visual</li>
              <li>src/camera/thirdPerson.ts — guinada/arfagem + colisão</li>
              <li>src/input/manager.ts — teclado, touch dual-stick e gamepad</li>
              <li>src/audio/synth.ts — Web Audio SFX + trilha procedural</li>
              <li>src/i18n/ — dicionários centralizados (pt-BR, en, es)</li>
            </ul>
          </div>

          <div className="border border-slate-800 bg-[#111827] rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Riscos para Infinix Smart 8 &amp; Validação</h3>
              <EvidenceLabel tag="Estimado" />
            </div>
            <ul className="text-xs text-slate-300 space-y-1.5 leading-relaxed">
              <li>1. Limitar devicePixelRatio a no máximo 1.25–1.5 e evitar post-processing multi-pass (Mali-G57 MP1 tem largura de banda limitada).</li>
              <li>2. Evitar transmission física em tempo real no Three.js (gera segundo passe de renderização da cena inteira); usar opacity + clearcoat + Fresnel.</li>
              <li>3. Nunca usar backdrop-filter em overlays HTML sobre o elemento canvas WebGL.</li>
              <li>4. Empacotar tudo via Vite com caminhos relativos (base: './') para compatibilidade imediata com GitHub Pages sem CDNs.</li>
              <li>5. Pendência obrigatória: medir FPS real, aquecimento e resposta multi-touch no Infinix Smart 8 físico.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
