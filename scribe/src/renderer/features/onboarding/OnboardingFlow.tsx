import { useState } from 'react';
import logoUrl from '../../assets/logo.svg';
import type { SettingsView } from '../../../shared/ipc-contract';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KeyRow } from '../settings/KeyRow';

// First-run onboarding (ROADMAP_V04_07): welcome → privacy → connect keys → ready.
// A non-dismissible gate that subsumes the old PrivacyNotice. Privacy persists via
// settings.acceptPrivacy(); completion via settings.completeOnboarding(). Keys are
// entered through the shared KeyRow (the single §1.2 key path) and are skippable.
type Step = 'welcome' | 'privacy' | 'keys' | 'ready';
const STEPS: Step[] = ['welcome', 'privacy', 'keys', 'ready'];

type OnboardingFlowProps = {
  settings: SettingsView;
  onChanged: () => void;
  onComplete: () => void;
};

export function OnboardingFlow({ settings, onChanged, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('welcome');

  const acceptPrivacy = async (): Promise<void> => {
    await window.api.settings.acceptPrivacy();
    onChanged();
    setStep('keys');
  };

  const finish = async (): Promise<void> => {
    await window.api.settings.completeOnboarding();
    onComplete();
  };

  // Adding a Gladia key during onboarding also makes it the active provider
  // (the recommended option). Deepgram stays the fallback if no Gladia key.
  const onGladiaSaved = (): void => {
    void window.api.settings.setTranscriptionProvider('gladia').then(onChanged);
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        {step === 'welcome' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                <img src={logoUrl} alt="" className="size-5 rounded-[4px]" />
                Welcome to Nexus
              </div>
              <DialogDescription>
                A bot-free meeting notepad. It captures your mic + system audio locally, transcribes
                it, and turns your rough notes into clean ones — without ever joining your call.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setStep('privacy')}>Get started</Button>
            </DialogFooter>
          </>
        )}

        {step === 'privacy' && (
          <>
            <DialogHeader>
              <DialogTitle>Before you start</DialogTitle>
              <DialogDescription>
                Nexus captures your microphone and your computer’s system audio, and streams it for
                transcription. Here’s exactly what that means:
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                • <b className="text-foreground">Audio is sent to your transcription provider</b>{' '}
                (Gladia or Deepgram) for live transcription and never stored — frames are dropped
                the moment they’re transcribed.
              </li>
              <li>
                • <b className="text-foreground">Transcript text and your notes go to Anthropic</b>{' '}
                (Claude) only when you enhance a meeting.
              </li>
              <li>
                • Nothing is sent anywhere else. Notes, transcripts, and settings stay in a local
                database on this machine.
              </li>
              <li>
                • Capture works at the OS level — Nexus never joins your call. Tell others present
                that you’re transcribing.
              </li>
            </ul>
            <DialogFooter>
              <Button onClick={() => void acceptPrivacy()}>I understand &amp; continue</Button>
            </DialogFooter>
          </>
        )}

        {step === 'keys' && (
          <>
            <DialogHeader>
              <DialogTitle>Connect your API keys</DialogTitle>
              <DialogDescription>
                <b>Gladia</b> (recommended) or Deepgram powers transcription — Gladia also adds
                post-call insights (speaker breakdown, entities, sentiment). Anthropic (Claude)
                powers note enhancement and chat. Keys are encrypted by your OS and never leave this
                machine. You can add them later in Settings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <KeyRow label="Gladia (recommended)" provider="gladia" isSet={settings.gladiaKeySet} onSaved={onGladiaSaved} />
              <KeyRow label="Deepgram" provider="deepgram" isSet={settings.deepgramKeySet} onSaved={onChanged} />
              <KeyRow label="Anthropic" provider="anthropic" isSet={settings.anthropicKeySet} onSaved={onChanged} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('ready')}>
                Skip for now
              </Button>
              <Button onClick={() => setStep('ready')}>Continue</Button>
            </DialogFooter>
          </>
        )}

        {step === 'ready' && (
          <>
            <DialogHeader>
              <DialogTitle>You’re all set</DialogTitle>
              <DialogDescription>
                Create a note and hit Start to capture your first meeting. Press Ctrl/Cmd-K any time
                to jump around.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => void finish()}>Open Nexus</Button>
            </DialogFooter>
          </>
        )}

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((s) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s === step ? 'w-4 bg-primary' : 'w-1.5 bg-muted'
              }`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
