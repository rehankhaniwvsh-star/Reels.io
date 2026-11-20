import { Download, Plus } from 'lucide-react';

export type AppView = 'studio' | 'templates' | 'history' | 'job';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  activeJobZipUrl?: string;
  onNewReel: () => void;
}

export function TopBar({
  activeView,
  onNavigate,
  activeJobZipUrl,
  onNewReel,
}: TopBarProps) {
  const navItems: Array<{ id: AppView; label: string; mobileLabel?: string }> = [
    { id: 'studio', label: 'Studio' },
    { id: 'templates', label: 'Templates' },
    { id: 'history', label: 'Recent Jobs', mobileLabel: 'Jobs' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0C0D10]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-2 sm:gap-8 px-3 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('studio')}
          className="font-display text-base sm:text-lg font-bold tracking-tight text-[#F4F4F5] hover:text-[#F5B700] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] rounded"
        >
          ReelMaker
        </button>

        {/* Zone 2: Concise single-line text nav links */}
        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-3 sm:gap-8"
        >
          {navItems.map((item) => {
            const isActive =
              activeView === item.id ||
              (item.id === 'studio' && activeView === 'job');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] rounded ${
                  isActive
                    ? 'text-[#F4F4F5]'
                    : 'text-[#9CA3AF] hover:text-[#F4F4F5]'
                }`}
              >
                {item.mobileLabel ? (
                  <>
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className="sm:hidden">{item.mobileLabel}</span>
                  </>
                ) : (
                  item.label
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[21px] h-[2px] bg-[#F5B700]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {activeJobZipUrl ? (
            <a
              href={activeJobZipUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F5B700] px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C0D10]"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" aria-hidden="true" />
              <span className="hidden xs:inline sm:inline">Export ZIP</span>
              <span className="sm:hidden">ZIP</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={onNewReel}
              aria-label="New Reel"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#F5B700] px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C0D10]"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">New Reel</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
