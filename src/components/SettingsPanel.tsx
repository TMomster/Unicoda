import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import { useLock } from "../contexts/LockContext";
import { getConfigDir } from "../utils/configStorage";
import { invoke } from "@tauri-apps/api/core";
import AnimatedSection from "./AnimatedSection";
import type { ModelParams } from "../types";

interface Props { onBack: () => void; }
const TO = [1, 3, 5, 10, 15, 30] as const;
const C = { bg: "#0f0f11", border: "#2a2a2e", bf: "#2563eb", txt: "#e0e0e0", t2: "#a0a0a0", t3: "#7a7a7e", t4: "#5a5a5e", ac: "#2563eb", ah: "#1d4ed8" };
const PP = ["Deepseek", "OpenAI", "Anthropic", "Google"];

interface DRPreset { label: string; desc: string; mn: string; bu: string; p: Partial<ModelParams>; }
const DR_PRESETS: Record<string, DRPreset> = {
  chat: { label: "Chat", desc: "deepseek-chat（通用对话，即将废弃）", mn: "deepseek-chat", bu: "https://api.deepseek.com/v1", p: { temperature: 0.7, maxTokens: 128000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 } },
  reasoner: { label: "Reasoner", desc: "deepseek-reasoner（深度推理，即将废弃）", mn: "deepseek-reasoner", bu: "https://api.deepseek.com/v1", p: { temperature: 0.3, maxTokens: 384000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 } },
  flash: { label: "Flash", desc: "deepseek-v4-flash（极速对话，推荐）", mn: "deepseek-v4-flash", bu: "https://api.deepseek.com", p: { temperature: 0.7, maxTokens: 128000, topP: 1 } },
  pro: { label: "Pro", desc: "deepseek-v4-pro（深度思考，推荐）", mn: "deepseek-v4-pro", bu: "https://api.deepseek.com", p: { temperature: 0.3, maxTokens: 384000, topP: 1 } },
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
function SE({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (<div style={{ paddingTop: "32px", paddingBottom: "32px" }}>
    <div style={{ padding: "0 32px" }}>
      <div style={{ fontSize: "16px", fontWeight: 700, color: C.txt, lineHeight: 1.6 }}>{title}</div>
      {desc && <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, marginTop: "6px" }}>{desc}</div>}
    </div>
    <div style={{ padding: "20px 32px 0" }}>{children}</div>
  </div>);
}

export default function SettingsPanel({ onBack }: Props) {
  const { scale, setScale, selectedFontName, setSelectedFont, fontOptions, t, locale, setLocale, sessionPath, setSessionPath, userName, setUserName, userAvatar, setUserAvatar, defaultMarkdown, setDefaultMarkdown, defaultReasoningOpen, setDefaultReasoningOpen, developerMode, setDeveloperMode, resetSettings } = useTheme();
  const { models, selectedModelId, setSelectedModelId, addModel, updateModel, removeModel } = useModels();
  const { hasPassword, privacyEnabled, setPrivacyEnabled, idleTimeout, setIdleTimeout, startupLockEnabled, setStartupLockEnabled, setPassword, changePassword, clearPassword } = useLock();
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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "18px 32px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={onBack} title={t("back")}
          style={{ width: "34px", height: "34px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.bg, color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.color = C.txt; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.t3; }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div><div style={{ fontSize: "17px", fontWeight: 700, color: C.txt, lineHeight: 1.6 }}>{t("settingsTitle")}</div><div style={{ fontSize: "12px", color: C.t4, marginTop: "2px" }}>Unison</div></div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 48px" }}>
        <SE title={t("uiLanguage")}>
          <div style={{ marginBottom: "28px" }}>
            <div style={fl}>{t("userName")}</div>
            <input value={userName} onChange={(e) => setUserName(e.target.value)} style={is} placeholder={t("userNamePlaceholder")} />
          </div>
          <div style={{ marginBottom: "28px" }}>
            <div style={fl}>{t("userAvatar")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", border: `2px dashed ${userAvatar ? C.ac : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color 0.15s", background: "transparent" }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = C.ac}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = userAvatar ? C.ac : C.border}>
                  {userAvatar ? (
                    <img src={userAvatar} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  )}
                </div>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ padding: "8px 14px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s", textAlign: "center" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }}
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
                    style={{ padding: "8px 14px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s", textAlign: "center" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; }}>
                    {t("removeAvatar")}
                  </button>
                )}
              </div>
            </div>
          </div>
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

        <SE title={t("privacyService")} desc={t("privacyDesc")}>
          <div onClick={() => spE((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", cursor: "pointer", userSelect: "none", borderRadius: "8px", border: `1px solid ${C.border}`, lineHeight: 1.6, transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }}
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
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: hasPassword ? "#22c55e" : "#5a5a5e", flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: hasPassword ? "#22c55e" : "#7a7a7e" }}>{hasPassword ? t("lockEnabled") : t("lockDisabled")}</span>
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, marginBottom: "24px" }}>{t("lockDesc")}</div>
                <div style={{ padding: "12px 14px", borderRadius: "8px", border: "rgba(234,179,8,0.3)", background: "rgba(234,179,8,0.06)", fontSize: "12px", color: "#ca8a04", lineHeight: 1.8, marginBottom: "24px" }}>
                  ⚠ {t("lockWarning")}
                  {cdp && <div style={{ marginTop: "6px", fontSize: "11px", color: "#a0a0a0", wordBreak: "break-all" }}>{cdp}</div>}
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
                        style={{ padding: "6px 10px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "#1a1a1e", color: C.txt, fontSize: "12px", fontFamily: "inherit", outline: "none", cursor: "pointer", appearance: "none", WebkitAppearance: "none" }}>
                        {TO.map((tm) => (<option key={tm} value={tm}>{locale === "zh-CN" ? `${tm} 分钟` : `${tm} minute${tm > 1 ? "s" : ""}`}</option>))}
                      </select>
                      {locale === "en-US" && <span style={{ fontSize: "12px", color: C.t3 }}>{t("lockIdleTimeoutUnit")}</span>}
                    </div>
                  </div>
                  {!cm && (<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button onClick={() => scm(true)} style={{ width: "100%", padding: "11px 0", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>{t("lockChangePassword")}</button>
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
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>{t("back")}</button>
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

        <SE title={t("sessionStorage")}>
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
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }}
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

        <SE title={t("defaultMarkdown")}>
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
          <button onClick={() => { if (confirm(t("resetSettingsConfirm"))) { resetSettings(); alert(t("resetSettingsDone")); } }}
            style={{ width: "100%", padding: "12px 0", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.background = "transparent"; }}>
            {t("resetSettings")}
          </button>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE title={t("developerMode")} desc={t("developerModeDesc")}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.6 }}>{t("developerModeToggle")}</div>
              <div style={{ fontSize: "11px", color: "#f59e0b", marginTop: "6px", lineHeight: 1.6 }}>⚠ {t("developerModeWarning")}</div>
            </div>
            <SW on={developerMode} oc={() => setDeveloperMode(!developerMode)} />
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE title={t("cookieManagement")} desc={t("cookieManagementDesc")}>
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
                border: cookieInfo && cookieInfo.count > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid #2a2a2e",
                background: "transparent",
                color: cookieInfo && cookieInfo.count > 0 ? "#f87171" : "#5a5a5e",
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
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE title={t("modelService")}>
          <div onClick={() => smE((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", cursor: "pointer", userSelect: "none", borderRadius: "8px", border: `1px solid ${C.border}`, lineHeight: 1.6, transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.t3; e.currentTarget.style.background = "#141417"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>
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
                style={{ width: "100%", padding: "11px 0", borderRadius: "8px", border: "1px dashed #3a3a3e", background: "transparent", color: "#8a8a8e", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#141417"; e.currentTarget.style.borderColor = "#5a5a5e"; e.currentTarget.style.color = "#c0c0c0"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "#3a3a3e"; e.currentTarget.style.color = "#8a8a8e"; }}>+ {t("addModel")}</button>
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
                        style={{ width: "26px", height: "26px", borderRadius: "6px", border: "none", background: "transparent", color: "#5a5a5e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s" }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"} onMouseLeave={(e) => e.currentTarget.style.color = "#5a5a5e"}>
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
                                <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 100, minWidth: "220px", background: "#1c1c20", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "4px", boxShadow: "0 6px 20px rgba(0,0,0,0.4)", overflow: "hidden" }}>
                                  {Object.entries(DR_PRESETS).map(([key, preset]) => (
                                    <div key={key} onClick={() => { ad(model.id, key); }}
                                      style={{ padding: "10px 12px", borderRadius: "6px", cursor: "pointer", transition: "background 0.12s", lineHeight: 1.6 }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = "#2a2a2e"}
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
                        {model.provider?.toLowerCase() === "deepseek" && <div style={{ fontSize: "11px", color: "#a0a0a0", marginTop: "-14px", marginBottom: "16px", fontStyle: "italic" }}>⚠ {t("frequencyPenalty")} 已废弃，DeepSeek 不再生效</div>}
                      </div>
                      <div style={{ opacity: model.provider?.toLowerCase() === "deepseek" ? 0.5 : 1, pointerEvents: model.provider?.toLowerCase() === "deepseek" ? "none" : "auto" }}>
                        <RS label={t("presencePenalty")} val={model.params.presencePenalty ?? 0} min={-2} max={2} step={0.1}
                          oc={(v) => updateModel(model.id, { params: { ...model.params, presencePenalty: v } })}
                          dv={(model.params.presencePenalty ?? 0).toFixed(1)} />
                        {model.provider?.toLowerCase() === "deepseek" && <div style={{ fontSize: "11px", color: "#a0a0a0", marginTop: "-14px", marginBottom: "16px", fontStyle: "italic" }}>⚠ {t("presencePenalty")} 已废弃，DeepSeek 不再生效</div>}
                      </div>
                    </div>
                  </AnimatedSection>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </SE>
        <hr style={{ height: "1px", backgroundColor: C.border, border: "none", margin: "0" }} />

        <SE title={t("disclaimerTitle")}>
          <div style={{ fontSize: "12px", color: C.t3, lineHeight: 1.8, display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>• {t("disclaimerFee")}</div>
            <div>• {t("disclaimerSecurity")}</div>
            <div>• {t("disclaimerLegal")}</div>
            <div>• {t("disclaimerNeutral")}</div>
          </div>
        </SE>
      </div>
    </div>
  );
}