import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Caprae LeadGen Enhancement Pipeline',
  description:
    'Verify, score and triage B2B leads before they reach your sales team.',
};

export const viewport: Viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative min-h-dvh bg-slate-950 font-sans">
        <div className="ambient-field" aria-hidden="true">
          <div
            className="ambient-orb animate-drift"
            style={{
              width: '46rem',
              height: '46rem',
              top: '-16rem',
              left: '-10rem',
              background:
                'radial-gradient(circle at 30% 30%, rgba(99,102,241,0.55), transparent 65%)',
            }}
          />
          <div
            className="ambient-orb animate-drift"
            style={{
              width: '38rem',
              height: '38rem',
              top: '-8rem',
              right: '-8rem',
              animationDelay: '-6s',
              background:
                'radial-gradient(circle at 60% 40%, rgba(45,212,191,0.34), transparent 66%)',
            }}
          />
          <div
            className="ambient-orb animate-drift"
            style={{
              width: '40rem',
              height: '40rem',
              bottom: '-18rem',
              left: '28%',
              animationDelay: '-11s',
              background:
                'radial-gradient(circle at 50% 50%, rgba(217,70,239,0.24), transparent 68%)',
            }}
          />
          <div className="ambient-grid" />
        </div>

        {children}
      </body>
    </html>
  );
}
