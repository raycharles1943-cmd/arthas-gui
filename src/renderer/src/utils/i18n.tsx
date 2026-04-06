import { createContext, useContext, useState, useEffect } from 'react';
import { usePersistentState } from './usePersistentState';

type Language = 'zh' | 'en';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations = {
  zh: {
    'app.title': 'Arthas GUI',
    'app.dashboard': '仪表盘',
    'app.threads': '线程',
    'app.monitor': '请求监控',
    'app.classes': '搜索 (sc/sm)',
    'app.watch': '诊断',
    'app.tt': '时间隧道',
    'app.hotswap': '热部署',
    'app.env': '环境',
    'app.logger': '日志',
    'app.settings': '设置',
    'app.detach': '断开连接',
    'app.attached.pid': '已连接 PID',
    'app.refresh': '刷新',
    'app.search.placeholder': '按 PID 或进程名搜索...',
    'app.loading': '加载中...',
    'app.no.processes': '未找到 Java 进程。',
    'app.connect': '连接',
    'app.settings.title': '应用设置',
    'app.settings.language': '语言',
    'app.settings.language.zh': '中文',
    'app.settings.language.en': '英文',
    'app.settings.debugMode': '调试模式',
    'app.settings.debugMode.description': '开启后可以在浏览器中按 F12 打开开发者工具',
    'app.settings.debugMode.restart': '需重启应用',
    'app.settings.configuration': 'Arthas HTTP API、隧道服务器和 UI 主题的配置选项将在此处可用。',
    'app.error.failed.processes': '无法列出 Java 进程。请查看日志了解更多详细信息。',
    'app.footer': '确保 Java 进程正在运行并且当前用户可以访问。',
    'app.attach.success': '连接成功',
    'app.attach.failed': '连接失败',
    'app.attach.timeout': '连接超时',
    'app.process.name': '进程名称',
    'app.action': '操作',
  },
  en: {
    'app.title': 'Arthas GUI',
    'app.dashboard': 'Dashboard',
    'app.threads': 'Threads',
    'app.monitor': 'Request Monitor',
    'app.classes': 'Search (sc/sm)',
    'app.watch': 'Diagnostics',
    'app.tt': 'Time Tunnel',
    'app.hotswap': 'Hot Swap',
    'app.env': 'Environment',
    'app.logger': 'Logger',
    'app.settings': 'Settings',
    'app.detach': 'Detach Instance',
    'app.attached.pid': 'Attached PID',
    'app.refresh': 'Refresh',
    'app.search.placeholder': 'Search by PID or process name...',
    'app.loading': 'Loading processes...',
    'app.no.processes': 'No Java processes found.',
    'app.connect': 'Connect',
    'app.settings.title': 'Application Settings',
    'app.settings.language': 'Language',
    'app.settings.language.zh': 'Chinese',
    'app.settings.language.en': 'English',
    'app.settings.debugMode': 'Debug Mode',
    'app.settings.debugMode.description': 'After enabling, you can open developer tools with F12 in browser',
    'app.settings.debugMode.restart': 'Restart required',
    'app.settings.configuration': 'Configuration options for Arthas HTTP API, Tunnel server, and UI themes will be available here.',
    'app.error.failed.processes': 'Failed to list Java processes. Check the logs for more details.',
    'app.footer': 'Make sure the Java process is running and accessible by your current user.',
    'app.attach.success': 'Attached successfully',
    'app.attach.failed': 'Failed to attach',
    'app.attach.timeout': 'Attach timeout',
    'app.process.name': 'Process Name',
    'app.action': 'Action',
  },
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguage] = usePersistentState<Language>('language', 'zh');

  const t = (key: string) => {
    return translations[language][key as keyof typeof translations[typeof language]] || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
