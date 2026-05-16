"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  Send, Plus, Trash2, ChevronDown, ChevronUp,
  Clock, X, FolderOpen, Folder, Save, Eye, EyeOff,
  CheckCircle, XCircle, LogOut, Terminal,
  Layers, Globe, FlaskConical, Sparkles, Settings2,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface Header {
  key: string;
  value: string;
  enabled: boolean;
}

interface EnvVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface AuthConfig {
  type: "none" | "bearer" | "basic" | "apikey";
  token: string;
  username: string;
  password: string;
  apiKeyName: string;
  apiKeyValue: string;
}

interface APIResponse {
  status_code: number;
  headers: Record<string, string>;
  body: string;
  response_time_ms: number;
  success: boolean;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  method: HttpMethod;
  url: string;
  headers: Header[];
  body: string;
  response: APIResponse;
}

interface SavedRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Header[];
  body: string;
  createdAt: number;
}

interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

interface AssertionResult {
  line: string;
  passed: boolean;
  message: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const API_BASE   = "http://localhost:8000";
const MAX_HISTORY = 50;

const DEFAULT_AUTH: AuthConfig = {
  type: "none",
  token: "", username: "", password: "",
  apiKeyName: "X-API-Key", apiKeyValue: "",
};

const ASSERTION_PLACEHOLDER = `# Write one assertion per line. Lines starting with # are ignored.
# Subjects:  status  responseTime  body  body.<path>  header.<name>
# Operators: ==  !=  <  >  <=  >=  exists  contains
#            isString  isNumber  isBoolean  isArray  isNull
#
# Examples:
status == 200
responseTime < 500
body.id isNumber
body.name isString
body.tags isArray
header.content-type contains application/json`;

// ─── Pure helpers ───────────────────────────────────────────────────────────────

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "bg-green-500";
  if (code >= 300 && code < 400) return "bg-yellow-500";
  if (code >= 400 && code < 500) return "bg-orange-500";
  return "bg-red-500";
}

function methodColor(method: HttpMethod): string {
  const map: Record<HttpMethod, string> = {
    GET: "text-green-400", POST: "text-blue-400",
    PUT: "text-yellow-400", PATCH: "text-orange-400", DELETE: "text-red-400",
  };
  return map[method];
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function defaultRequestName(method: HttpMethod, rawUrl: string): string {
  try { return `${method} ${new URL(rawUrl).pathname || "/"}`; }
  catch { return `${method} request`; }
}

function applyEnv(text: string, vars: EnvVariable[]): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars.find((e) => e.enabled && e.key === key);
    return v ? v.value : match;
  });
}

function buildAuthHeader(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case "bearer":
      return auth.token.trim() ? { Authorization: `Bearer ${auth.token.trim()}` } : {};
    case "basic": {
      if (!auth.username.trim()) return {};
      return { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
    }
    case "apikey":
      return auth.apiKeyName.trim() && auth.apiKeyValue.trim()
        ? { [auth.apiKeyName.trim()]: auth.apiKeyValue.trim() }
        : {};
    default:
      return {};
  }
}

// ─── Assertion engine ──────────────────────────────────────────────────────────

function resolveSubject(subject: string, response: APIResponse): { value: unknown; error?: string } {
  if (subject === "status")       return { value: response.status_code };
  if (subject === "responseTime") return { value: response.response_time_ms };
  if (subject === "body")         return { value: response.body };

  if (subject.startsWith("body.")) {
    try {
      const parsed: unknown = JSON.parse(response.body);
      let cur: unknown = parsed;
      for (const key of subject.slice(5).split(".")) {
        if (cur === null || typeof cur !== "object") return { value: undefined };
        cur = (cur as Record<string, unknown>)[key];
      }
      return { value: cur };
    } catch { return { value: undefined, error: "Body is not valid JSON" }; }
  }

  if (subject.startsWith("header.")) {
    const name  = subject.slice(7).toLowerCase();
    const entry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === name);
    return { value: entry?.[1] };
  }

  return { value: undefined, error: `Unknown subject "${subject}"` };
}

function coerceValue(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

function runAssertion(line: string, response: APIResponse): AssertionResult {
  try {
    const tokens   = line.trim().split(/\s+/);
    if (tokens.length < 2) throw new Error("Too few tokens");
    const subject  = tokens[0];
    const operator = tokens[1];
    const rawValue = tokens.slice(2).join(" ");

    const { value: actual, error } = resolveSubject(subject, response);
    if (error) throw new Error(error);

    if (operator === "exists") {
      const passed = actual !== undefined && actual !== null;
      return { line, passed, message: passed ? `${subject} is present` : `${subject} is absent` };
    }

    if (!rawValue) throw new Error(`Operator "${operator}" requires a value`);
    const expected = coerceValue(rawValue);

    switch (operator) {
      case "==": {
        const passed = actual === expected || String(actual) === String(expected);
        return { line, passed, message: passed ? `${JSON.stringify(actual)} == ${JSON.stringify(expected)}` : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
      }
      case "!=": {
        const passed = actual !== expected && String(actual) !== String(expected);
        return { line, passed, message: passed ? `${JSON.stringify(actual)} != ${JSON.stringify(expected)}` : `Expected not ${JSON.stringify(expected)}, but got it` };
      }
      case "<": case ">": case "<=": case ">=": {
        const a = Number(actual), e = Number(expected);
        if (isNaN(a)) throw new Error(`${subject} is not a number`);
        if (isNaN(e)) throw new Error(`${rawValue} is not a number`);
        const passed = operator === "<" ? a < e : operator === ">" ? a > e : operator === "<=" ? a <= e : a >= e;
        return { line, passed, message: passed ? `${a} ${operator} ${e}` : `${a} is not ${operator} ${e}` };
      }
      case "contains": {
        const passed = String(actual ?? "").toLowerCase().includes(rawValue.toLowerCase());
        return { line, passed, message: passed ? `"${actual}" contains "${rawValue}"` : `"${actual}" does not contain "${rawValue}"` };
      }
      case "isString": case "isNumber": case "isBoolean": case "isArray": case "isNull": {
        let checkVal: unknown = actual;
        if (subject === "body" && typeof actual === "string") {
          try { checkVal = JSON.parse(actual); } catch { /* keep as string */ }
        }
        const typeChecks: Record<string, (v: unknown) => boolean> = {
          isString:  (v) => typeof v === "string",
          isNumber:  (v) => typeof v === "number",
          isBoolean: (v) => typeof v === "boolean",
          isArray:   (v) => Array.isArray(v),
          isNull:    (v) => v === null,
        };
        const passed = typeChecks[operator](checkVal);
        const label  = operator.replace("is", "").toLowerCase();
        const actual_type = Array.isArray(checkVal) ? "array" : checkVal === null ? "null" : typeof checkVal;
        return { line, passed, message: passed
          ? `${subject} is a ${label}`
          : `${subject} is not a ${label} (got ${actual_type})`
        };
      }
      default:
        throw new Error(`Unknown operator "${operator}"`);
    }
  } catch (err) {
    return { line, passed: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function runAssertions(script: string, response: APIResponse): AssertionResult[] {
  return script.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((line) => runAssertion(line, response));
}

// ─── Smart assertion generator ─────────────────────────────────────────────────

function fieldAssertion(path: string, value: unknown): string {
  if (value === null)          return `${path} isNull`;
  if (Array.isArray(value))   return `${path} isArray`;
  switch (typeof value) {
    case "string":  return `${path} isString`;
    case "number":  return `${path} isNumber`;
    case "boolean": return `${path} isBoolean`;
    default:        return `${path} exists`;
  }
}

function generateAssertions(response: APIResponse): string {
  const lines: string[] = [];

  lines.push(`# ── Status & timing ──`);
  lines.push(`status == ${response.status_code}`);
  const timeThreshold = Math.max(1000, Math.ceil(response.response_time_ms / 100) * 300);
  lines.push(`responseTime < ${timeThreshold}`);

  const ct = Object.entries(response.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
  if (ct?.includes("json")) lines.push(`header.content-type contains application/json`);

  if (!response.body.trim()) return lines.join("\n");

  try {
    const parsed: unknown = JSON.parse(response.body);

    if (Array.isArray(parsed)) {
      lines.push("");
      lines.push(`# ── Body (array, ${parsed.length} items) ──`);
      lines.push(`body isArray`);
      if (parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
        lines.push(`# First item fields:`);
        Object.entries(parsed[0] as Record<string, unknown>).slice(0, 8)
          .forEach(([k, v]) => lines.push(fieldAssertion(`body.0.${k}`, v)));
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      lines.push("");
      lines.push(`# ── Body fields ──`);
      entries.slice(0, 10).forEach(([k, v]) => {
        lines.push(fieldAssertion(`body.${k}`, v));
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          Object.entries(v as Record<string, unknown>).slice(0, 3)
            .forEach(([nk, nv]) => lines.push(fieldAssertion(`body.${k}.${nk}`, nv)));
        }
      });
    } else {
      lines.push("");
      lines.push(fieldAssertion("body", parsed));
    }
  } catch {
    lines.push(""); lines.push(`body exists`);
  }

  return lines.join("\n");
}

// ─── cURL parser ───────────────────────────────────────────────────────────────

function tokenizeCurl(input: string): string[] {
  const joined = input.replace(/\\\r?\n\s*/g, " ");
  const tokens: string[] = [];
  let i = 0;
  while (i < joined.length) {
    if (/\s/.test(joined[i])) { i++; continue; }
    if (joined[i] === "'") {
      let j = i + 1;
      while (j < joined.length && joined[j] !== "'") j++;
      tokens.push(joined.slice(i + 1, j));
      i = j + 1;
    } else if (joined[i] === '"') {
      let j = i + 1; let s = "";
      while (j < joined.length && joined[j] !== '"') {
        if (joined[j] === '\\' && j + 1 < joined.length) { j++; s += joined[j]; }
        else s += joined[j];
        j++;
      }
      tokens.push(s); i = j + 1;
    } else {
      let j = i;
      while (j < joined.length && !/[\s'"]/.test(joined[j])) j++;
      tokens.push(joined.slice(i, j)); i = j;
    }
  }
  return tokens.filter((t) => t !== "");
}

type ParsedCurl = { method: HttpMethod; url: string; headers: Header[]; body: string };

function parseCurl(raw: string): ParsedCurl | { error: string } {
  const tokens = tokenizeCurl(raw.trim());
  if (!tokens.length || tokens[0].toLowerCase() !== "curl")
    return { error: "Input must start with 'curl'" };

  let method = ""; let url = "";
  const headers: Header[] = []; let body = "";
  const IGNORE_FLAGS = new Set(["-L", "--location", "-s", "--silent", "--compressed",
    "-v", "--verbose", "--no-progress-meter", "-f", "--fail", "-k", "--insecure"]);

  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "-X" || tok === "--request")          { method = (tokens[++i] ?? "").toUpperCase(); }
    else if (tok.startsWith("--request="))            { method = tok.slice("--request=".length).toUpperCase(); }
    else if (tok === "-H" || tok === "--header") {
      const hdr = tokens[++i] ?? "";
      const ci  = hdr.indexOf(": ");
      if (ci !== -1) headers.push({ key: hdr.slice(0, ci).trim(), value: hdr.slice(ci + 2).trim(), enabled: true });
    }
    else if (tok.startsWith("--header=")) {
      const hdr = tok.slice("--header=".length);
      const ci  = hdr.indexOf(": ");
      if (ci !== -1) headers.push({ key: hdr.slice(0, ci).trim(), value: hdr.slice(ci + 2).trim(), enabled: true });
    }
    else if (["-d", "--data", "--data-raw", "--data-binary"].includes(tok)) { body = tokens[++i] ?? ""; }
    else if (tok.startsWith("--data=") || tok.startsWith("--data-raw="))    { body = tok.slice(tok.indexOf("=") + 1); }
    else if (tok === "--json") {
      body = tokens[++i] ?? "";
      if (!headers.some((h) => h.key.toLowerCase() === "content-type"))
        headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    }
    else if (tok === "--url")            { url = tokens[++i] ?? ""; }
    else if (tok.startsWith("--url="))  { url = tok.slice("--url=".length); }
    else if (tok === "-u" || tok === "--user") { i++; }
    else if (IGNORE_FLAGS.has(tok))     { /* skip */ }
    else if (!tok.startsWith("-") && !url) { url = tok; }
    i++;
  }

  if (!method) method = body ? "POST" : "GET";
  if (!url)    return { error: "Could not find a URL in the cURL command" };

  const VALID: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];
  const parsedMethod = VALID.includes(method as HttpMethod) ? (method as HttpMethod) : "POST";
  return { method: parsedMethod, url, headers, body };
}

// ─── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-xs text-slate-600">—</span>;
  const W = 84; const H = 28;
  const min = Math.min(...values); const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * W},${H - 4 - ((v - min) / range) * (H - 8)}`
  ).join(" ");
  const lastX = W;
  const lastY = H - 4 - ((values[values.length - 1] - min) / range) * (H - 8);
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#3b82f6" />
    </svg>
  );
}

// ─── Simple Markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
      : p
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  return (
    <div className="text-xs text-slate-300 leading-relaxed">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("### ")) return <p key={i} className="font-semibold text-white mt-2">{line.slice(4)}</p>;
        if (line.startsWith("## "))  return <p key={i} className="font-bold text-white mt-2">{line.slice(3)}</p>;
        if (line.startsWith("# "))   return <p key={i} className="font-bold text-white mt-2">{line.slice(2)}</p>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <div key={i} className="flex gap-1.5 ml-1"><span className="text-violet-400 shrink-0 mt-0.5">•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (line.trim() === "") return <div key={i} className="h-1.5" />;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ─── Activity bar config ────────────────────────────────────────────────────────

type SidebarTab = "collections" | "history" | "environment" | "tests" | "ai" | "settings";

const ACTIVITY_TABS: { id: SidebarTab; label: string; Icon: React.ElementType }[] = [
  { id: "collections", label: "Collections",   Icon: Layers       },
  { id: "history",     label: "History",        Icon: Clock        },
  { id: "environment", label: "Environment",    Icon: Globe        },
  { id: "tests",       label: "Tests",          Icon: FlaskConical },
  { id: "ai",          label: "AI Assistant",   Icon: Sparkles     },
  { id: "settings",    label: "Settings",       Icon: Settings2    },
];

// ─── Main Page Component ────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState("");
  const [dataLoaded, setDataLoaded]   = useState(false);

  // ── Request state ─────────────────────────────────────────────────────────
  const [method, setMethod]   = useState<HttpMethod>("GET");
  const [url, setUrl]         = useState("");
  const [headers, setHeaders] = useState<Header[]>([
    { key: "Content-Type", value: "application/json", enabled: true },
  ]);
  const [body, setBody]         = useState("");
  const [response, setResponse] = useState<APIResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [sentUrl, setSentUrl]   = useState("");
  const [activeTab, setActiveTab] =
    useState<"headers" | "auth" | "body" | "tests" | "response">("headers");
  const [showResponseHeaders, setShowResponseHeaders] = useState(false);

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const [sidebarTab,  setSidebarTab]  = useState<SidebarTab>("collections");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── History ───────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── Collections ───────────────────────────────────────────────────────────
  const [collections, setCollections]                 = useState<Collection[]>([]);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [showSaveDialog, setShowSaveDialog]           = useState(false);
  const [saveName, setSaveName]                       = useState("");
  const [saveCollectionId, setSaveCollectionId]       = useState("__new__");
  const [newCollectionName, setNewCollectionName]     = useState("");

  // ── Environment variables ─────────────────────────────────────────────────
  const [envVars, setEnvVars] = useState<EnvVariable[]>([]);

  // ── Auth config ───────────────────────────────────────────────────────────
  const [authConfig, setAuthConfig]         = useState<AuthConfig>(DEFAULT_AUTH);
  const [showAuthPassword, setShowAuthPassword] = useState(false);

  // ── Tests ─────────────────────────────────────────────────────────────────
  const [testScript, setTestScript]   = useState("");
  const [testResults, setTestResults] = useState<AssertionResult[]>([]);

  // ── AI assistant ──────────────────────────────────────────────────────────
  const [aiPrompt, setAiPrompt]               = useState("");
  const [aiLoading, setAiLoading]             = useState<"generate" | "debug" | "explain" | null>(null);
  const [aiError, setAiError]                 = useState("");
  const [aiDebugResult, setAiDebugResult]     = useState("");
  const [aiExplainResult, setAiExplainResult] = useState("");

  // ── cURL import ───────────────────────────────────────────────────────────
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput]           = useState("");
  const [curlError, setCurlError]           = useState("");

  // ── Auth check + load all user data from backend ──────────────────────────
  useEffect(() => {
    const token    = localStorage.getItem("deviq_token");
    const username = localStorage.getItem("deviq_username");
    if (!token || !username) { router.push("/login"); return; }

    setCurrentUser(username);
    const h = { Authorization: `Bearer ${token}` };

    Promise.all([
      axios.get(`${API_BASE}/data/history`,     { headers: h }),
      axios.get(`${API_BASE}/data/collections`, { headers: h }),
      axios.get(`${API_BASE}/data/env_vars`,    { headers: h }),
      axios.get(`${API_BASE}/data/auth_config`, { headers: h }),
      axios.get(`${API_BASE}/data/test_script`, { headers: h }),
    ]).then(([hR, cR, eR, aR, tR]) => {
      if (hR.data.value) setHistory(hR.data.value);
      if (cR.data.value) setCollections(cR.data.value);
      if (eR.data.value) setEnvVars(eR.data.value);
      if (aR.data.value) setAuthConfig(aR.data.value);
      if (tR.data.value) setTestScript(tR.data.value);
      setDataLoaded(true);
    }).catch(() => {
      // Token expired or invalid — send back to login
      localStorage.removeItem("deviq_token");
      localStorage.removeItem("deviq_username");
      router.push("/login");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save data to backend (fire-and-forget) ────────────────────────────────
  function saveData(key: string, value: unknown) {
    const token = localStorage.getItem("deviq_token");
    if (!token) return;
    axios.put(`${API_BASE}/data/${key}`, { value }, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* silently ignore save errors */ });
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const activeEnvCount     = envVars.filter((v) => v.enabled && v.key.trim()).length;
  const resolvedUrlPreview = url.includes("{{") ? applyEnv(url, envVars) : "";
  const testsPassed        = testResults.filter((r) => r.passed).length;
  const testsTotal         = testResults.length;
  const allTestsPassed     = testsTotal > 0 && testsPassed === testsTotal;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const successCount    = history.filter((h) => h.response.success).length;
  const successRate     = history.length > 0 ? Math.round((successCount / history.length) * 100) : 0;
  const avgResponseTime = history.length > 0
    ? Math.round(history.reduce((s, h) => s + h.response.response_time_ms, 0) / history.length)
    : 0;
  const recentTimes     = [...history].slice(0, 20).reverse().map((h) => h.response.response_time_ms);

  // ── Sidebar ────────────────────────────────────────────────────────────────
  function selectSidebarTab(tab: SidebarTab) {
    if (tab === sidebarTab && sidebarOpen) { setSidebarOpen(false); }
    else { setSidebarTab(tab); setSidebarOpen(true); }
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem("deviq_token");
    localStorage.removeItem("deviq_username");
    router.push("/login");
  }

  // ─── Send request ──────────────────────────────────────────────────────────

  async function sendRequest() {
    if (!url.trim()) { setError("Please enter a URL"); return; }

    setLoading(true); setError(""); setResponse(null); setTestResults([]);
    setAiDebugResult(""); setAiExplainResult(""); setAiError("");
    setActiveTab("response");

    const resolvedUrl     = applyEnv(url.trim(), envVars);
    const resolvedHeaders = headers.map((h) => ({ ...h, key: applyEnv(h.key, envVars), value: applyEnv(h.value, envVars) }));
    const resolvedBody    = applyEnv(body, envVars);
    const resolvedAuth: AuthConfig = {
      ...authConfig,
      token:       applyEnv(authConfig.token,       envVars),
      username:    applyEnv(authConfig.username,    envVars),
      password:    applyEnv(authConfig.password,    envVars),
      apiKeyValue: applyEnv(authConfig.apiKeyValue, envVars),
    };

    setSentUrl(resolvedUrl);

    const headersObj: Record<string, string> = {};
    resolvedHeaders.filter((h) => h.enabled && h.key.trim()).forEach((h) => (headersObj[h.key] = h.value));
    Object.assign(headersObj, buildAuthHeader(resolvedAuth));

    let parsedBody = null;
    if (resolvedBody.trim() && method !== "GET") {
      try { parsedBody = JSON.parse(resolvedBody); }
      catch { setError("Request body is not valid JSON"); setLoading(false); return; }
    }

    const token = localStorage.getItem("deviq_token");
    try {
      const result = await axios.post(`${API_BASE}/execute`, {
        method, url: resolvedUrl, headers: headersObj, body: parsedBody,
      }, { headers: { Authorization: `Bearer ${token}` } });

      setResponse(result.data);
      saveToHistory(result.data, resolvedUrl);
      if (testScript.trim()) setTestResults(runAssertions(testScript, result.data));
    } catch (err: unknown) {
      setError(
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "Failed to connect to backend. Is it running?"
      );
    } finally {
      setLoading(false);
    }
  }

  // ─── History helpers ───────────────────────────────────────────────────────

  function saveToHistory(resp: APIResponse, resolvedUrl: string) {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      method, url: resolvedUrl, headers, body, response: resp,
    };
    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_HISTORY);
      saveData("history", updated);
      return updated;
    });
  }

  function loadFromHistory(entry: HistoryEntry) {
    setMethod(entry.method); setUrl(entry.url);
    setHeaders(entry.headers); setBody(entry.body);
    setResponse(entry.response); setTestResults([]);
    setActiveTab("response"); setError("");
  }

  function deleteHistoryEntry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      saveData("history", updated);
      return updated;
    });
  }

  function clearHistory() {
    setHistory([]);
    saveData("history", []);
  }

  // ─── Collections helpers ───────────────────────────────────────────────────

  function openSaveDialog() {
    setSaveName(url.trim() ? defaultRequestName(method, url) : "");
    setSaveCollectionId(collections.length > 0 ? collections[0].id : "__new__");
    setNewCollectionName(""); setShowSaveDialog(true);
  }

  function saveRequest() {
    if (!saveName.trim()) return;
    const req: SavedRequest = {
      id: `${Date.now()}-${Math.random()}`,
      name: saveName.trim(), method, url: url.trim(), headers, body, createdAt: Date.now(),
    };
    setCollections((prev) => {
      let updated: Collection[];
      if (saveCollectionId === "__new__") {
        const col: Collection = { id: `col-${Date.now()}`, name: newCollectionName.trim() || "My Collection", requests: [req] };
        updated = [...prev, col];
        setExpandedCollections((e) => new Set([...e, col.id]));
      } else {
        updated = prev.map((col) => col.id === saveCollectionId ? { ...col, requests: [...col.requests, req] } : col);
      }
      saveData("collections", updated);
      return updated;
    });
    setShowSaveDialog(false);
  }

  function loadFromSaved(req: SavedRequest) {
    setMethod(req.method); setUrl(req.url); setHeaders(req.headers); setBody(req.body);
    setResponse(null); setTestResults([]); setActiveTab("headers"); setError("");
  }

  function deleteSavedRequest(collectionId: string, requestId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCollections((prev) => {
      const updated = prev.map((col) => col.id === collectionId ? { ...col, requests: col.requests.filter((r) => r.id !== requestId) } : col);
      saveData("collections", updated);
      return updated;
    });
  }

  function deleteCollection(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCollections((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      saveData("collections", updated);
      return updated;
    });
  }

  function toggleCollectionExpand(id: string) {
    setExpandedCollections((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // ─── Env helpers ───────────────────────────────────────────────────────────

  function persistEnv(updated: EnvVariable[]) {
    setEnvVars(updated);
    saveData("env_vars", updated);
  }

  function addEnvVar() { persistEnv([...envVars, { id: `env-${Date.now()}`, key: "", value: "", enabled: true }]); }
  function updateEnvVar(index: number, field: keyof EnvVariable, value: string | boolean) { persistEnv(envVars.map((v, i) => i === index ? { ...v, [field]: value } : v)); }
  function removeEnvVar(index: number) { persistEnv(envVars.filter((_, i) => i !== index)); }

  // ─── Auth config helpers ───────────────────────────────────────────────────

  function updateAuthConfig(field: keyof AuthConfig, value: string) {
    const updated = { ...authConfig, [field]: value };
    setAuthConfig(updated);
    saveData("auth_config", updated);
  }

  // ─── Tests helpers ─────────────────────────────────────────────────────────

  function updateTestScript(value: string) {
    setTestScript(value);
    saveData("test_script", value);
  }

  // ─── cURL import handler ───────────────────────────────────────────────────

  function importCurl() {
    setCurlError("");
    const result = parseCurl(curlInput);
    if ("error" in result) { setCurlError(result.error); return; }
    setMethod(result.method);
    setUrl(result.url);
    if (result.headers.length > 0) setHeaders(result.headers);
    setBody(result.body);
    setResponse(null); setTestResults([]); setActiveTab("headers"); setError("");
    setCurlInput(""); setShowCurlImport(false);
  }

  // ─── AI helpers ────────────────────────────────────────────────────────────

  async function aiGenerateRequest() {
    if (!aiPrompt.trim()) return;
    setAiLoading("generate");
    setAiError("");
    const token = localStorage.getItem("deviq_token");
    try {
      const res = await axios.post(`${API_BASE}/ai/generate`, { prompt: aiPrompt }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { method: m, url: u, headers: h, body: b } = res.data;
      if (m) setMethod(m as HttpMethod);
      if (u) setUrl(u);
      if (Array.isArray(h) && h.length > 0) setHeaders(h);
      if (b) setBody(b);
      setAiPrompt("");
      setActiveTab("headers");
    } catch (err: unknown) {
      setAiError(
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "AI request failed — check your backend logs."
      );
    } finally {
      setAiLoading(null);
    }
  }

  async function aiDebug() {
    if (!response) return;
    setAiLoading("debug");
    setAiError("");
    setAiDebugResult("");
    const token = localStorage.getItem("deviq_token");
    try {
      const res = await axios.post(`${API_BASE}/ai/debug`, {
        method,
        url: sentUrl || url,
        status_code: response.status_code,
        response_body: response.body,
        response_time_ms: response.response_time_ms,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setAiDebugResult(res.data.analysis);
    } catch (err: unknown) {
      setAiError(
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "AI debug failed — check your backend logs."
      );
    } finally {
      setAiLoading(null);
    }
  }

  async function aiExplain() {
    if (!response) return;
    setAiLoading("explain");
    setAiError("");
    setAiExplainResult("");
    const token = localStorage.getItem("deviq_token");
    try {
      const res = await axios.post(`${API_BASE}/ai/explain`, {
        method,
        url: sentUrl || url,
        status_code: response.status_code,
        response_body: response.body,
        response_headers: response.headers,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setAiExplainResult(res.data.explanation);
    } catch (err: unknown) {
      setAiError(
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "AI explain failed — check your backend logs."
      );
    } finally {
      setAiLoading(null);
    }
  }

  // ─── Request-tab helpers ───────────────────────────────────────────────────

  function addHeader() { setHeaders([...headers, { key: "", value: "", enabled: true }]); }
  function updateHeader(index: number, field: keyof Header, value: string | boolean) { setHeaders(headers.map((h, i) => i === index ? { ...h, [field]: value } : h)); }
  function removeHeader(index: number) { setHeaders(headers.filter((_, i) => i !== index)); }
  function formatBody(raw: string): string { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; } }

  // ─── Loading screen ────────────────────────────────────────────────────────

  if (!dataLoaded) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          Loading your workspace…
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">

      {/* ── Top Nav ── */}
      <nav className="bg-slate-800 border-b border-slate-700 px-5 py-3 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
            <Send size={12} className="text-white" />
          </div>
          <h1 className="text-base font-bold text-white tracking-tight">DevIQ</h1>
          <span className="text-xs text-slate-600 font-medium hidden sm:block">API Tester</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">
            <span className="text-slate-300 font-medium">{currentUser}</span>
          </span>
          <button type="button" onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-800 px-2.5 py-1.5 rounded-lg transition-colors">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </nav>

      <div className="flex flex-1 min-h-0">

        {/* ── Activity Bar ── */}
        <div className="w-12 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-3 gap-1 shrink-0">
          {ACTIVITY_TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => selectSidebarTab(t.id)} title={t.label}
              className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                sidebarTab === t.id && sidebarOpen
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}>
              <t.Icon size={17} />
              {t.id === "history"     && history.length > 0     && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />}
              {t.id === "collections" && collections.length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-yellow-500 rounded-full" />}
              {t.id === "environment" && activeEnvCount > 0     && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full" />}
              {t.id === "tests"       && testsTotal > 0         && <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${allTestsPassed ? "bg-green-500" : "bg-red-500"}`} />}
            </button>
          ))}
        </div>

        {/* ── Sidebar Panel ── */}
        {sidebarOpen && (
          <aside className="w-60 bg-slate-800 border-r border-slate-700 flex flex-col shrink-0">

            {/* Panel header */}
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-slate-200">
                {ACTIVITY_TABS.find((t) => t.id === sidebarTab)?.label}
              </span>
              {sidebarTab === "history"     && history.length > 0 && <button type="button" onClick={clearHistory} className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear all</button>}
              {sidebarTab === "environment" && <button type="button" onClick={addEnvVar} className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"><Plus size={11} /> Add</button>}
            </div>

            <div className="overflow-y-auto flex-1">

              {/* ── History ── */}
              {sidebarTab === "history" && (
                history.length === 0
                  ? <p className="text-slate-500 text-xs p-4 text-center mt-6">No history yet.<br />Send a request to start.</p>
                  : history.map((entry) => (
                    <button key={entry.id} type="button" onClick={() => loadFromHistory(entry)}
                      className="w-full text-left px-4 py-3 border-b border-slate-700/60 hover:bg-slate-700/50 transition-colors group flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold shrink-0 ${methodColor(entry.method)}`}>{entry.method}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-bold text-white shrink-0 ${statusColor(entry.response.status_code)}`}>{entry.response.status_code}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-500">{formatTimestamp(entry.timestamp)}</span>
                          <button type="button" onClick={(e) => deleteHistoryEntry(entry.id, e)} aria-label="Delete history entry" className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"><X size={12} /></button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 truncate font-mono">{entry.url}</p>
                      <p className="text-xs text-slate-600">{entry.response.response_time_ms}ms</p>
                    </button>
                  ))
              )}

              {/* ── Collections ── */}
              {sidebarTab === "collections" && (
                collections.length === 0
                  ? <p className="text-slate-500 text-xs p-4 text-center mt-6">No collections yet.<br />Save a request to create one.</p>
                  : collections.map((col) => (
                    <div key={col.id}>
                      <button type="button" onClick={() => toggleCollectionExpand(col.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-700/50 transition-colors group flex items-center gap-2 border-b border-slate-700/40">
                        {expandedCollections.has(col.id) ? <FolderOpen size={13} className="text-yellow-400 shrink-0" /> : <Folder size={13} className="text-yellow-400 shrink-0" />}
                        <span className="text-sm text-slate-200 font-medium flex-1 truncate">{col.name}</span>
                        <span className="text-xs text-slate-500 shrink-0">{col.requests.length}</span>
                        <button type="button" onClick={(e) => deleteCollection(col.id, e)} aria-label="Delete collection" className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all shrink-0"><X size={12} /></button>
                      </button>
                      {expandedCollections.has(col.id) && (
                        <div className="bg-slate-900/30">
                          {col.requests.length === 0
                            ? <p className="text-xs text-slate-600 px-8 py-2">Empty collection</p>
                            : col.requests.map((req) => (
                              <button key={req.id} type="button" onClick={() => loadFromSaved(req)}
                                className="w-full text-left pl-8 pr-4 py-2 hover:bg-slate-700/50 transition-colors group flex items-center gap-2 border-b border-slate-700/20">
                                <span className={`text-xs font-bold shrink-0 w-12 ${methodColor(req.method)}`}>{req.method}</span>
                                <span className="text-xs text-slate-300 flex-1 truncate">{req.name}</span>
                                <button type="button" onClick={(e) => deleteSavedRequest(col.id, req.id, e)} aria-label="Delete saved request" className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all shrink-0"><X size={12} /></button>
                              </button>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  ))
              )}

              {/* ── Environment ── */}
              {sidebarTab === "environment" && (
                <div className="p-3 flex flex-col gap-2">
                  <p className="text-xs text-slate-500 px-1 pb-1">Use <span className="font-mono text-purple-400">{"{{key}}"}</span> in URLs, headers, body, and auth.</p>
                  {envVars.length === 0 && <p className="text-slate-600 text-xs text-center mt-4">No variables yet.</p>}
                  {envVars.map((v, i) => (
                    <div key={v.id} className="flex gap-1.5 items-center">
                      <input type="checkbox" checked={v.enabled} onChange={(e) => updateEnvVar(i, "enabled", e.target.checked)} aria-label={`Enable variable ${i + 1}`} title={`Enable variable ${i + 1}`} className="accent-purple-500 shrink-0" />
                      <input type="text" value={v.key} onChange={(e) => updateEnvVar(i, "key", e.target.value)} placeholder="KEY" aria-label={`Variable ${i + 1} key`} className="w-20 bg-slate-700 text-purple-300 font-mono rounded px-2 py-1.5 text-xs border border-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500" />
                      <input type="text" value={v.value} onChange={(e) => updateEnvVar(i, "value", e.target.value)} placeholder="value" aria-label={`Variable ${i + 1} value`} className="flex-1 bg-slate-700 text-slate-300 font-mono rounded px-2 py-1.5 text-xs border border-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500" />
                      <button type="button" onClick={() => removeEnvVar(i)} aria-label={`Remove variable ${i + 1}`} className="text-slate-500 hover:text-red-400 transition-colors shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Tests ── */}
              {sidebarTab === "tests" && (
                testResults.length === 0
                  ? <div className="p-6 flex flex-col items-center gap-3 text-center mt-4">
                      <FlaskConical size={24} className="text-slate-700" />
                      <p className="text-xs text-slate-500">No test results yet.<br />Write assertions in the Tests tab<br />and send a request.</p>
                    </div>
                  : <div className="flex flex-col gap-2 p-3">
                      <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${allTestsPassed ? "bg-green-900/30 text-green-300 border border-green-700/40" : "bg-red-900/30 text-red-300 border border-red-700/40"}`}>
                        {allTestsPassed ? <CheckCircle size={13} /> : <XCircle size={13} />}
                        {testsPassed} / {testsTotal} passed
                      </div>
                      {testResults.map((r, i) => (
                        <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${r.passed ? "bg-green-900/10" : "bg-red-900/10"}`}>
                          {r.passed ? <CheckCircle size={11} className="text-green-400 shrink-0 mt-0.5" /> : <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <div className="font-mono text-slate-400 truncate">{r.line}</div>
                            <div className={`${r.passed ? "text-green-400" : "text-red-400"} truncate`}>{r.message}</div>
                          </div>
                        </div>
                      ))}
                    </div>
              )}

              {/* ── AI Assistant ── */}
              {sidebarTab === "ai" && (
                <div className="p-4 flex flex-col gap-4">
                  <div className="bg-violet-900/20 border border-violet-700/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Terminal size={13} className="text-violet-400" />
                      <span className="text-xs font-semibold text-violet-300">cURL Import</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">Paste a cURL command to auto-fill the request builder.</p>
                    <button type="button" onClick={() => { setCurlError(""); setShowCurlImport(true); }}
                      className="text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                      Open Import
                    </button>
                  </div>

                  <div className={`border rounded-xl p-4 transition-colors ${response ? "bg-violet-900/20 border-violet-700/40" : "bg-slate-700/20 border-slate-700/40"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Sparkles size={13} className={response ? "text-violet-400" : "text-slate-600"} />
                      <span className={`text-xs font-semibold ${response ? "text-violet-300" : "text-slate-500"}`}>Smart Assertions</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">Analyse the response and generate type-aware test assertions.</p>
                    <button type="button"
                      onClick={() => { if (response) { updateTestScript(generateAssertions(response)); setActiveTab("tests"); setSidebarTab("tests"); } }}
                      disabled={!response}
                      className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                      {response ? "Generate Assertions" : "Send a request first"}
                    </button>
                  </div>

                  <div className="bg-violet-900/20 border border-violet-700/40 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-violet-400" />
                      <span className="text-xs font-semibold text-violet-300">Plain-English Generator</span>
                    </div>
                    <p className="text-xs text-slate-500">Describe a request and AI will fill in the URL, method, headers, and body.</p>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => { setAiPrompt(e.target.value); setAiError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) aiGenerateRequest(); }}
                      rows={3}
                      placeholder={"Get all posts from JSONPlaceholder\nCreate a user with name and email\nDelete post with id 5"}
                      className="w-full bg-slate-900 text-slate-300 font-mono text-xs rounded-lg p-2.5 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none placeholder-slate-600"
                    />
                    {aiError && aiLoading === null && (
                      <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded px-2 py-1.5">{aiError}</p>
                    )}
                    <button
                      type="button"
                      onClick={aiGenerateRequest}
                      disabled={!aiPrompt.trim() || aiLoading === "generate"}
                      className="text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                    >
                      {aiLoading === "generate"
                        ? <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                        : <><Sparkles size={11} /> Generate Request</>
                      }
                    </button>
                    <p className="text-xs text-slate-600">Tip: <kbd className="bg-slate-700 px-1 py-0.5 rounded text-slate-500">Ctrl+Enter</kbd> to generate</p>
                  </div>
                </div>
              )}

              {/* ── Settings ── */}
              {sidebarTab === "settings" && (
                <div className="p-4 flex flex-col gap-4">
                  <div className="bg-slate-700/40 rounded-xl p-4 flex flex-col gap-2">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Account</p>
                    <p className="text-sm text-white font-medium">{currentUser}</p>
                    <button type="button" onClick={logout}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-800/40 hover:border-red-700 px-3 py-1.5 rounded-lg w-fit transition-colors mt-1">
                      <LogOut size={12} /> Sign out
                    </button>
                  </div>
                  <div className="bg-slate-700/40 rounded-xl p-4 flex flex-col gap-2">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Workspace</p>
                    <div className="flex justify-between text-xs"><span className="text-slate-400">Requests logged</span><span className="text-white font-mono">{history.length}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-slate-400">Collections</span><span className="text-white font-mono">{collections.length}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-slate-400">Env variables</span><span className="text-white font-mono">{envVars.length}</span></div>
                  </div>
                  <div className="bg-slate-700/40 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">About</p>
                    <p className="text-xs text-slate-400">DevIQ API Tester</p>
                    <p className="text-xs text-slate-600 mt-0.5">v0.8 · Data synced to your account</p>
                  </div>
                </div>
              )}

            </div>
          </aside>
        )}

        {/* ── Main Content ── */}
        <main className="flex-1 p-5 overflow-y-auto">
          <div className="max-w-5xl mx-auto flex flex-col gap-5">

            {/* Stats Bar */}
            {history.length > 0 && (
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Requests</p>
                  <p className="text-2xl font-bold text-white">{history.length}</p>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Success Rate</p>
                  <p className={`text-2xl font-bold ${successRate >= 80 ? "text-green-400" : successRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                    {successRate}%
                  </p>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Avg Response</p>
                  <p className="text-2xl font-bold text-white">{avgResponseTime}<span className="text-sm font-normal text-slate-500 ml-1">ms</span></p>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Response Times</p>
                    <p className="text-xs text-slate-600">Last {recentTimes.length}</p>
                  </div>
                  <Sparkline values={recentTimes} />
                </div>
              </div>
            )}

            {/* URL Bar */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Request</p>
              <div className="flex gap-2">
                <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} aria-label="HTTP method" title="HTTP method" className="bg-slate-700 text-white font-bold rounded-lg px-3 py-2 border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => <option key={m}>{m}</option>)}
                </select>
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendRequest()} placeholder="https://{{baseUrl}}/posts" className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
                <button type="button" onClick={() => { setCurlError(""); setShowCurlImport(true); }} title="Import a cURL command" className="border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition-colors"><Terminal size={14} /> cURL</button>
                <button type="button" onClick={openSaveDialog} title="Save to a collection" className="border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition-colors"><Save size={14} /> Save</button>
                <button type="button" onClick={sendRequest} disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors">
                  <Send size={14} />{loading ? "Sending..." : "Send"}
                </button>
              </div>
              {resolvedUrlPreview && resolvedUrlPreview !== url && (
                <p className="text-xs font-mono text-purple-300 bg-purple-900/20 border border-purple-800/40 rounded px-3 py-1.5">
                  <span className="text-purple-500 mr-2">Resolves to:</span>{resolvedUrlPreview}
                </p>
              )}
            </div>

            {/* cURL Import Modal */}
            {showCurlImport && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl flex flex-col gap-5 p-6 shadow-2xl">

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-white flex items-center gap-2">
                        <Terminal size={16} className="text-blue-400" /> Import cURL Command
                      </h2>
                      <p className="text-xs text-slate-400 mt-1">
                        Paste any cURL command — method, URL, headers, and body are auto-filled.
                      </p>
                    </div>
                    <button type="button" onClick={() => setShowCurlImport(false)} aria-label="Close" className="text-slate-500 hover:text-slate-200 transition-colors mt-0.5">
                      <X size={18} />
                    </button>
                  </div>

                  <textarea
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={curlInput}
                    onChange={(e) => { setCurlInput(e.target.value); setCurlError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) importCurl(); }}
                    rows={8}
                    spellCheck={false}
                    placeholder={`curl -X POST https://api.example.com/login \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer eyJhbGci..." \\
  -d '{"email":"user@example.com","password":"secret"}'`}
                    className="w-full bg-slate-900 text-green-300 font-mono text-sm rounded-xl p-4 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder-slate-600"
                  />

                  {curlError && (
                    <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                      {curlError}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-600">Tip: <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">Ctrl+Enter</kbd> to import</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setShowCurlImport(false)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2 rounded-lg border border-slate-600 transition-colors">Cancel</button>
                      <button type="button" onClick={importCurl} disabled={!curlInput.trim()} className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold px-5 py-2 rounded-lg transition-colors flex items-center gap-1.5">
                        <Terminal size={13} /> Import
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* Save Dialog */}
            {showSaveDialog && (
              <div className="bg-slate-800 rounded-xl border border-blue-500/40 p-4 flex flex-col gap-3">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Save Request</p>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Request name" autoFocus onKeyDown={(e) => e.key === "Enter" && saveRequest()} className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <div className="flex gap-2">
                  <select value={saveCollectionId} onChange={(e) => setSaveCollectionId(e.target.value)} aria-label="Target collection" title="Target collection" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1">
                    {collections.map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
                    <option value="__new__">+ New collection…</option>
                  </select>
                  {saveCollectionId === "__new__" && (
                    <input type="text" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} placeholder="Collection name" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1" />
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowSaveDialog(false)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-1.5 rounded-lg border border-slate-600 transition-colors">Cancel</button>
                  <button type="button" onClick={saveRequest} disabled={!saveName.trim()} className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg transition-colors">Save</button>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col">
              <div className="flex border-b border-slate-700">
                {(["headers", "auth", "body", "tests", "response"] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                    className={`px-5 py-3 text-sm font-medium capitalize transition-colors flex items-center gap-1.5 ${activeTab === tab ? "text-blue-400 border-b-2 border-blue-400" : "text-slate-400 hover:text-slate-200"}`}>
                    {tab}
                    {tab === "auth" && authConfig.type !== "none" && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                    {tab === "tests" && testsTotal > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full text-white font-bold ${allTestsPassed ? "bg-green-600" : "bg-red-600"}`}>{testsPassed}/{testsTotal}</span>}
                    {tab === "response" && response && <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${statusColor(response.status_code)}`}>{response.status_code}</span>}
                  </button>
                ))}
              </div>

              {/* Headers Tab */}
              {activeTab === "headers" && (
                <div className="p-4 flex flex-col gap-2">
                  {headers.map((header, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input type="checkbox" checked={header.enabled} onChange={(e) => updateHeader(i, "enabled", e.target.checked)} aria-label={`Enable header ${i + 1}`} title={`Enable header ${i + 1}`} className="accent-blue-500" />
                      <input type="text" value={header.key} onChange={(e) => updateHeader(i, "key", e.target.value)} placeholder="Header name" aria-label={`Header ${i + 1} name`} className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <input type="text" value={header.value} onChange={(e) => updateHeader(i, "value", e.target.value)} placeholder="Value" aria-label={`Header ${i + 1} value`} className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <button type="button" onClick={() => removeHeader(i)} aria-label={`Remove header ${i + 1}`} title="Remove header" className="text-slate-500 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={addHeader} className="mt-1 text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 w-fit"><Plus size={14} /> Add Header</button>
                </div>
              )}

              {/* Auth Tab */}
              {activeTab === "auth" && (
                <div className="p-5 flex flex-col gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 uppercase tracking-widest font-medium">Auth Type</label>
                    <select value={authConfig.type} onChange={(e) => updateAuthConfig("type", e.target.value)} aria-label="Auth type" title="Auth type" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52">
                      <option value="none">No Auth</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                      <option value="apikey">API Key</option>
                    </select>
                  </div>
                  {authConfig.type === "bearer" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-medium">Token</label>
                        <input type="text" value={authConfig.token} onChange={(e) => updateAuthConfig("token", e.target.value)} placeholder="eyJhbGciOi…  or  {{token}}" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
                      </div>
                      {authConfig.token && (
                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono">
                          <span className="text-slate-500">Will inject → </span><span className="text-blue-300">Authorization: </span><span className="text-slate-300">Bearer </span><span className="text-green-300 break-all">{authConfig.token}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {authConfig.type === "basic" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-medium">Username</label>
                        <input type="text" value={authConfig.username} onChange={(e) => updateAuthConfig("username", e.target.value)} placeholder="username or {{username}}" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-medium">Password</label>
                        <div className="relative">
                          <input type={showAuthPassword ? "text" : "password"} value={authConfig.password} onChange={(e) => updateAuthConfig("password", e.target.value)} placeholder="password or {{password}}" className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 pr-10 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <button type="button" onClick={() => setShowAuthPassword((v) => !v)} aria-label={showAuthPassword ? "Hide password" : "Show password"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors">{showAuthPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                        </div>
                      </div>
                      {authConfig.username && (
                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono">
                          <span className="text-slate-500">Will inject → </span><span className="text-blue-300">Authorization: </span><span className="text-slate-300">Basic </span>
                          <span className="text-green-300 break-all">{(() => { try { return btoa(`${authConfig.username}:${authConfig.password}`); } catch { return "<encoding error>"; } })()}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {authConfig.type === "apikey" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-medium">Header Name</label>
                        <input type="text" value={authConfig.apiKeyName} onChange={(e) => updateAuthConfig("apiKeyName", e.target.value)} placeholder="X-API-Key" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400 font-medium">Value</label>
                        <input type="text" value={authConfig.apiKeyValue} onChange={(e) => updateAuthConfig("apiKeyValue", e.target.value)} placeholder="your-api-key or {{apiKey}}" className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono" />
                      </div>
                      {authConfig.apiKeyName && authConfig.apiKeyValue && (
                        <div className="bg-slate-900/60 rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono">
                          <span className="text-slate-500">Will inject → </span><span className="text-blue-300">{authConfig.apiKeyName}: </span><span className="text-green-300 break-all">{authConfig.apiKeyValue}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {authConfig.type === "none" && <p className="text-sm text-slate-500">No auth header will be added to the request.</p>}
                </div>
              )}

              {/* Body Tab */}
              {activeTab === "body" && (
                <div className="p-4">
                  {method === "GET"
                    ? <p className="text-slate-400 text-sm">GET requests do not have a body.</p>
                    : <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={'{\n  "key": "value"\n}'} rows={10} className="w-full bg-slate-900 text-green-400 font-mono text-sm rounded-lg p-4 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y" />
                  }
                </div>
              )}

              {/* Tests Tab */}
              {activeTab === "tests" && (
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">One assertion per line. <span className="font-mono text-slate-600">#</span> for comments.</p>
                    <button
                      type="button"
                      onClick={() => response && updateTestScript(generateAssertions(response))}
                      disabled={!response}
                      title={!response ? "Send a request first to generate assertions" : "Analyse response and generate smart assertions"}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      ✨ Generate Assertions
                    </button>
                  </div>
                  <textarea value={testScript} onChange={(e) => updateTestScript(e.target.value)} placeholder={ASSERTION_PLACEHOLDER} rows={8} spellCheck={false} className="w-full bg-slate-900 text-slate-300 font-mono text-sm rounded-lg p-4 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y placeholder-slate-600" />
                  {testResults.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${allTestsPassed ? "bg-green-900/30 border border-green-700/50 text-green-300" : "bg-red-900/30 border border-red-700/50 text-red-300"}`}>
                        {allTestsPassed ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {testsPassed} / {testsTotal} assertions passed
                      </div>
                      <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
                        {testResults.map((r, i) => (
                          <div key={i} className={`flex items-start gap-3 px-4 py-2.5 text-xs border-b border-slate-800 last:border-0 ${r.passed ? "bg-green-900/10" : "bg-red-900/10"}`}>
                            {r.passed ? <CheckCircle size={13} className="text-green-400 shrink-0 mt-0.5" /> : <XCircle size={13} className="text-red-400 shrink-0 mt-0.5" />}
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-mono text-slate-400">{r.line}</span>
                              <span className={r.passed ? "text-green-400" : "text-red-400"}>{r.message}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {testResults.length === 0 && testScript.trim() && <p className="text-slate-500 text-xs">Send a request to run these assertions.</p>}
                </div>
              )}

              {/* Response Tab */}
              {activeTab === "response" && (
                <div className="p-4 flex flex-col gap-3">
                  {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg p-3 text-sm">{error}</div>}
                  {loading && (
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      Sending request...
                    </div>
                  )}
                  {response && (
                    <>
                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <span className={`px-2 py-1 rounded-md text-white font-bold text-xs ${statusColor(response.status_code)}`}>{response.status_code}</span>
                        <span className="text-slate-400">Time: <span className="text-white font-mono">{response.response_time_ms}ms</span></span>
                        <span className={`font-medium ${response.success ? "text-green-400" : "text-red-400"}`}>{response.success ? "Success" : "Failed"}</span>
                        {testsTotal > 0 && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${allTestsPassed ? "bg-green-700 text-white" : "bg-red-700 text-white"}`}>Tests: {testsPassed}/{testsTotal}</span>}
                        {sentUrl && sentUrl !== url.trim() && <span className="text-xs text-purple-400 font-mono ml-auto">Sent to: {sentUrl}</span>}
                      </div>
                      <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-auto max-h-96">
                        <pre className="p-4 text-sm text-green-300 font-mono whitespace-pre-wrap break-words">{formatBody(response.body)}</pre>
                      </div>
                      {/* AI action buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {!response.success && (
                          <button
                            type="button"
                            onClick={aiDebug}
                            disabled={aiLoading === "debug"}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/30 border border-red-700/40 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {aiLoading === "debug"
                              ? <><div className="w-3 h-3 border border-red-300 border-t-transparent rounded-full animate-spin" /> Analysing…</>
                              : <><Sparkles size={11} /> Debug with AI</>
                            }
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={aiExplain}
                          disabled={aiLoading === "explain"}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-900/20 hover:bg-violet-900/30 border border-violet-700/40 text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {aiLoading === "explain"
                            ? <><div className="w-3 h-3 border border-violet-300 border-t-transparent rounded-full animate-spin" /> Explaining…</>
                            : <><Sparkles size={11} /> Explain Response</>
                          }
                        </button>
                        {aiError && aiLoading === null && (
                          <p className="text-red-400 text-xs">{aiError}</p>
                        )}
                      </div>

                      {/* AI debug result */}
                      {aiDebugResult && (
                        <div className="bg-red-900/10 border border-red-700/30 rounded-lg p-4">
                          <div className="flex items-center gap-1.5 mb-3">
                            <Sparkles size={12} className="text-red-400" />
                            <span className="text-xs font-semibold text-red-300">AI Debug Analysis</span>
                          </div>
                          <SimpleMarkdown text={aiDebugResult} />
                        </div>
                      )}

                      {/* AI explain result */}
                      {aiExplainResult && (
                        <div className="bg-violet-900/10 border border-violet-700/30 rounded-lg p-4">
                          <div className="flex items-center gap-1.5 mb-3">
                            <Sparkles size={12} className="text-violet-400" />
                            <span className="text-xs font-semibold text-violet-300">AI Response Explanation</span>
                          </div>
                          <SimpleMarkdown text={aiExplainResult} />
                        </div>
                      )}

                      <button type="button" onClick={() => setShowResponseHeaders(!showResponseHeaders)} aria-label="Toggle response headers" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                        {showResponseHeaders ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        Response Headers ({Object.keys(response.headers).length})
                      </button>
                      {showResponseHeaders && (
                        <div className="bg-slate-900 rounded-lg border border-slate-700 p-3">
                          {Object.entries(response.headers).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs py-1 border-b border-slate-800 last:border-0">
                              <span className="text-blue-400 font-mono min-w-40">{k}</span>
                              <span className="text-slate-300 font-mono break-all">{v}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {!response && !loading && !error && <p className="text-slate-500 text-sm">Hit Send to see the response here.</p>}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
