
import type { Metadata } from 'next';
import { Inter } from 'next/font/google'; // Import Inter
import './globals.css';
import { cn } from '@/lib/utils'; // Import cn utility

const inter = Inter({ // Initialize Inter font
  variable: '--font-sans', // Use CSS variable convention
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'StepSync Sequencer', // Update title
  description: 'A 16-step multi-track MIDI sequencer built with Next.js', // Update description
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning> {/* Add suppressHydrationWarning for theme handling */}
      <body className={cn("min-h-screen bg-background font-sans antialiased", inter.variable)}>
        {children}
      </body>
    </html>
  );
}
