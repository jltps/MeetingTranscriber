// Visual "connected" indicator for an API provider (V06 block 05): a colored dot + label.
// Connected uses the teal brand accent (--primary); not-connected is muted.
type ConnectionStatusProps = { connected: boolean };

export function ConnectionStatus({ connected }: ConnectionStatusProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span
        className={`inline-block size-2 rounded-full ${connected ? 'bg-primary' : 'bg-muted-foreground/40'}`}
        aria-hidden
      />
      <span className={connected ? 'text-primary' : 'text-muted-foreground'}>
        {connected ? 'Connected' : 'Not connected'}
      </span>
    </span>
  );
}
