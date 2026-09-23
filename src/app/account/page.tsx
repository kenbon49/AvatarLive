'use client';

import Link from 'next/link';
import { ArrowLeft, Cpu, LogOut, Mail, Pencil, RefreshCw, Save, Settings2, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import './account.css';

type Account = {
  id: string;
  email: string;
  username: string | null;
  role: 'admin' | 'user';
  status: string;
};
type Setting = {
  key: string;
  label: string;
  configured: boolean;
  saved: boolean;
  secret: boolean;
  mode: 'api' | 'deployment' | 'rotation';
  value?: string | null;
};
type SettingList = { settings: Setting[]; rootKeyConfigured: boolean };
type LlmConfiguration = {
  configured: boolean;
  baseUrl: string;
  keyConfigured: boolean;
  defaultModel: string;
  models: { id: string; ownedBy: string }[];
};
type AccountTab = 'profile' | 'settings';

const CREDENTIAL_KEYS = new Set(['aliyun_access_key_id', 'aliyun_access_key_secret']);

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [configuration, setConfiguration] = useState<SettingList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingSetting, setSavingSetting] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [llmConfiguration, setLlmConfiguration] = useState<LlmConfiguration | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState('');
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountTab>('profile');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE}/api/v1/auth/me`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then(async (accountResponse) => {
      if (accountResponse.status === 401) {
        router.replace('/login?next=/account');
        return;
      }
      if (!accountResponse.ok) throw new Error('无法读取账号信息');
      const currentAccount = await accountResponse.json() as Account;
      setAccount(currentAccount);
    }).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : '无法读取账号信息');
    });
    return () => controller.abort();
  }, [router]);

  const loadSettings = useCallback(async () => {
    setSettingsError('');
    const response = await fetch(`${API_BASE}/api/v1/admin/settings`, {
      cache: 'no-store', credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(await responseError(response, '无法读取系统设置'));
    setConfiguration(await response.json() as SettingList);
  }, []);

  const loadLlmModels = useCallback(async () => {
    setLlmLoading(true);
    setLlmError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/llm/models`, {
        cache: 'no-store', credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await responseError(response, '无法读取模型列表'));
      setLlmConfiguration(await response.json() as LlmConfiguration);
    } catch (cause) {
      setLlmError(cause instanceof Error ? cause.message : '无法读取模型列表');
    } finally {
      setLlmLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account?.role !== 'admin' || activeTab !== 'settings' || configuration) return;
    void loadSettings().catch((cause: unknown) => {
      setSettingsError(cause instanceof Error ? cause.message : '无法读取系统设置');
    });
    void loadLlmModels();
  }, [account?.role, activeTab, configuration, loadLlmModels, loadSettings]);

  async function saveSetting(setting: Setting) {
    const value = drafts[setting.key]?.trim();
    if (!value || account?.role !== 'admin') return;
    setSavingSetting(setting.key);
    setSettingsMessage('');
    setSettingsError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/settings/${setting.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error(await responseError(response, '保存失败'));
      setDrafts((current) => ({ ...current, [setting.key]: '' }));
      setSettingsMessage(setting.mode === 'deployment'
        ? `${setting.label}已加密保存，待部署应用`
        : `${setting.label}已更新`);
      await loadSettings();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSavingSetting('');
    }
  }

  async function saveLlmConfiguration() {
    const baseSetting = configuration?.settings.find((item) => item.key === 'llm_base_url');
    const keySetting = configuration?.settings.find((item) => item.key === 'llm_api_key');
    const baseUrl = (drafts.llm_base_url ?? baseSetting?.value ?? llmConfiguration?.baseUrl ?? '').trim();
    const apiKey = drafts.llm_api_key?.trim() || '';
    if (!baseUrl || (!apiKey && !keySetting?.configured && !llmConfiguration?.keyConfigured)) return;
    setSavingSetting('llm_configuration');
    setSettingsMessage('');
    setSettingsError('');
    setLlmError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/llm/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'LLM 配置保存失败'));
      const nextConfiguration = await response.json() as LlmConfiguration;
      setLlmConfiguration(nextConfiguration);
      setDrafts((current) => {
        const next = { ...current };
        delete next.llm_api_key;
        delete next.llm_base_url;
        return next;
      });
      setSettingsMessage(`LLM 服务已连接，已读取 ${nextConfiguration.models.length} 个模型`);
      await loadSettings();
    } catch (cause) {
      setLlmError(cause instanceof Error ? cause.message : 'LLM 配置保存失败');
    } finally {
      setSavingSetting('');
    }
  }

  async function saveDefaultModel(modelId: string) {
    if (!modelId || account?.role !== 'admin') return;
    setSavingSetting('llm_default_model_id');
    setSettingsMessage('');
    setLlmError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/admin/llm/default-model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ model_id: modelId }),
      });
      if (!response.ok) throw new Error(await responseError(response, '默认模型保存失败'));
      setLlmConfiguration(await response.json() as LlmConfiguration);
      setSettingsMessage(`默认模型已切换为 ${modelId}`);
      await loadSettings();
    } catch (cause) {
      setLlmError(cause instanceof Error ? cause.message : '默认模型保存失败');
    } finally {
      setSavingSetting('');
    }
  }

  async function logout() {
    setSigningOut(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('退出登录失败，请重试');
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出登录失败，请重试');
      setSigningOut(false);
    }
  }

  const displayName = account?.username || account?.email || '正在读取账号';
  const credentialSettings = configuration?.settings.filter((item) => CREDENTIAL_KEYS.has(item.key)) ?? [];
  const llmBaseSetting = configuration?.settings.find((item) => item.key === 'llm_base_url');
  const llmKeySetting = configuration?.settings.find((item) => item.key === 'llm_api_key');
  const llmBaseUrl = drafts.llm_base_url ?? llmBaseSetting?.value ?? llmConfiguration?.baseUrl ?? '';
  const llmApiKey = drafts.llm_api_key ?? '';
  const canSaveLlm = Boolean(llmBaseUrl.trim() && (llmApiKey.trim() || llmKeySetting?.configured || llmConfiguration?.keyConfigured));
  return <main className="accountPage">
    <header className="accountHeader">
      <Link href="/"><ArrowLeft size={16} />返回控制台</Link>
      <h1>账号与登录</h1>
      <p>管理当前账号、使用积分和访问权限。</p>
    </header>

    {account?.role === 'admin' && <nav className="accountTabs" aria-label="账号管理">
      <button
        id="account-tab-profile"
        type="button"
        aria-pressed={activeTab === 'profile'}
        aria-controls="account-panel-profile"
        className={activeTab === 'profile' ? 'active' : ''}
        onClick={() => setActiveTab('profile')}
      >
        <UserRound size={16} />账号资料
      </button>
      <Link href="/admin"><UsersRound size={16} />用户管理</Link>
      <button
        id="account-tab-settings"
        type="button"
        aria-pressed={activeTab === 'settings'}
        aria-controls="account-panel-settings"
        className={activeTab === 'settings' ? 'active' : ''}
        onClick={() => setActiveTab('settings')}
      >
        <Settings2 size={16} />系统设置
      </button>
    </nav>}

    {error && <p className="accountError" role="alert">{error}</p>}

    {activeTab === 'profile' && <section className="accountPanel accountProfile" id="account-panel-profile" aria-labelledby={account?.role === 'admin' ? 'account-tab-profile' : undefined}>
        <div className="accountIdentity">
          <span className="accountPageAvatar">{displayName.slice(0, 2).toUpperCase()}</span>
          <div><strong>{displayName}</strong><span>{account?.role === 'admin' ? '系统管理员' : '普通用户'}</span></div>
        </div>

        <dl className="accountDetails">
          <div><dt><UserRound size={17} />用户名</dt><dd>{account?.username || '未设置'}</dd></div>
          <div><dt><Mail size={17} />邮箱</dt><dd>{account ? account.email || '未设置' : '正在读取'}</dd></div>
          <div><dt><ShieldCheck size={17} />账号权限</dt><dd>{account?.role === 'admin' ? '系统管理员' : '普通用户'} · {account?.status === 'approved' ? '已通过审核' : '状态读取中'}</dd></div>
        </dl>

        <div className="accountActions">
          <div><strong>退出当前账号</strong><span>退出后需要重新输入账号和密码才能访问控制台。</span></div>
          <button type="button" disabled={signingOut} onClick={() => void logout()}><LogOut size={17} />{signingOut ? '正在退出' : '退出登录'}</button>
        </div>
      </section>}

    {account?.role === 'admin' && activeTab === 'settings' && <section className="accountPanel accountAdmin" id="account-panel-settings" aria-labelledby="account-tab-settings">
      <header className="accountAdminHeader">
        <div><span><Settings2 size={17} />管理员功能</span><h2>系统设置</h2></div>
      </header>
      <p className="accountAdminNote"><ShieldCheck size={16} />{configuration?.rootKeyConfigured ? '密钥加密已启用' : '密钥加密未启用'} · 已配置的密钥不会回显。</p>
      {settingsMessage && <p className="accountSettingsMessage" role="status">{settingsMessage}</p>}
      {settingsError && <p className="accountError" role="alert">{settingsError}</p>}

      <div className="accountSettingGroup accountLlmGroup">
        <h3><Cpu size={16} />大模型服务</h3>
        <div className="accountLlmFields">
          <label><span>服务地址</span><input type="url" inputMode="url" autoComplete="url" placeholder="https://example.com/v1" value={llmBaseUrl} onChange={(event) => setDrafts((current) => ({ ...current, llm_base_url: event.target.value }))} /></label>
          <label><span>API Key</span><input type="password" autoComplete="new-password" placeholder={llmKeySetting?.configured || llmConfiguration?.keyConfigured ? '已配置，留空保持不变' : '输入 API Key'} value={llmApiKey} onChange={(event) => setDrafts((current) => ({ ...current, llm_api_key: event.target.value }))} /></label>
        </div>
        <div className="accountLlmActions">
          <button type="button" disabled={!canSaveLlm || Boolean(savingSetting)} onClick={() => void saveLlmConfiguration()}><Save size={14} />{savingSetting === 'llm_configuration' ? '连接中' : '保存并获取模型'}</button>
          <button className="iconButton" type="button" title="刷新模型列表" aria-label="刷新模型列表" disabled={llmLoading || Boolean(savingSetting) || !llmConfiguration?.configured} onClick={() => void loadLlmModels()}><RefreshCw className={llmLoading ? 'spinning' : ''} size={15} /></button>
          <span className={llmConfiguration?.configured && llmConfiguration.models.length ? 'connected' : ''}>{llmLoading ? '正在读取' : llmConfiguration?.models.length ? `${llmConfiguration.models.length} 个模型` : '尚未连接'}</span>
        </div>
        {llmConfiguration?.models.length ? <label className="accountLlmModel"><span>默认模型</span><select aria-label="默认模型" value={llmConfiguration.models.some((item) => item.id === llmConfiguration.defaultModel) ? llmConfiguration.defaultModel : ''} disabled={Boolean(savingSetting)} onChange={(event) => void saveDefaultModel(event.target.value)}><option value="" disabled>请选择模型</option>{llmConfiguration.models.map((model) => <option value={model.id} key={model.id}>{model.id}</option>)}</select></label> : null}
        {llmConfiguration?.models.length && !llmConfiguration.models.some((item) => item.id === llmConfiguration.defaultModel) ? <p className="accountLlmWarning">当前默认模型不在新服务列表中，请选择一个模型。</p> : null}
        {llmError && <p className="accountInlineError" role="alert">{llmError}</p>}
      </div>

      {credentialSettings.length > 0 && <div className="accountSettingGroup">
        <h3>接口密钥</h3>
        {credentialSettings.map((setting) => <div className="accountSetting" key={setting.key}>
          <div><strong>{setting.label}</strong></div>
          <span className={setting.configured ? 'configured' : 'missing'}>{setting.saved ? '已保存' : setting.configured ? '已通过环境配置' : '未配置'}{setting.mode === 'deployment' && setting.saved && <small>部署后生效</small>}</span>
          <details className="accountSettingEdit"><summary><Pencil size={13} />{setting.configured ? '更换' : '配置'}</summary>
            <div><input type="password" aria-label={`替换${setting.label}`} autoComplete="off" placeholder="输入新密钥" value={drafts[setting.key] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))} />
              <button type="button" disabled={!drafts[setting.key]?.trim() || Boolean(savingSetting)} onClick={() => void saveSetting(setting)}><Save size={14} />保存</button></div></details>
        </div>)}
      </div>}

    </section>}
  </main>;
}
