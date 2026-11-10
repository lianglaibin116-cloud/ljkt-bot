import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import 'animate.css';
import 'katex/dist/katex.min.css';
import '../../app/globals.css';
import { BrandProvider } from '../../lib/brand/brand-context';
import { ThemeProvider } from '../../lib/hooks/use-theme';
import { I18nProvider } from '../../lib/hooks/use-i18n';
import { ServerProvidersInit } from '../../components/server-providers-init';
import { Toaster } from '../../components/ui/sonner';
import BotWorkspace from '../../components/bot/BotWorkspace';

const root = document.getElementById('root');
if (!root) throw new Error('Bot desktop renderer root is missing');
createRoot(root).render(
  <React.StrictMode>
    <BrandProvider isDesktop>
      <ThemeProvider>
        <I18nProvider>
          <ServerProvidersInit />
          <BotWorkspace />
          <Toaster position="top-center" />
        </I18nProvider>
      </ThemeProvider>
    </BrandProvider>
  </React.StrictMode>,
);
