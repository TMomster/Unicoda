import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import { useLock } from "../contexts/LockContext";
import { useSearch } from "../contexts/SearchContext";
import { getConfigDir } from "../utils/configStorage";
import { invoke } from "@tauri-apps/api/core";
import AnimatedSection from "./AnimatedSection";
import AuroraBackground from "./AuroraBackground";
import type { ModelParams } from "../types";

interface Props { onBack: () => void; yolo?: boolean; }

// ── 可复制文本的弹窗组件 ──
function AlertModal({ msg, onClose }: { msg: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  if (!msg) return null;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--c-bg2)", border: "1px solid var(--c-bd)", borderRadius: "12px", padding: "24px", width: "420px", maxWidth: "90vw", maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
        <div ref={textRef} style={{ fontSize: "13px", color: "var(--c-txt)", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowY: "auto", userSelect: "text", WebkitUserSelect: "text", flex: 1, marginBottom: "16px", cursor: "text" }}>
          {msg}
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={() => { navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--c-bd)", background: "var(--c-bg)", color: copied ? "#22c55e" : "var(--c-t2)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
            {copied ? "✓ 已复制" : "📋 复制"}
          </button>
          <button onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "var(--c-ac)", color: "#fff", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
const TO = [1, 3, 5, 10, 15, 30] as const;
const C = { bg: "var(--c-bg)", border: "var(--c-bd)", bf: "var(--c-bf)", txt: "var(--c-txt)", t2: "var(--c-t2)", t3: "var(--c-t3)", t4: "var(--c-t4)", ac: "var(--c-ac)", ah: "var(--c-ah)" };
const YB = { bg: "rgba(10,10,15,0.25)", bborder: "rgba(255,255,255,0.06)", b2: "rgba(255,255,255,0.1)", b3: "rgba(20,20,28,0.5)" };
const PP = ["Deepseek", "OpenAI", "Anthropic", "Google"];

interface DRPreset { label: string; desc: string; mn: string; bu: string; p: Partial<ModelParams>; }
const DR_PRESETS: Record<string, DRPreset> = {
  chat: { label: "Chat", desc: "deepseek-chat（通用对话，即将废弃）", mn: "deepseek-chat", bu: "https://api.deepseek.com/v1", p: { temperature: 0.7, maxTokens: 128000, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: false } },
  reasoner: { label: "Reasoner", desc: "deepseek-reasoner（深度推理，即将废弃）", mn: "deepseek-reasoner", bu: "https://api.deepseek.com/v1", p: { temperature: 0.3, maxTokens: 384000, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: false } },
  flash: { label: "Flash", desc: "deepseek-v4-flash（极速对话，推荐）", mn: "deepseek-v4-flash", bu: "https://api.deepseek.com", p: { temperature: 0.7, maxTokens: 128000, topP: 1, allowFileUpload: false } },
  pro: { label: "Pro", desc: "deepseek-v4-pro（深度思考，推荐）", mn: "deepseek-v4-pro", bu: "https://api.deepseek.com", p: { temperature: 0.3, maxTokens: 384000, topP: 1, allowFileUpload: false } },
};

const fl: React.CSSProperties = { fontSize: "13px", color: C.t2, fontWeight: 500, marginBottom: "8px", lineHeight: 1.6 };
const is: React.CSSProperties = { width: "100%", padding: "11px 14px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg, color: C.txt, fontSize: "13px", fontFamily: "inherit", outline: "none", boxSizing: "border-box", lineHeight: 1.6, transition: "border-color 0.15s, box-shadow 0.15s" };
const ss: React.CSSProperties = { ...is, padding: "11px 36px 11px 14px", cursor: "pointer", appearance: "none", WebkitAppearance: "none" };
const sc = (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><polyline points="6 9 12 15 18 9" /></svg>);

function SW({ on, oc }: { on: boolean; oc: (e: React.MouseEvent) => void }) {
  return (<div onClick={oc} style={{ width: "40px", height: "22px", borderRadius: "11px", backgroundColor: on ? C.ac : C.border, position: "relative", transition: "background 0.2s", flexShrink: 0, cursor: "pointer" }}>
    <div style={{ width: "18px", height: "18px", borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: "2px", left: on ? "20px" : "2px", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} /></div>);
}
function RS({ label, val, min, max, step, oc, dv }: { label: string; val: number; min: number; max: number; step: number; oc: (v: number) => void; dv: string }) {
  const p = ((val - min) / (max - min)) * 100;
  return (<div style={{ marginBottom: "20px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", lineHeight: 1.6 }}>
      <span style={fl}>{label}</span><span style={{ fontSize: "12px", color: C.ac, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{dv}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => oc(parseFloat(e.target.value))}
      style={{ width: "100%", height: "4px", appearance: "none", background: `linear-gradient(to right, ${C.ac} ${p}%, ${C.border} ${p}%)`, borderRadius: "2px", outline: "none", cursor: "pointer" }} />
  </div>);
}
function SE({ title, desc, children, yolo }: { title: string; desc?: string; children: React.ReactNode; yolo?: boolean }) {
  return (
    <div style={{
      paddingTop: "32px", paddingBottom: "32px",
      ...(yolo ? {
        margin: "0 12px 12px",
        padding: "24px 0",
        borderRadius: "16px",
        backgroundColor: "rgba(10,10,18,0.20)",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 0 40px rgba(0,0,0,0.2)",
      } : {}),
    }}>
      <div style={{ padding: "0 24px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: C.txt, lineHeight: 1.6 }}>{title}</div>
        {desc && <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, marginTop: "6px", whiteSpace: "pre-wrap" }}>{desc}</div>}
      </div>
      <div style={{ padding: "20px 24px 0" }}>{children}</div>
    </div>
  );
}

export default function SettingsPanel({ onBack, yolo }: Props) {
  const { scale, setScale, selectedFontName, setSelectedFont, fontOptions, t, locale, setLocale, sessionPath, setSessionPath, userName, setUserName, userAvatar, setUserAvatar, defaultMarkdown, setDefaultMarkdown, defaultReasoningOpen, setDefaultReasoningOpen, developerMode, setDeveloperMode, theme, setTheme, resetSettings } = useTheme();
  const { models, selectedModelId, setSelectedModelId, addModel, updateModel, removeModel } = useModels();
  const { hasPassword, privacyEnabled, setPrivacyEnabled, idleTimeout, setIdleTimeout, startupLockEnabled, setStartupLockEnabled, setPassword, changePassword, clearPassword } = useLock();
  const { config: searxng, updateConfig: updateSearxng } = useSearch();
  const pct = scale;
  const [eid, se] = useState<string | null>(null);
  const [pExp, spE] = useState(false); const [mExp, smE] = useState(false);
  // const [pcm, spcm] = useState<Record<string, boolean>>({});
  const [lp, slp] = useState(""); const [lc, slc] = useState(""); const [lm, slm] = useState<{ t: "ok" | "err"; text: string } | null>(null);
  const [cm, scm] = useState(false); const [cop, scop] = useState(""); const [cnp, scnp] = useState(""); const [ccp, sccp] = useState("");
  const [cdp, scdp] = useState<string | null>(null);
  useEffect(() => { getConfigDir().then(scdp); }, []);

  // ── Cookie 管理 ──
  const [cookieInfo, setCookieInfo] = useState<{ count: number; domains: string[]; updated_at: string } | null>(null);
  const [cookieMsg, setCookieMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const loadCookieInfo = useCallback(async () => {
    try {
      const info = await invoke<{ count: number; domains: string[]; updated_at: string }>("get_cookie_info");
      setCookieInfo(info);
    } catch { setCookieInfo(null); }
  }, []);
  const clearCookies = useCallback(async () => {
    if (!confirm(t("cookieClearConfirm"))) return;
    try {
      await invoke("clear_search_cookies");
      setCookieInfo({ count: 0, domains: [], updated_at: "" });
      setCookieMsg({ type: "ok", text: t("cookieCleared") });
    } catch (e) {
      setCookieMsg({ type: "err", text: String(e) });
    }
  }, [t]);
  useEffect(() => { loadCookieInfo(); }, [loadCookieInfo]);
  const [recOpen, setRecOpen] = useState<string | null>(null);
  const recRef = useRef<HTMLDivElement | null>(null);
  // 点击外部关闭推荐配置下拉菜单
  useEffect(() => {
    if (!recOpen) return;
    const handler = (e: MouseEvent) => {
      if (recRef.current && !recRef.current.contains(e.target as Node)) setRecOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [recOpen]);
  // 解析路径为绝对路径
  const [absPath, setAbsPath] = useState("");
  useEffect(() => {
    if (!sessionPath) { setAbsPath(""); return; }
    // Tauri resolve 可以将相对路径转为绝对路径
    import("@tauri-apps/api/path").then(({ resolve }) => {
      resolve(sessionPath).then(setAbsPath).catch(() => setAbsPath(sessionPath));
    }).catch(() => setAbsPath(sessionPath));
  }, [sessionPath]);
  const clm = useCallback(() => slm(null), []);

  const hdl = useCallback(async () => { const pw = prompt(t("lockCurrentPassword")); if (!pw) return; (await clearPassword(pw)) ? (slm({ t: "ok", text: t("lockClearSuccess") }), scm(false), scop(""), scnp(""), sccp("")) : slm({ t: "err", text: t("lockWrongPassword") }); }, [clearPassword, t]);
  const hsp = useCallback(async () => { if (!lp) { slm({ t: "err", text: t("lockPasswordEmpty") }); return; } if (lp !== lc) { slm({ t: "err", text: t("lockPasswordMismatch") }); return; } (await setPassword(lp)) ? (slm({ t: "ok", text: t("lockSetSuccess") }), slp(""), slc("")) : slm({ t: "err", text: t("lockWrongPassword") }); }, [lp, lc, setPassword, t]);
  const hcp = useCallback(async () => { if (!cnp) { slm({ t: "err", text: t("lockPasswordEmpty") }); return; } if (cnp !== ccp) { slm({ t: "err", text: t("lockPasswordMismatch") }); return; } (await changePassword(cop, cnp)) ? (slm({ t: "ok", text: t("lockChangeSuccess") }), scop(""), scnp(""), sccp(""), scm(false)) : slm({ t: "err", text: t("lockWrongPassword") }); }, [cop, cnp, ccp, changePassword, t]);
  const ad = useCallback((mid: string, key: string) => {
    const preset = DR_PRESETS[key];
    if (!preset) return;
    updateModel(mid, { modelName: preset.mn, baseUrl: preset.bu, params: { ...preset.p } as ModelParams });
    setRecOpen(null);
  }, [updateModel]);

  const [modalMsg, setModalMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const y = yolo;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column", animation: "settings-fade-in 0.2s ease" }}>
      <style>{`
        @keyframes settings-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes settings-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {y && <AuroraBackground />}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, backgroundColor: y ? "rgba(8,8,12,0.55)" : "var(--c-bg)", backdropFilter: y ? "blur(20px)" : undefined, WebkitBackdropFilter: y ? "blur(20px)" : undefined }} />
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", animation: y ? "settings-slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1)" : undefined }}>
      <div data-tauri-drag-region style={{
        display: "flex", alignItems: "center", gap: "14px",
        padding: "18px 32px",
        borderBottom: `1px solid ${y ? YB.bborder : C.border}`,
        flexShrink: 0,
        ...(y ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", backgroundColor: YB.bg } : {}),
      }}>
        <button onClick={onBack} title={t("back")}
          style={{
            width: "34px", height: "34px", borderRadius: "8px",
            border: `1px solid ${y ? YB.b2 : C.border}`,
            background: y ? YB.b3 : C.bg,
            color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.color = C.txt; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = y ? YB.b2 : C.border; e.currentTarget.style.color = C.t3; }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div><div style={{ fontSize: "17px", fontWeight: 700, color: C.txt, lineHeight: 1.6 }}>{t("settingsTitle")}</div><div style={{ fontSize: "12px", color: C.t4, marginTop: "2px" }}>Unicoda</div></div>
      </div>

      <div style={{
        flex: 1, overflowY: "auto", padding: "0 0 48px",
        ...(y ? {
          backgroundColor: "rgba(10,10,18,0.15)",
        } : {}),
      }}>
        {/* ── 用户 ── */}
        <SE yolo={y} title={t("userSection")} desc={t("userSectionDesc")}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Avatar on the left */}
            <label style={{ cursor: "pointer", flexShrink: 0 }}>
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string;
                    if (dataUrl) setUserAvatar(dataUrl);
                  };
                  reader.readAsDataURL(file);
                }} />
              <div style={{ width: "56px", height: "56px", borderRadius: "50%", overflow: "hidden", border: `2px dashed ${userAvatar ? C.ac : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color 0.15s", background: "transparent" }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = C.ac}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = userAvatar ? C.ac : C.border}>
                {userAvatar ? (
                  <img src={userAvatar} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                )}
              </div>
            </label>
            {/* Username + actions on the right */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
              <input value={userName} onChange={(e) => setUserName(e.target.value)} style={is} placeholder={t("userNamePlaceholder")} />
              <div style={{ display: "flex", gap: "8px" }}>
                <label style={{ flex: 1, padding: "8px 0", borderRadius: "6px", border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: "12px", fontWeight: 500, cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const dataUrl = ev.target?.result as string;
                        if (dataUrl) setUserAvatar(dataUrl);
                      };
                      reader.readAsDataURL(file);
                    }} />
                  {t("browse")}
                </label>
                {userAvatar && (
                  <button onClick={() => setUserAvatar("")}
                    style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "12px", fontWeight: 500, cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; }}>
                    {t("removeAvatar")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        {/* ── 界面 ── */}
        <SE yolo={y} title={t("interfaceSection")} desc={t("interfaceSectionDesc")}>
          <div style={{ marginBottom: "28px" }}>
            <div style={fl}>{t("uiLanguage")}</div>
            <div style={{ position: "relative" }}>
              <select value={locale} onChange={(e) => setLocale(e.target.value as "zh-CN" | "en-US")} style={ss}>{/*...*/}
                <option value="zh-CN">汉语 (Chinese, China)</option><option value="en-US">英语 (English, United States)</option>
              </select>{sc}
            </div>
          </div>
          <div style={{ marginBottom: "28px" }}>
            <div style={fl}>{t("uiFont")}</div>
            <div style={{ position: "relative" }}>
              <select value={selectedFontName} onChange={(e) => setSelectedFont(e.target.value)} style={{ ...ss, fontFamily: `"${selectedFontName}", inherit` }}>{fontOptions.map((o: any) => (<option key={o.name} value={o.name} style={{ fontFamily: `"${o.name}", inherit` }}>{o.label}</option>))}</select>{sc}
            </div>
          </div>
          <div style={{ marginBottom: "28px" }}>
            <div style={fl}>{t("theme")}</div>
            <div style={{ position: "relative", opacity: y ? 0.35 : 1, pointerEvents: y ? "none" : "auto", transition: "opacity 0.2s" }}>
              <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")} style={ss}>
                <option value="dark">{t("themeDark")}</option>
                <option value="light">{t("themeLight")}</option>
              </select>
              {sc}
            </div>
            {y && <div style={{ fontSize: "11px", color: C.t4, marginTop: "6px", lineHeight: 1.6, fontStyle: "italic" }}>{t("themeDisabledInYolo")}</div>}
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", lineHeight: 1.6 }}>
              <span style={fl}>{t("scale")}</span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: C.ac, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
            </div>
            <input type="range" min="100" max="150" step="5" value={scale} onChange={(e) => setScale(parseFloat(e.target.value))}
              style={{ width: "100%", height: "4px", appearance: "none", background: `linear-gradient(to right, ${C.ac} ${(scale - 100) / 50 * 100}%, ${C.border} ${(scale - 100) / 50 * 100}%)`, borderRadius: "2px", outline: "none", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.t4, marginTop: "6px", lineHeight: 1.6 }}><span>100%</span><span>125%</span><span>150%</span></div>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("privacyService")} desc={t("privacyDesc")}>
          <div onClick={() => spE((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", cursor: "pointer", userSelect: "none", borderRadius: "8px", border: `1px solid ${C.border}`, lineHeight: 1.6, transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span style={{ fontSize: "14px", fontWeight: 500, color: C.t2 }}>{t("privacyEnable")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" style={{ transition: "transform 0.25s ease", transform: pExp ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
              <SW on={privacyEnabled} oc={(e) => { e.stopPropagation(); setPrivacyEnabled(!privacyEnabled); }} />
            </div>
          </div>

          <AnimatedSection visible={pExp} maxHeight={1200}>
            <div style={{ opacity: privacyEnabled ? 1 : 0.35, pointerEvents: privacyEnabled ? "auto" : "none", transition: "opacity 0.25s ease", paddingTop: "24px" }}>
              <div style={{ padding: "14px 16px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", fontSize: "12px", color: "#f87171", lineHeight: 1.8, marginBottom: "24px" }}>
                <div style={{ fontWeight: 600, marginBottom: "6px" }}>⚠ {t("privacyWarningTitle")}</div>{t("privacyWarning")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg, fontSize: "13px", color: C.t2, marginBottom: "28px", lineHeight: 1.6 }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: privacyEnabled ? "#22c55e" : "#5a5a5e", flexShrink: 0 }} />
                {privacyEnabled ? t("privacyEnabled") : t("privacyDisabled")}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", lineHeight: 1.6 }}>
                  <span style={{ fontSize: "14px", color: C.t2, fontWeight: 600 }}>{t("lockService")}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: hasPassword ? "#22c55e" : "var(--c-t4)", flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: hasPassword ? "#22c55e" : "var(--c-t3)" }}>{hasPassword ? t("lockEnabled") : t("lockDisabled")}</span>
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, marginBottom: "24px" }}>{t("lockDesc")}</div>
                <div style={{ padding: "12px 14px", borderRadius: "8px", border: "rgba(234,179,8,0.3)", background: "rgba(234,179,8,0.06)", fontSize: "12px", color: "#ca8a04", lineHeight: 1.8, marginBottom: "24px" }}>
                  ⚠ {t("lockWarning")}
                  {cdp && <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--c-t2)", wordBreak: "break-all" }}>{cdp}</div>}
                </div>
                {lm && (<div style={{ padding: "10px 12px", borderRadius: "6px", fontSize: "12px", marginBottom: "20px", lineHeight: 1.6, color: lm.t === "ok" ? "#22c55e" : "#ef4444", background: lm.t === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", cursor: "pointer" }} onClick={clm}>{lm.text}</div>)}
                {!hasPassword && (<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div><div style={fl}>{t("lockNewPassword")}</div><input type="password" value={lp} onChange={(e) => slp(e.target.value)} placeholder={t("lockNewPassword")} style={is} /></div>
                  <div><div style={fl}>{t("lockConfirmPassword")}</div><input type="password" value={lc} onChange={(e) => slc(e.target.value)} placeholder={t("lockConfirmPassword")} style={is} /></div>
                  <button onClick={hsp} style={{ width: "100%", padding: "12px 0", borderRadius: "8px", border: "none", background: C.ac, color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "background 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.ah; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.ac; }}>{t("lockSetPassword")}</button>
                </div>)}
                {hasPassword && (<div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  <div style={{ padding: "14px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div><div style={{ fontWeight: 600, color: C.t2, fontSize: "13px", marginBottom: "4px" }}>{t("lockStartupLock")}</div><div style={{ fontSize: "11px", color: C.t3, lineHeight: 1.6 }}>{t("lockStartupLockDesc")}</div></div>
                      <SW on={startupLockEnabled} oc={() => setStartupLockEnabled(!startupLockEnabled)} />
                    </div>
                  </div>
                  <div style={{ padding: "14px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg }}>
                    <div style={{ fontWeight: 600, color: C.t2, fontSize: "13px", marginBottom: "10px" }}>{t("lockIdleTimeout")}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "12px", color: C.t3 }}>{t("lockIdleTimeoutLabel")}</span>
                      <select value={idleTimeout} onChange={(e) => setIdleTimeout(parseInt(e.target.value))}
                        style={{ padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "var(--c-bg2)", color: C.txt, fontSize: "12px", fontFamily: "inherit", outline: "none", cursor: "pointer", appearance: "none", WebkitAppearance: "none" }}>
                        {TO.map((tm) => (<option key={tm} value={tm}>{locale === "zh-CN" ? `${tm} 分钟` : `${tm} minute${tm > 1 ? "s" : ""}`}</option>))}
                      </select>
                      {locale === "en-US" && <span style={{ fontSize: "12px", color: C.t3 }}>{t("lockIdleTimeoutUnit")}</span>}
                    </div>
                  </div>
                  {!cm && (<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button onClick={() => scm(true)} style={{ width: "100%", padding: "11px 0", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>{t("lockChangePassword")}</button>
                    <button onClick={hdl} style={{ width: "100%", padding: "11px 0", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; }}>{t("delete")} {t("lockService")}</button>
                  </div>)}
                  {cm && (<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div><div style={fl}>{t("lockCurrentPassword")}</div><input type="password" value={cop} onChange={(e) => scop(e.target.value)} placeholder={t("lockCurrentPassword")} style={is} /></div>
                    <div><div style={fl}>{t("lockNewPassword")}</div><input type="password" value={cnp} onChange={(e) => scnp(e.target.value)} placeholder={t("lockNewPassword")} style={is} /></div>
                    <div><div style={fl}>{t("lockConfirmPassword")}</div><input type="password" value={ccp} onChange={(e) => sccp(e.target.value)} placeholder={t("lockConfirmPassword")} style={is} /></div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button onClick={hcp} style={{ flex: 1, padding: "12px 0", borderRadius: "8px", border: "none", background: C.ac, color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "background 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = C.ah; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.ac; }}>{t("lockChangePassword")}</button>
                      <button onClick={() => { scm(false); scop(""); scnp(""); sccp(""); slm(null); }}
                        style={{ padding: "11px 20px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: C.t3, fontSize: "13px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>{t("back")}</button>
                    </div>
                  </div>)}
                  <div style={{ fontSize: "11px", color: C.t4, lineHeight: 1.6 }}>{t("lockShortcutHint")}</div>
                </div>)}
                {!hasPassword && <div style={{ fontSize: "12px", color: C.t3, marginTop: "16px", fontStyle: "italic", lineHeight: 1.6 }}>{t("privacyUnavailable")}</div>}
              </div>
            </div>
          </AnimatedSection>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("sessionStorage")}>
          <div>
            <div style={fl}>{t("sessionPath")}</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input id="session-path-input" value={sessionPath} onChange={(e) => setSessionPath(e.target.value)} style={{ ...is, flex: 1 }} placeholder={t("sessionPathPlaceholder")} />
              <button onClick={async () => {
                try {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const selected: string | null = await open({ directory: true, multiple: false, title: "Select Session Folder" });
                  if (selected) {
                    setSessionPath(selected);
                    return;
                  }
                } catch {
                  // Tauri 对话框不可用时，提示用户手动输入完整路径
                  document.getElementById("session-path-input")?.focus();
                }
              }} title={t("browse")}
                style={{ padding: "11px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg, color: C.t2, fontSize: "13px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, flexShrink: 0, transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><polyline points="12 11 12 17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
              </button>
            </div>
            <div style={{ fontSize: "11px", marginTop: "8px", lineHeight: 1.6, wordBreak: "break-all", color: sessionPath ? C.t3 : "#ef4444" }}>
              {t("currentSessionPath")}: {sessionPath ? (absPath || sessionPath) : <span style={{ color: "#ef4444" }}>{t("sessionPathNotSet")}</span>}
              {sessionPath && absPath && absPath !== sessionPath && (
                <span style={{ marginLeft: "6px", fontSize: "10px", color: "#22c55e" }}>✓</span>
              )}
            </div>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("defaultMarkdown")}>
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={fl}>{t("defaultMarkdown")}</span>
              <SW on={defaultMarkdown} oc={() => setDefaultMarkdown(!defaultMarkdown)} />
            </div>
            <div style={{ fontSize: "11px", color: C.t4, marginTop: "6px", lineHeight: 1.6 }}>{t("defaultReasoningOpen")}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "24px" }}>
              <span style={fl}>{t("defaultReasoningOpen")}</span>
              <SW on={defaultReasoningOpen} oc={() => setDefaultReasoningOpen(!defaultReasoningOpen)} />
            </div>
          </div>
          <button onClick={() => { if (confirm(t("resetSettingsConfirm"))) { resetSettings(); setModalMsg("✅ " + t("resetSettingsDone")); } }}
            style={{ width: "100%", padding: "12px 0", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; }}>
            {t("resetSettings")}
          </button>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("developerMode")} desc={t("developerModeDesc")}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.6 }}>{t("developerModeToggle")}</div>
              <div style={{ fontSize: "11px", color: "#f59e0b", marginTop: "6px", lineHeight: 1.6 }}>⚠ {t("developerModeWarning")}</div>
            </div>
            <SW on={developerMode} oc={() => setDeveloperMode(!developerMode)} />
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("cookieManagement")} desc={t("cookieManagementDesc")}>
          {cookieMsg && (
            <div
              onClick={() => setCookieMsg(null)}
              style={{
                padding: "10px 12px", borderRadius: "6px", fontSize: "12px", marginBottom: "16px", lineHeight: 1.6, cursor: "pointer",
                color: cookieMsg.type === "ok" ? "#22c55e" : "#ef4444",
                background: cookieMsg.type === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              }}
            >{cookieMsg.text}</div>
          )}
          <div style={{ marginBottom: "20px" }}>
            {cookieInfo && cookieInfo.count > 0 ? (
              <div>
                <div style={{ fontSize: "12px", color: C.t2, lineHeight: 1.8 }}>
                  {t("cookieCount").replace("{0}", String(cookieInfo.count)).replace("{1}", cookieInfo.domains.join(", "))}
                </div>
                <div style={{ fontSize: "11px", color: C.t4, lineHeight: 1.6, marginTop: "4px" }}>
                  {t("cookieUpdated")}: {cookieInfo.updated_at}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.6 }}>{t("cookieNoData")}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={clearCookies}
              style={{
                flex: 1, padding: "12px 0", borderRadius: "8px",
                border: cookieInfo && cookieInfo.count > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--c-bd)",
                background: "transparent",
                color: cookieInfo && cookieInfo.count > 0 ? "#f87171" : "var(--c-t4)",
                fontSize: "13px", fontWeight: 600, cursor: cookieInfo && cookieInfo.count > 0 ? "pointer" : "default",
                fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (cookieInfo && cookieInfo.count > 0) { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; } }}
              onMouseLeave={(e) => { if (cookieInfo && cookieInfo.count > 0) { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; } }}
              disabled={!cookieInfo || cookieInfo.count === 0}
            >{t("cookieClear")}</button>
            <button onClick={loadCookieInfo}
              style={{
                padding: "12px 16px", borderRadius: "8px", border: `1px solid ${C.border}`,
                background: "transparent", color: C.t2, fontSize: "13px", fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title="SearXNG 搜索服务" desc={`使用自建 SearXNG 实例进行联网搜索。
SearXNG 需配置有效的实例地址，您可以通过 Docker Desktop 快速启动：
  docker run -d --name searxng -p 8888:8080 searxng/searxng
或使用 WSL2 内的 Docker：
  wsl docker run -d --name searxng -p 8888:8080 searxng/searxng`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
            <span style={fl}>启用 SearXNG</span>
            <SW on={searxng.enabled} oc={() => updateSearxng({ enabled: !searxng.enabled })} />
          </div>
          <div style={{ marginBottom: "24px" }}>
            <div style={fl}>实例地址</div>
            <input
              value={searxng.baseUrl}
              onChange={(e) => updateSearxng({ baseUrl: e.target.value })}
              style={{ ...is, fontFamily: "monospace" }}
              placeholder="http://127.0.0.1:8888"
            />
            <div style={{ fontSize: "11px", color: C.t4, marginTop: "6px", lineHeight: 1.6 }}>
              输入你的 SearXNG 实例地址，如 http://127.0.0.1:8888
            </div>
          </div>
          <div style={{ marginBottom: "24px" }}>
            <div style={fl}>搜索分类</div>
            <input
              value={searxng.categories}
              onChange={(e) => updateSearxng({ categories: e.target.value })}
              style={is}
              placeholder="general,news"
            />
            <div style={{ fontSize: "11px", color: C.t4, marginTop: "6px", lineHeight: 1.6 }}>
              逗号分隔，可选：general, news, images, videos, files, music, social, it
            </div>
          </div>
          <div style={{ marginBottom: "24px" }}>
            <div style={fl}>搜索语言</div>
            <div style={{ position: "relative" }}>
              <select
                value={searxng.language}
                onChange={(e) => updateSearxng({ language: e.target.value })}
                style={ss}
              >
                <option value="all">all（不限）</option>
                <option value="zh-CN">zh-CN（中文）</option>
                <option value="en-US">en-US（英文）</option>
                <option value="ja-JP">ja-JP（日文）</option>
              </select>{sc}
            </div>
          </div>
          <div style={{ marginBottom: "24px" }}>
            <div style={fl}>安全搜索</div>
            <div style={{ position: "relative" }}>
              <select
                value={String(searxng.safeSearch)}
                onChange={(e) => updateSearxng({ safeSearch: parseInt(e.target.value) })}
                style={ss}
              >
                <option value="0">0 - 关闭</option>
                <option value="1">1 - 中等</option>
                <option value="2">2 - 严格</option>
              </select>{sc}
            </div>
          </div>
          <div style={{ marginTop: "12px" }}>
            <button disabled={testing} onClick={async () => {
              if (!searxng.baseUrl) { setModalMsg("请先输入 SearXNG 实例地址"); return; }
              setTesting(true);
              try {
                const url = `${searxng.baseUrl.replace(/\/+$/, "")}/search?q=test&format=json&pageno=1`;
                const resp = await invoke<string>("http_fetch", {
                  url,
                  userAgent: "Unicoda/1.0",
                  timeoutMs: 10000,
                  noProxy: true,
                  acceptHeader: "application/json",
                });
                const data = JSON.parse(resp);
                if (data && Array.isArray(data.results)) {
                  setModalMsg(`✅ 连接成功！实例返回了 ${data.results.length} 条搜索结果。\n\n现在可以启用 SearXNG 进行联网搜索了。`);
                } else {
                  setModalMsg("⚠️ 响应格式异常\n\nSearXNG 返回了非预期的 JSON 结构。请检查实例配置是否正确。");
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const lowMsg = msg.toLowerCase();
                let hint = "";
                if (lowMsg.includes("refused") || lowMsg.includes("connection refused")) {
                  hint = "\n\n📋 诊断：连接被拒绝\n\nSearXNG 实例未启动，或地址/端口不正确。\n\nWindows 下快速启动（需安装 Docker Desktop）：\n  docker run -d --name searxng -p 8888:8080 searxng/searxng\n\n或使用 WSL2 中的 Docker：\n  wsl docker run -d --name searxng -p 8888:8080 searxng/searxng\n\n然后浏览器打开 http://localhost:8888 确认可正常访问。";
                } else if (lowMsg.includes("timeout")) {
                  hint = "\n\n📋 诊断：连接超时\n\n实例地址不可达，请检查：\n• 实例是否已启动\n• 防火墙是否允许 8888 端口\n• 如果使用远程 IP，确认网络互通";
                } else if (lowMsg.includes("dns") || lowMsg.includes("dns")) {
                  hint = "\n\n📋 诊断：DNS 解析失败\n\n域名无法解析，请检查地址拼写或改用 IP 地址。";
                } else if (lowMsg.includes("tls") || lowMsg.includes("ssl") || lowMsg.includes("certificate")) {
                  hint = "\n\n📋 诊断：TLS/SSL 证书错误\n\nHTTPS 证书验证失败。如果使用自签名证书，可在 SearXNG 中关闭 HTTPS 改用 HTTP。";
                } else {
                  hint = `\n\n📋 诊断：\n${msg}\n\n💡 检查要点：\n1. 请用 PowerShell 验证：Invoke-RestMethod -Uri "http://localhost:8888/search?q=test&format=json" -Headers @{"Accept"="application/json"}\n2. 如果 PowerShell 能访问但应用不行，请关闭代理后重启 Unicoda\n3. 尝试 'cargo clean' 后重建：cargo clean && npm run tauri dev`;
                }
                setModalMsg(`❌ 连接失败\n${hint}`);
              } finally {
                setTesting(false);
              }
            }}
              style={{ width: "100%", padding: "12px 0", borderRadius: "8px", border: `1px solid ${testing ? C.t4 : C.border}`, background: testing ? C.bg : C.bg, color: testing ? C.t4 : C.t2, fontSize: "13px", fontWeight: 600, cursor: testing ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
              onMouseEnter={(e) => { if (!testing) { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; } }}
              onMouseLeave={(e) => { if (!testing) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg; } }}>
              {testing ? "⏳ 测试中..." : "🔗 测试连接"}
            </button>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("modelService")}>
          <div onClick={() => smE((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", cursor: "pointer", userSelect: "none", borderRadius: "8px", border: `1px solid ${C.border}`, lineHeight: 1.6, transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "var(--c-bg3)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.8"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /></svg>
              <span style={{ fontSize: "14px", fontWeight: 500, color: C.t2 }}>{t("modelService")}</span>
              {models.length > 0 && <span style={{ fontSize: "11px", color: C.t4, background: C.bg, padding: "2px 8px", borderRadius: "4px" }}>{models.length}</span>}
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" style={{ transition: "transform 0.25s ease", transform: mExp ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
          </div>

          <AnimatedSection visible={mExp} maxHeight={2000}>
            <div style={{ paddingTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <button onClick={addModel} title={t("addModel")}
                style={{ width: "100%", padding: "11px 0", borderRadius: "8px", border: "1px dashed var(--c-bd2)", background: "transparent", color: "var(--c-t6)", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.borderColor = "var(--c-t4)"; e.currentTarget.style.color = "var(--c-txt)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "var(--c-bd2)"; e.currentTarget.style.color = "var(--c-t6)"; }}>+ {t("addModel")}</button>
              {models.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", color: "#5a5a5e", fontSize: "13px", lineHeight: 1.6 }}>{t("noModels")}</div>}
              {models.map((model) => (
                <div key={model.id}>
                  <div onClick={() => se(eid === model.id ? null : model.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, cursor: "pointer", userSelect: "none", lineHeight: 1.6, transition: "border-color 0.15s, background 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                      <div onClick={(ev) => { ev.stopPropagation(); setSelectedModelId(model.id); }}
                        style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${selectedModelId === model.id ? C.ac : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        {selectedModelId === model.id && <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: C.ac }} />}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: C.txt, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                          <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(37,99,235,0.12)", color: "#60a5fa", lineHeight: 1.6 }}>{model.provider}</span>
                          {model.modelName && <span style={{ fontSize: "11px", color: C.t4, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.modelName}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                      <button onClick={(ev) => { ev.stopPropagation(); removeModel(model.id); }}
                        style={{ width: "26px", height: "26px", borderRadius: "6px", border: "none", background: "transparent", color: "var(--c-t4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s" }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--c-t4)"}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" style={{ transition: "transform 0.25s ease", transform: eid === model.id ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>
                  <AnimatedSection visible={eid === model.id} maxHeight={1200}>
                    <div style={{ padding: "20px 0 0 18px", display: "flex", flexDirection: "column", gap: "18px" }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: C.t2, lineHeight: 1.6 }}>{t("basicSettings")}</div>
                      <div>
                        <div style={fl}>{t("modelName")}</div>
                        <input value={model.name} onChange={(e) => updateModel(model.id, { name: e.target.value })} style={is} />
                      </div>
                      <div>
                        <div style={fl}>{t("provider")}</div>
                        <div style={{ position: "relative" }}>
                          <select value={model.provider} onChange={(e) => updateModel(model.id, { provider: e.target.value })} style={ss}>
                            <option value="Custom">{t("custom")}</option>
                            {PP.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>{sc}
                        </div>
                      </div>
                      <div>
                        <div style={fl}>Model ID</div>
                        <input value={model.modelName} onChange={(e) => updateModel(model.id, { modelName: e.target.value })} style={is} placeholder="e.g. deepseek-chat" />
                      </div>
                      <div>
                        <div style={fl}>API Key</div>
                        <input type="password" value={model.apiKey} onChange={(e) => updateModel(model.id, { apiKey: e.target.value })} style={is} placeholder="sk-..." />
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <span style={fl}>{t("baseUrl")}</span>
                          {model.provider?.toLowerCase() === "deepseek" && (
                            <div ref={recRef} style={{ position: "relative" }}>
                              <button onClick={() => setRecOpen(recOpen === model.id ? null : model.id)}
                                style={{ padding: "5px 10px", borderRadius: "5px", border: `1px solid rgba(37,99,235,0.3)`, background: recOpen === model.id ? "rgba(37,99,235,0.15)" : "rgba(37,99,235,0.08)", color: "#60a5fa", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s", display: "flex", alignItems: "center", gap: "4px" }}
                                onMouseEnter={(e) => { if (recOpen !== model.id) { e.currentTarget.style.background = "rgba(37,99,235,0.15)"; e.currentTarget.style.borderColor = "rgba(37,99,235,0.5)"; } }}
                                onMouseLeave={(e) => { if (recOpen !== model.id) { e.currentTarget.style.background = "rgba(37,99,235,0.08)"; e.currentTarget.style.borderColor = "rgba(37,99,235,0.3)"; } }}>
                                {t("recommendConfig")}
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transition: "transform 0.2s", transform: recOpen === model.id ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9" /></svg>
                              </button>
                              {recOpen === model.id && (
                                <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 100, minWidth: "220px", background: "var(--c-bg3)", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "4px", boxShadow: "0 6px 20px rgba(0,0,0,0.4)", overflow: "hidden" }}>
                                  {Object.entries(DR_PRESETS).map(([key, preset]) => (
                                    <div key={key} onClick={() => { ad(model.id, key); }}
                                      style={{ padding: "10px 12px", borderRadius: "6px", cursor: "pointer", transition: "background 0.12s", lineHeight: 1.6 }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-bd)"}
                                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                      <div style={{ fontSize: "13px", fontWeight: 600, color: C.txt }}>{preset.label}</div>
                                      <div style={{ fontSize: "11px", color: C.t4, marginTop: "2px" }}>{preset.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <input value={model.baseUrl} onChange={(e) => updateModel(model.id, { baseUrl: e.target.value })} style={is} placeholder="https://api.deepseek.com/v1" />
                      </div>
                      <div>
                        <div style={fl}>{t("systemPrompt")}</div>
                        <textarea value={model.systemPrompt ?? ""} onChange={(e) => updateModel(model.id, { systemPrompt: e.target.value })}
                          rows={3} style={{ ...is, resize: "vertical", minHeight: "60px", lineHeight: 1.6, fontFamily: "inherit" }} />
                      </div>
                      <div style={{ height: "1px", background: C.border, margin: "4px 0" }} />
                      <div style={{ fontSize: "14px", fontWeight: 600, color: C.t2, lineHeight: 1.6, marginBottom: "4px" }}>{t("advParams")}</div>
                      <RS label="Temperature" val={model.params.temperature} min={0} max={2} step={0.1}
                        oc={(v) => updateModel(model.id, { params: { ...model.params, temperature: v } })}
                        dv={model.params.temperature.toFixed(1)} />
                      <RS label="Max Tokens" val={model.params.maxTokens} min={1} max={384000} step={1}
                        oc={(v) => updateModel(model.id, { params: { ...model.params, maxTokens: v } })}
                        dv={String(model.params.maxTokens)} />
                      <RS label="Top P" val={model.params.topP} min={0} max={1} step={0.05}
                        oc={(v) => updateModel(model.id, { params: { ...model.params, topP: v } })}
                        dv={model.params.topP.toFixed(2)} />
                      <div style={{ opacity: model.provider?.toLowerCase() === "deepseek" ? 0.5 : 1, pointerEvents: model.provider?.toLowerCase() === "deepseek" ? "none" : "auto" }}>
                        <RS label={t("frequencyPenalty")} val={model.params.frequencyPenalty ?? 0} min={-2} max={2} step={0.1}
                          oc={(v) => updateModel(model.id, { params: { ...model.params, frequencyPenalty: v } })}
                          dv={(model.params.frequencyPenalty ?? 0).toFixed(1)} />
                        {model.provider?.toLowerCase() === "deepseek" && <div style={{ fontSize: "11px", color: "var(--c-t2)", marginTop: "-14px", marginBottom: "16px", fontStyle: "italic" }}>⚠ {t("frequencyPenalty")} 已废弃，DeepSeek 不再生效</div>}
                      </div>
                      <div style={{ opacity: model.provider?.toLowerCase() === "deepseek" ? 0.5 : 1, pointerEvents: model.provider?.toLowerCase() === "deepseek" ? "none" : "auto" }}>
                        <RS label={t("presencePenalty")} val={model.params.presencePenalty ?? 0} min={-2} max={2} step={0.1}
                          oc={(v) => updateModel(model.id, { params: { ...model.params, presencePenalty: v } })}
                          dv={(model.params.presencePenalty ?? 0).toFixed(1)} />
                        {model.provider?.toLowerCase() === "deepseek" && <div style={{ fontSize: "11px", color: "var(--c-t2)", marginTop: "-14px", marginBottom: "16px", fontStyle: "italic" }}>⚠ {t("presencePenalty")} 已废弃，DeepSeek 不再生效</div>}
                      </div>
                      <div style={{ height: "1px", background: C.border, margin: "8px 0" }} />
                      <div style={{ fontSize: "14px", fontWeight: 600, color: C.t2, lineHeight: 1.6, marginBottom: "8px" }}>文件上传</div>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "6px", fontSize: "13px", color: C.t2, userSelect: "none" }}>
                        <input type="checkbox" checked={!!model.params.allowFileUpload}
                          onChange={(e) => updateModel(model.id, { params: { ...model.params, allowFileUpload: e.target.checked } })}
                          style={{ accentColor: "#3b82f6", width: "14px", height: "14px", cursor: "pointer" }} />
                        {t("allowFileUpload")}
                      </label>

                    </div>
                  </AnimatedSection>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE yolo={y} title={t("disclaimerTitle")}>
          <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>• {t("disclaimerFee")}</div>
            <div>• {t("disclaimerSecurity")}</div>
            <div>• {t("disclaimerLegal")}</div>
            <div>• {t("disclaimerNeutral")}</div>
          </div>
        </SE>
      </div>
      <AlertModal msg={modalMsg} onClose={() => setModalMsg(null)} />
    </div>
    </div>
  );
}