import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@openmaic/renderer/fonts.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { StorageHealthNotice } from '@/components/storage-health-notice';
import { AccessCodeGuard } from '@/components/access-code-guard';
import { ProSwapWatcher } from '@/components/workbench/ProSwapWatcher';
import { BrandProvider } from '@/lib/brand/brand-context';
import { BotFrameBridge } from '@/components/bot/BotFrameBridge';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

// The UI font is loaded from @fontsource's stylesheet rather than next/font,
// because only the stylesheet carries the per-subset `unicode-range`
// declarations. Pointing next/font at `inter-latin-wght-normal.woff2` loaded
// exactly one subset, so every character outside Latin — Cyrillic for ru-RU,
// tone-marked letters for vi-VN — fell back to an arbitrary OS font and
// rendered in a different typeface mid-word.
//
// Declaring the other subset files as sibling faces of the same family does not
// fix it either: faces with identical descriptors and no `unicode-range` do not
// fall through per glyph, so the browser simply picks one.
//
// `--font-sans` moves to globals.css since the family no longer comes from
// next/font's generated class.
import '@fontsource-variable/inter';

export const metadata: Metadata = {
  title: {
    default: DEFAULT_BRAND.productName,
    template: `%s · ${DEFAULT_BRAND.productName}`,
  },
  description: '面向教师与培训机构的 AI 互动课程创作与交付平台。',
  icons: {
    icon: DEFAULT_BRAND.markSrc,
    shortcut: DEFAULT_BRAND.markSrc,
    apple: DEFAULT_BRAND.markSrc,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <BrandProvider>
          <ThemeProvider>
            <I18nProvider>
              <ServerProvidersInit />
              <ProSwapWatcher />
              <AccessCodeGuard>
                {children}
                <Suspense fallback={null}>
                  <BotFrameBridge />
                </Suspense>
              </AccessCodeGuard>
              <Toaster position="top-center" />
              {/* After the Toaster: this one raises a toast on mount when
                  persistence is already broken, and a toast raised before its
                  host exists has nowhere to go. */}
              <StorageHealthNotice />
            </I18nProvider>
          </ThemeProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
