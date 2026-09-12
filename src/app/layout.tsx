import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BitTrading',
  description: 'BTC 5분봉 단타 의사결정 지원 시스템',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
