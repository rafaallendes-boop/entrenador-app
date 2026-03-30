export default function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-spin rounded-full border-2 border-surface-border border-t-brand w-5 h-5 ${className}`} />
  )
}
