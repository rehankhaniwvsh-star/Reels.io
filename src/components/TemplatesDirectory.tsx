import { useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import { CAPTION_TEMPLATES } from '../shared/captionEngine';
import type { CaptionTemplate } from '../shared/types';
import { CaptionPreviewRenderer } from './CaptionPreviewRenderer';

interface TemplatesDirectoryProps {
  selectedTemplateId: string;
  onUseTemplate: (templateId: string) => void;
}

export function TemplatesDirectory({
  selectedTemplateId,
  onUseTemplate,
}: TemplatesDirectoryProps) {
  const [sampleText, setSampleText] = useState(
    'Wait no way bro I almost died laughing at that twist!'
  );
  const [inspectedTemplate, setInspectedTemplate] =
    useState<CaptionTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopyJson(tpl: CaptionTemplate) {
    void navigator.clipboard?.writeText(JSON.stringify(tpl, null, 2));
    setCopiedId(tpl.id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F4F4F5]">
            Caption Templates
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[#9CA3AF]">
            All 8 caption styles are defined as portable JSON presets with
            automatic keyword highlighting and server-side ASS burn-in. Test any
            phrase live below.
          </p>
        </div>

        <div className="w-full max-w-md">
          <label
            htmlFor="template-test-phrase"
            className="mb-1.5 block text-xs font-medium text-[#9CA3AF]"
          >
            Live preview phrase
          </label>
          <input
            id="template-test-phrase"
            type="text"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            className="w-full rounded-lg border border-white/[0.14] bg-[#14161B] px-3.5 py-2 text-sm text-[#F4F4F5] focus:border-[#F5B700] focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {CAPTION_TEMPLATES.map((tpl) => {
          const isDefault = selectedTemplateId === tpl.id;
          return (
            <div
              key={tpl.id}
              className={`flex flex-col overflow-hidden rounded-xl border bg-[#14161B] ${
                isDefault ? 'border-[#F5B700]' : 'border-white/[0.08]'
              }`}
            >
              <div className="relative h-48 w-full overflow-hidden bg-gradient-to-b from-[#1E2330] via-[#13161E] to-[#0B0C10]">
                <CaptionPreviewRenderer
                  template={tpl}
                  customSampleText={sampleText}
                  compact
                />
              </div>

              <div className="flex flex-1 flex-col justify-between p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-base font-semibold text-[#F4F4F5]">
                      {tpl.name}
                    </h2>
                    <span className="font-mono text-xs tabular-nums text-[#9CA3AF]">
                      {tpl.wordsPerLine}w
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#9CA3AF]">
                    {tpl.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] text-[#6B7280]">
                    <span>{tpl.font}</span>
                    <span aria-hidden="true">·</span>
                    <span>{tpl.fontSize}px</span>
                    <span aria-hidden="true">·</span>
                    <span>{tpl.animation}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-white/[0.08] pt-3">
                  <button
                    type="button"
                    onClick={() => onUseTemplate(tpl.id)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      isDefault
                        ? 'bg-[#F5B700] text-[#0C0D10]'
                        : 'bg-[#1B1E25] text-[#F4F4F5] hover:bg-[#F5B700] hover:text-[#0C0D10]'
                    }`}
                  >
                    {isDefault ? 'Active in Studio' : 'Use in Studio'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setInspectedTemplate(
                        inspectedTemplate?.id === tpl.id ? null : tpl
                      )
                    }
                    aria-label={`Inspect JSON for ${tpl.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.12] text-[#9CA3AF] hover:text-[#F4F4F5]"
                  >
                    <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {inspectedTemplate ? (
        <section className="mt-8 rounded-xl border border-white/[0.1] bg-[#14161B] p-5">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-3">
            <h3 className="font-display text-sm font-semibold text-[#F4F4F5]">
              JSON Preset — {inspectedTemplate.name}
            </h3>
            <button
              type="button"
              onClick={() => handleCopyJson(inspectedTemplate)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-[#F5B700]"
            >
              {copiedId === inspectedTemplate.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
          </div>
          <pre className="mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-[#D1D5DB]">
            {JSON.stringify(inspectedTemplate, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
