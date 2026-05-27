import { useState } from 'react';
import type { TestResult } from '../../../shared/ipc-contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectionStatus } from './ConnectionStatus';

// Config + key entry for the generic OpenAI-compatible provider (V06 block 05). Base URL
// and model are saved in plaintext settings; the key goes to main → safeStorage and is
// never read back (§1.2). Test validates the typed-or-stored config against the endpoint.
type OpenAiProviderRowProps = {
  baseUrl: string;
  model: string;
  keySet: boolean;
  onChanged: () => void;
};

export function OpenAiProviderRow({ baseUrl, model, keySet, onChanged }: OpenAiProviderRowProps) {
  const [url, setUrl] = useState(baseUrl);
  const [mdl, setMdl] = useState(model);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const canSubmit = url.trim() !== '' && mdl.trim() !== '';

  const save = async (): Promise<void> => {
    setSaving(true);
    setResult(null);
    try {
      await window.api.settings.setOpenAiConfig({
        baseUrl: url.trim(),
        model: mdl.trim(),
        ...(key.trim() ? { key: key.trim() } : {}),
      });
      setKey('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      setResult(
        await window.api.settings.testOpenAi({
          baseUrl: url.trim(),
          model: mdl.trim(),
          ...(key.trim() ? { key: key.trim() } : {}),
        }),
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">OpenAI-compatible</label>
        <ConnectionStatus connected={keySet} />
      </div>
      <Input
        value={url}
        placeholder="Base URL — e.g. https://api.openai.com/v1"
        onChange={(e) => setUrl(e.target.value)}
        className="h-8 text-xs"
      />
      <Input
        value={mdl}
        placeholder="Model id — e.g. gpt-4o"
        onChange={(e) => setMdl(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="flex gap-2">
        <Input
          type="password"
          value={key}
          placeholder={keySet ? 'Enter a new key to replace' : 'Paste API key'}
          onChange={(e) => setKey(e.target.value)}
          className="h-8 text-xs"
        />
        <Button size="sm" onClick={() => void save()} disabled={saving || !canSubmit}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={testing || !canSubmit || (key.trim() === '' && !keySet)}
        >
          {testing ? 'Testing…' : 'Test'}
        </Button>
      </div>
      {result && (
        <p className={`text-[11px] ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.ok ? 'Connection OK' : (result.message ?? 'Connection failed')}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama…). The app is optimized for
        Anthropic; a provider without tool/JSON support will fall back to plain-markdown notes.
      </p>
    </div>
  );
}
