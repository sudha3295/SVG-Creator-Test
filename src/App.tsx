/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

const MODEL_OPTIONS = [
  { label: 'Gemini 3.8 Flash', id: 'gemini-3.8-flash' },
  { label: 'Gemini 3.7 Flash', id: 'gemini-3.7-flash' },
  { label: 'Gemini 3.5 Flash Lite', id: 'gemini-3.5-flash-lite' },
  { label: 'Gemini 3.1 Pro Preview', id: 'gemini-3.1-pro-preview' },
];

const CLASS_OPTIONS = [
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
];

const CLASS_GUIDELINES: Record<string, string> = {
  'Class 1':
    'Class 1 complexity guidelines: Extremely simple, very large objects, thick outlines, very few colours, very few labels, minimal complexity.',
  'Class 2':
    'Class 2 complexity guidelines: Simple objects, thick outlines, simple colours, clear labels, slightly more detail.',
  'Class 3':
    'Class 3 complexity guidelines: Simple educational diagrams, more labels, basic arrows, moderate detail.',
  'Class 4':
    'Class 4 complexity guidelines: More structured educational diagrams, more terminology, moderate detail.',
  'Class 5':
    'Class 5 complexity guidelines: More detailed textbook-style diagrams, more terminology, still visually simple and child-friendly.',
};

const INITIAL_SYSTEM_PROMPT = `You are an educational SVG illustrator for children in Classes 1–5.

Your job is to create a simple educational line drawing as valid SVG based on the user's request.

The drawing must be appropriate for the selected class level.

Visual style:
- Clean white background
- Simple textbook-style educational illustration
- Clear black/dark outlines
- Simple flat colours
- No photorealism
- No gradients
- No shadows
- No unnecessary decorative elements
- Large, recognizable shapes
- Clear labels when labels are useful for teaching
- Labels must be readable
- Use arrows when they help explain relationships
- Avoid excessive detail

Class-level complexity must be respected.

The SVG must be self-contained and directly renderable by a browser.

Return ONLY valid SVG markup.

Do not wrap the SVG in Markdown code fences.

Do not provide explanations outside the SVG.

Do not use external images, external URLs, external fonts, JavaScript, or external resources.

The SVG should have an appropriate viewBox and should scale correctly.

Prioritize educational clarity over artistic beauty.`;

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  [key: string]: unknown;
}

interface SvgExtractResult {
  svgMarkup: string | null;
  error: string | null;
}

function extractAndValidateSvg(raw: string): SvgExtractResult {
  if (!raw || !raw.trim()) {
    return { svgMarkup: null, error: 'Empty response received from model.' };
  }

  // Find start and end of SVG markup
  const startIdx = raw.indexOf('<svg');
  const endIdx = raw.lastIndexOf('</svg>');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return {
      svgMarkup: null,
      error: 'No valid <svg>...</svg> markup found in the model response.',
    };
  }

  const svgContent = raw.substring(startIdx, endIdx + 6).trim();

  // Parse as XML to verify validity
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');

    if (parserError) {
      return {
        svgMarkup: null,
        error: `SVG XML Parse Error: ${parserError.textContent?.trim() || 'Invalid XML'}`,
      };
    }

    const svgElement = doc.querySelector('svg');
    if (!svgElement) {
      return {
        svgMarkup: null,
        error: 'Parsed markup does not contain a root <svg> element.',
      };
    }

    // Strip script tags and dangerous attributes
    const scripts = svgElement.querySelectorAll('script');
    scripts.forEach((s) => s.remove());

    const allElements = svgElement.querySelectorAll('*');
    allElements.forEach((el) => {
      for (let i = el.attributes.length - 1; i >= 0; i--) {
        const attr = el.attributes[i];
        if (
          attr.name.toLowerCase().startsWith('on') ||
          attr.value.trim().toLowerCase().startsWith('javascript:')
        ) {
          el.removeAttribute(attr.name);
        }
      }
    });

    // Ensure responsive attributes if viewBox is present
    if (!svgElement.getAttribute('xmlns')) {
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    return {
      svgMarkup: svgElement.outerHTML,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      svgMarkup: null,
      error: `DOMParser Exception: ${message}`,
    };
  }
}

export default function App() {
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [selectedClass, setSelectedClass] = useState<string>(CLASS_OPTIONS[0]);
  const [systemPrompt, setSystemPrompt] = useState<string>(INITIAL_SYSTEM_PROMPT);
  const [userPrompt, setUserPrompt] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [usageMetadata, setUsageMetadata] = useState<UsageMetadata | null>(null);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setApiError('Please enter a drawing request in "What should I draw?".');
      return;
    }

    setLoading(true);
    setApiError(null);
    setRawResponse(null);
    setUsageMetadata(null);

    const classGuideline = CLASS_GUIDELINES[selectedClass] || '';
    const fullUserPrompt = `Target Audience: ${selectedClass}\n${classGuideline}\n\nDrawing request:\n${userPrompt.trim()}\n\nReturn ONLY the valid SVG markup.`;

    try {
      const res = await fetch('/api/generate-svg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          systemPrompt: systemPrompt.trim(),
          prompt: fullUserPrompt,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setApiError(data.error || `HTTP ${res.status}: Failed to generate SVG.`);
        if (data.rawText) {
          setRawResponse(data.rawText);
        }
        if (data.usageMetadata) {
          setUsageMetadata(data.usageMetadata);
        }
        return;
      }

      setRawResponse(data.rawText ?? '');
      setUsageMetadata(data.usageMetadata ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setApiError(`Network or Server Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const svgResult = rawResponse !== null ? extractAndValidateSvg(rawResponse) : null;

  // Extract other usage metadata keys
  const knownUsageKeys = new Set([
    'promptTokenCount',
    'candidatesTokenCount',
    'totalTokenCount',
    'cachedContentTokenCount',
    'thoughtsTokenCount',
  ]);

  const otherUsageEntries = usageMetadata
    ? Object.entries(usageMetadata).filter(([key]) => !knownUsageKeys.has(key))
    : [];

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="border-b border-neutral-300 pb-4">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
            SVG Teaching Visual Tester
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            A technical experiment to test whether different Gemini models can generate simple, age-appropriate educational SVG line drawings for children in Classes 1–5.
          </p>
        </header>

        {/* Configuration & Inputs */}
        <div className="bg-white border border-neutral-300 rounded p-4 sm:p-6 space-y-4 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. Model dropdown */}
            <div>
              <label htmlFor="model-select" className="block text-sm font-semibold text-neutral-800 mb-1">
                Gemini Model
              </label>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-300 rounded px-3 py-2 text-sm text-neutral-900 focus:outline-hidden focus:ring-1 focus:ring-neutral-500"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Class dropdown */}
            <div>
              <label htmlFor="class-select" className="block text-sm font-semibold text-neutral-800 mb-1">
                Class Level
              </label>
              <select
                id="class-select"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-300 rounded px-3 py-2 text-sm text-neutral-900 focus:outline-hidden focus:ring-1 focus:ring-neutral-500"
              >
                {CLASS_OPTIONS.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Editable System Prompt */}
          <div>
            <label htmlFor="system-prompt" className="block text-sm font-semibold text-neutral-800 mb-1">
              System Prompt
            </label>
            <textarea
              id="system-prompt"
              rows={8}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full font-mono text-xs bg-neutral-50 border border-neutral-300 rounded p-2.5 text-neutral-900 focus:outline-hidden focus:ring-1 focus:ring-neutral-500"
              placeholder="Enter system prompt..."
            />
          </div>

          {/* 4. User Prompt */}
          <div>
            <label htmlFor="user-prompt" className="block text-sm font-semibold text-neutral-800 mb-1">
              What should I draw?
            </label>
            <textarea
              id="user-prompt"
              rows={3}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              className="w-full text-sm bg-neutral-50 border border-neutral-300 rounded p-2.5 text-neutral-900 focus:outline-hidden focus:ring-1 focus:ring-neutral-500"
              placeholder="Draw the parts of a plant and label the root, stem, leaf and flower."
            />
          </div>

          {/* 5. Generate button */}
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className={`w-full sm:w-auto px-6 py-2.5 rounded font-medium text-sm transition-colors ${
                loading
                  ? 'bg-neutral-400 text-neutral-100 cursor-not-allowed'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-950 cursor-pointer'
              }`}
            >
              {loading ? 'Generating SVG...' : 'Generate SVG'}
            </button>
          </div>
        </div>

        {/* Error Notification */}
        {apiError && (
          <div className="bg-red-50 border border-red-300 rounded p-4 text-red-800 text-sm">
            <h2 className="font-semibold text-red-900">API Error:</h2>
            <p className="mt-1 font-mono text-xs whitespace-pre-wrap">{apiError}</p>
          </div>
        )}

        {/* Output Area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* A. SVG Preview */}
          <div className="bg-white border border-neutral-300 rounded p-4 sm:p-5 flex flex-col space-y-3 shadow-xs">
            <h2 className="text-base font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              A. SVG Preview
            </h2>

            <div className="min-h-[400px] flex-1 border border-dashed border-neutral-300 rounded bg-white flex items-center justify-center p-4 relative overflow-hidden">
              {loading ? (
                <div className="text-neutral-500 text-sm">Generating drawing...</div>
              ) : svgResult ? (
                svgResult.svgMarkup ? (
                  <div
                    className="w-full h-full min-h-[380px] flex items-center justify-center overflow-auto [&>svg]:max-w-full [&>svg]:max-h-[480px] [&>svg]:w-auto [&>svg]:h-auto [&>svg]:mx-auto"
                    dangerouslySetInnerHTML={{ __html: svgResult.svgMarkup }}
                  />
                ) : (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-4 max-w-md w-full">
                    <p className="font-semibold text-red-800">SVG Rendering Error:</p>
                    <p className="mt-1 font-mono whitespace-pre-wrap">{svgResult.error}</p>
                  </div>
                )
              ) : (
                <div className="text-neutral-400 text-sm">
                  Rendered SVG will appear here after generation.
                </div>
              )}
            </div>
          </div>

          {/* B. LLM Response & Token / Usage Info */}
          <div className="bg-white border border-neutral-300 rounded p-4 sm:p-5 flex flex-col space-y-4 shadow-xs">
            <h2 className="text-base font-bold text-neutral-900 border-b border-neutral-200 pb-2">
              B. LLM Response
            </h2>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Complete Raw Response:
              </label>
              <div className="min-h-[220px] max-h-[360px] bg-neutral-900 text-neutral-100 rounded p-3 overflow-auto font-mono text-xs border border-neutral-800">
                {loading ? (
                  <span className="text-neutral-400">Waiting for model response...</span>
                ) : rawResponse !== null ? (
                  <pre className="whitespace-pre-wrap break-all">{rawResponse || '(Empty response returned)'}</pre>
                ) : (
                  <span className="text-neutral-500">Raw response will appear here.</span>
                )}
              </div>
            </div>

            {/* Token / Usage Information */}
            <div className="border-t border-neutral-200 pt-3">
              <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wide mb-2">
                Token / Usage Information
              </h3>

              <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs space-y-1.5">
                <div className="flex justify-between py-0.5 border-b border-neutral-200">
                  <span className="text-neutral-600 font-medium">Input tokens:</span>
                  <span className="font-mono text-neutral-900 font-semibold">
                    {usageMetadata?.promptTokenCount !== undefined
                      ? usageMetadata.promptTokenCount
                      : 'Not available from API'}
                  </span>
                </div>

                <div className="flex justify-between py-0.5 border-b border-neutral-200">
                  <span className="text-neutral-600 font-medium">Output tokens:</span>
                  <span className="font-mono text-neutral-900 font-semibold">
                    {usageMetadata?.candidatesTokenCount !== undefined
                      ? usageMetadata.candidatesTokenCount
                      : 'Not available from API'}
                  </span>
                </div>

                <div className="flex justify-between py-0.5 border-b border-neutral-200">
                  <span className="text-neutral-600 font-medium">Total tokens:</span>
                  <span className="font-mono text-neutral-900 font-semibold">
                    {usageMetadata?.totalTokenCount !== undefined
                      ? usageMetadata.totalTokenCount
                      : 'Not available from API'}
                  </span>
                </div>

                <div className="flex justify-between py-0.5 border-b border-neutral-200">
                  <span className="text-neutral-600 font-medium">Cached input tokens:</span>
                  <span className="font-mono text-neutral-900 font-semibold">
                    {usageMetadata?.cachedContentTokenCount !== undefined
                      ? usageMetadata.cachedContentTokenCount
                      : 'Not available from API'}
                  </span>
                </div>

                {usageMetadata?.thoughtsTokenCount !== undefined && (
                  <div className="flex justify-between py-0.5 border-b border-neutral-200">
                    <span className="text-neutral-600 font-medium">Thoughts / Reasoning tokens:</span>
                    <span className="font-mono text-neutral-900 font-semibold">
                      {usageMetadata.thoughtsTokenCount}
                    </span>
                  </div>
                )}

                {otherUsageEntries.length > 0 && (
                  <div className="pt-1.5">
                    <span className="text-neutral-600 font-medium block mb-1">
                      Other usage metadata:
                    </span>
                    <pre className="font-mono text-[10px] bg-neutral-100 p-2 rounded overflow-x-auto text-neutral-700">
                      {JSON.stringify(
                        Object.fromEntries(otherUsageEntries),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}

                {!usageMetadata && (
                  <div className="text-neutral-400 italic py-1">
                    No usage metadata received yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
