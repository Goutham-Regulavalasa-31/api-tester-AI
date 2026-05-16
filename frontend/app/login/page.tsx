"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  Eye, EyeOff, Clock, FolderOpen, Globe,
  Shield, FlaskConical, Zap, CheckCircle,
} from "lucide-react";

const API_BASE = "http://localhost:8000";

const FEATURES = [
  {
    icon: Zap,
    label: "Smart test assertions",
    desc: "Validate status codes, headers, and response body automatically",
  },
  {
    icon: FolderOpen,
    label: "Collections & saved requests",
    desc: "Organise requests into folders and replay them in one click",
  },
  {
    icon: Globe,
    label: "Environment variables",
    desc: "Switch between staging and production with a single change",
  },
  {
    icon: Shield,
    label: "Auth helpers",
    desc: "Bearer token, Basic Auth, and API Key — all built in",
  },
  {
    icon: Clock,
    label: "Request history",
    desc: "Every request saved, browsable, and reloadable at any time",
  },
  {
    icon: FlaskConical,
    label: "Response inspection",
    desc: "Status, headers, body, and response time in one view",
  },
];

export default function LoginPage() {
  const router = useRouter();

  const [tab, setTab]                   = useState<"signin" | "signup">("signin");
  const [username, setUsername]         = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  async function submit() {
    if (!username.trim() || !password.trim()) {
      setError("Please enter a username and password");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const endpoint = tab === "signin" ? "/auth/login" : "/auth/register";
      const res = await axios.post(`${API_BASE}${endpoint}`, {
        username: username.trim(),
        password,
      });
      localStorage.setItem("deviq_token",    res.data.access_token);
      localStorage.setItem("deviq_username", res.data.username);
      router.push("/");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "Something went wrong. Is the backend running?"
      );
    } finally {
      setLoading(false);
    }
  }

  function switchTab(t: "signin" | "signup") {
    setTab(t);
    setError("");
  }

  return (
    <div className="min-h-screen flex bg-slate-900">

      {/* ── Left panel: branding + feature list ── */}
      <div className="hidden lg:flex flex-col flex-1 bg-slate-800 border-r border-slate-700/60 px-16 py-14 justify-between">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">DevIQ</span>
        </div>

        {/* Headline */}
        <div className="flex flex-col gap-10">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Developer-first<br />
              <span className="text-blue-400">API Testing</span> Platform
            </h1>
            <p className="mt-4 text-slate-400 text-base leading-relaxed max-w-sm">
              Build, test, and debug APIs faster. Everything you need in
              one clean workspace — no bloat, no distractions.
            </p>
          </div>

          {/* Feature list */}
          <ul className="flex flex-col gap-5">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <li key={label} className="flex items-start gap-4">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-blue-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{label}</span>
                    <CheckCircle size={13} className="text-green-400" />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer note */}
        <p className="text-xs text-slate-600">
          DevIQ v0.7 · All data stored securely in your account
        </p>
      </div>

      {/* ── Right panel: auth card ── */}
      <div className="flex flex-col items-center justify-center w-full lg:w-[460px] shrink-0 p-8">

        {/* Mobile-only logo */}
        <div className="flex items-center gap-2 mb-8 lg:hidden">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">DevIQ</span>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-6">

          {/* Card header */}
          <div>
            <h2 className="text-2xl font-bold text-white">
              {tab === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {tab === "signin"
                ? "Sign in to access your workspace"
                : "Start testing APIs in seconds"}
            </p>
          </div>

          {/* Tab toggle */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-1 gap-1">
            {(["signin", "signup"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="e.g. johndoe"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="bg-slate-800 text-white rounded-xl px-4 py-3 text-sm border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-500 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={tab === "signup" ? "At least 6 characters" : "Your password"}
                  className="w-full bg-slate-800 text-white rounded-xl px-4 py-3 pr-11 text-sm border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="mt-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {loading
                ? (tab === "signin" ? "Signing in…" : "Creating account…")
                : (tab === "signin" ? "Sign In" : "Create Account")
              }
            </button>
          </div>

          <p className="text-xs text-slate-600 text-center">
            {tab === "signin"
              ? "No account yet? Click Sign Up above."
              : "Already have an account? Click Sign In above."}
          </p>

        </div>
      </div>

    </div>
  );
}
