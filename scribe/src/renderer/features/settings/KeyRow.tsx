import { useState } from 'react';
import type { TestProvider, TestResult } from '../../../shared/ipc-contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectionStatus } from './ConnectionStatus';

// A single API-key entry row (Deepgram / Anthropic). The only key-handling path
// (§1.2): the typed value lives in local state, is sent to main via
// settings.setKeys → safeStorage, and is cleared on save — never logged, never
// stored in the renderer. Shared by Settings and the onboarding keys step.
type KeyRowProps = {
  label: string;
  provider: TestProvider;
  isSet: boolean;
  onSaved: () => void;
};

export function KeyRow({ label, provider, isSet, onSaved }: KeyRowProps) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setResult(null);
    try {
      await window.api.settings.setKeys(
        provider === 'deepgram' ? { deepgram: value } : { anthropic: value },
      );
      setValue('');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      // Test the key in the box if there is one; otherwise test the saved key.
      setResult(await window.api.settings.test(provider, value.trim() || undefined));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{label}</label>
        <ConnectionStatus connected={isSet} />
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          placeholder={isSet ? 'Enter a new key to replace' : 'Paste API key'}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 text-xs"
        />
        <Button size="sm" onClick={() => void save()} disabled={saving || value.trim() === ''}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={testing || (value.trim() === '' && !isSet)}
        >
          {testing ? 'Testing…' : 'Test'}
        </Button>
      </div>
      {result && (
        <p className={`text-[11px] ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.ok ? 'Connection OK' : (result.message ?? 'Connection failed')}
        </p>
      )}
    </div>
  );
}
