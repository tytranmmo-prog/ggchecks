import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GG Checks — Account Manager',
  description: 'Google AI Credit Account Manager Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
