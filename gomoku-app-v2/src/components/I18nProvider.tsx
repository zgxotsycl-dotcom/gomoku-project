'use client';

import { I18nextProvider } from 'react-i18next';
import { ReactNode, useEffect } from 'react';
import i18n from '@/i18n';

interface I18nProviderProps {
  children: ReactNode;
  lng: string;
}

const I18nProvider = ({ children, lng }: I18nProviderProps) => {
  useEffect(() => {
    if (i18n.language !== lng) {
      i18n.changeLanguage(lng);
    }
  }, [lng]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};

export default I18nProvider;