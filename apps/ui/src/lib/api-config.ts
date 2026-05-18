interface ApiEndpoint {
  key: string;
  label: string;
  url: string;
}

interface RuntimeConfig {
  VITE_DEFAULT_API_URL?: string;
  VITE_API_URL?: string;
  VITE_API_URLS?: string;
  VITE_SHOW_INSTANCE_SELECTOR?: string;
}

declare global {
  interface Window {
    __DPG_UI_CONFIG__?: RuntimeConfig;
  }
}

class ApiConfig {
  private endpoints: ApiEndpoint[] = [];
  private selectedKey: string | null = null;

  constructor() {
    this.loadFromEnv();
    this.loadFromStorage();
  }

  private loadFromEnv() {
    const runtimeConfig = window.__DPG_UI_CONFIG__ ?? {};
    const urlsJson =
      runtimeConfig.VITE_API_URLS ||
      import.meta.env.VITE_API_URLS;
    const defaultUrl =
      runtimeConfig.VITE_DEFAULT_API_URL ??
      runtimeConfig.VITE_API_URL ??
      import.meta.env.VITE_DEFAULT_API_URL ??
      import.meta.env.VITE_API_URL ??
      'http://localhost:3000';

    this.endpoints.push({
      key: 'default',
      label: `Default (${defaultUrl})`,
      url: defaultUrl,
    });

    if (urlsJson) {
      try {
        const parsed = JSON.parse(urlsJson);
        for (const [key, url] of Object.entries(parsed)) {
          this.endpoints.push({
            key,
            label: `${key} (${url as string})`,
            url: url as string,
          });
        }
      } catch {
        // Invalid JSON, skip additional URLs
      }
    }
  }

  private loadFromStorage() {
    const stored = localStorage.getItem('selectedApiUrl');
    if (stored && this.endpoints.some((e) => e.key === stored)) {
      this.selectedKey = stored;
    }
  }

  getUrl(): string {
    const endpoint = this.endpoints.find(
      (e) => e.key === this.selectedKey
    );
    return endpoint?.url ?? this.endpoints[0]?.url ?? 'http://localhost:3000';
  }

  getEndpoints(): ApiEndpoint[] {
    return this.endpoints;
  }

  getSelectedKey(): string | null {
    return this.selectedKey;
  }

  setSelectedKey(key: string) {
    this.selectedKey = key;
    localStorage.setItem('selectedApiUrl', key);
  }

  isDevMode(): boolean {
    const runtimeConfig = window.__DPG_UI_CONFIG__ ?? {};
    if (
      runtimeConfig.VITE_SHOW_INSTANCE_SELECTOR === 'true' ||
      import.meta.env.VITE_SHOW_INSTANCE_SELECTOR === 'true'
    ) {
      return true;
    }
    return import.meta.env.DEV;
  }
}

export const apiConfig = new ApiConfig();
